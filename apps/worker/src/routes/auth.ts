/**
 * Authentication Routes
 * 
 * Handles magic link authentication flow:
 * - POST /auth/magic-link - Request magic link
 * - GET /auth/verify - Verify token and create session
 * - POST /auth/refresh - Refresh JWT token
 * - POST /auth/logout - Invalidate session
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { magicLinkRequestSchema, verifyTokenSchema } from '@1cc/shared';
import { createJWT, verifyJWT, isTokenExpiringSoon } from '../lib/jwt';
import { readJSON, writeJSON, deleteFile, getMagicLinkPath, getOrgProfilePath, getUserMembershipPath, listFiles } from '../lib/r2';
import { listUserOrganizations, isSuperadminEmail } from '../lib/user-stubs';
import { createMagicLinkToken, createUserId } from '../lib/id';
import { sendMagicLinkEmail } from '../lib/email';
import { AppError, ValidationError } from '../middleware/error';
import { MAGIC_LINK_EXPIRY_SECONDS, R2_PATHS } from '@1cc/shared';
import type { MagicLinkToken, User, Organization, OrganizationMembership, AuthResponse, UserOrganization } from '@1cc/shared';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /auth/magic-link
 * Request a magic link for authentication
 */
authRoutes.post('/magic-link',
  zValidator('json', magicLinkRequestSchema),
  async (c) => {
  console.log('[Auth] Magic link requested');
  
  const { email } = c.req.valid('json');
  
  // Check if user exists and get their organization
  const existingUser = await findUserByEmail(c.env.R2_BUCKET, email);
  
  // If user doesn't exist, check domain whitelist for self-signup
  if (!existingUser) {
    const canSignup = await checkDomainWhitelist(c.env.R2_BUCKET, email);
    if (!canSignup) {
      // Don't reveal whether email exists - just say link sent
      console.log('[Auth] Domain not whitelisted, but returning success for security');
    }
  }
  
  // Generate magic link token
  const token = createMagicLinkToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_SECONDS * 1000);
  
  const magicLinkData: MagicLinkToken = {
    token,
    email,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    used: false
  };
  
  // Store token in R2
  await writeJSON(c.env.R2_BUCKET, getMagicLinkPath(token), magicLinkData);
  
  // Build magic link URL
  const baseUrl = c.env.API_BASE_URL || 'http://localhost:8787';
  const magicLink = `${baseUrl}/auth/verify?token=${token}`;
  
  // Send email
  if (c.env.RESEND_API_KEY) {
    await sendMagicLinkEmail(
      c.env.RESEND_API_KEY,
      email,
      magicLink,
      Math.floor(MAGIC_LINK_EXPIRY_SECONDS / 60)
    );
    console.log('[Auth] Magic link email sent to:', email);
  } else {
    // Development mode - log the link prominently
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    🔗 MAGIC LINK (DEV MODE)                    ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║ Email:', email.padEnd(55), '║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║ Link:                                                          ║');
    console.log(`║ ${magicLink}`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('\n');
  }
  
  return c.json({
    success: true,
    data: {
      message: 'If your email is registered, you will receive a magic link shortly.',
      // Include link in dev mode for testing
      ...(c.env.ENVIRONMENT !== 'production' && { devLink: magicLink })
    }
  });
});

/**
 * GET /auth/verify
 * Verify magic link token and redirect to frontend with JWT
 */
authRoutes.get('/verify', async (c) => {
  console.log('[Auth] Verifying magic link');
  
  const token = c.req.query('token');
  const format = c.req.query('format'); // Allow 'json' for API testing
  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Helper to redirect to frontend with error
  const redirectWithError = (error: string) => {
    if (format === 'json') {
      return c.json({ success: false, error: { code: 'AUTH_ERROR', message: error } }, 401);
    }
    return c.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
  };
  
  if (!token) {
    return redirectWithError('No token provided');
  }
  
  // Read token from R2
  const tokenData = await readJSON<MagicLinkToken>(
    c.env.R2_BUCKET, 
    getMagicLinkPath(token)
  );
  
  if (!tokenData) {
    return redirectWithError('Invalid or expired magic link');
  }
  
  // Check if already used
  if (tokenData.used) {
    return redirectWithError('This magic link has already been used');
  }
  
  // Check if expired
  if (new Date(tokenData.expiresAt) < new Date()) {
    await deleteFile(c.env.R2_BUCKET, getMagicLinkPath(token));
    return redirectWithError('This magic link has expired');
  }
  
  // Mark token as used
  await writeJSON(c.env.R2_BUCKET, getMagicLinkPath(token), {
    ...tokenData,
    used: true
  });
  
  // Find or create user
  let user = await findUserByEmail(c.env.R2_BUCKET, tokenData.email, c.env.SUPERADMIN_EMAILS);
  let isNewUser = false;
  
  if (!user) {
    // Create new user
    user = await createNewUser(c.env.R2_BUCKET, tokenData.email);
    isNewUser = true;
  }
  
  // Update last login
  await updateUserLastLogin(c.env.R2_BUCKET, user);
  
  // Generate JWT (minimal: userId + email only)
  const jwt = await createJWT({
    userId: user.id,
    email: user.email
  }, c.env.JWT_SECRET);
  
  // Check if user is a superadmin
  const isSuperadmin = isSuperadminEmail(user.email, c.env.SUPERADMIN_EMAILS);
  
  // Get user's organizations from stubs
  const userOrgs = await listUserOrganizations(c.env.R2_BUCKET, user.email, user.id);
  
  // Build organizations array with details
  const organizations: UserOrganization[] = [];
  for (const userOrg of userOrgs) {
    const org = await readJSON<Organization>(
      c.env.R2_BUCKET,
      getOrgProfilePath(userOrg.orgId)
    );
    if (org) {
      organizations.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: userOrg.role
      });
    }
  }
  
  // Clean up used token
  await deleteFile(c.env.R2_BUCKET, getMagicLinkPath(token));
  
  console.log('[Auth] User authenticated:', user.id, isNewUser ? '(new)' : '(existing)', 'orgs:', organizations.length);
  
  // Return JSON if requested (for API testing)
  if (format === 'json') {
    const response: AuthResponse = {
      success: true,
      token: jwt,
      user: {
        id: user.id,
        email: user.email,
        isSuperadmin,
        organizations
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    return c.json(response);
  }
  
  // Redirect to frontend callback with token as query param
  // The frontend will extract this and store it securely
  const callbackUrl = new URL(`${frontendUrl}/auth/callback`);
  callbackUrl.searchParams.set('token', jwt);
  callbackUrl.searchParams.set('userId', user.id);
  callbackUrl.searchParams.set('email', user.email);
  callbackUrl.searchParams.set('isSuperadmin', String(isSuperadmin));
  // Pass organizations as JSON-encoded string
  callbackUrl.searchParams.set('organizations', JSON.stringify(organizations));
  callbackUrl.searchParams.set('expiresAt', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  
  return c.redirect(callbackUrl.toString());
});

/**
 * POST /auth/refresh
 * Refresh an expiring JWT token
 */
authRoutes.post('/refresh', async (c) => {
  console.log('[Auth] Token refresh requested');
  
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'No token provided', 401);
  }
  
  const oldToken = authHeader.substring(7);
  const payload = await verifyJWT(oldToken, c.env.JWT_SECRET);
  
  if (!payload) {
    throw new AppError('INVALID_TOKEN', 'Invalid or expired token', 401);
  }
  
  // Generate new token (minimal: userId + email only)
  const newToken = await createJWT({
    userId: payload.sub,
    email: payload.email
  }, c.env.JWT_SECRET);
  
  console.log('[Auth] Token refreshed for user:', payload.sub);
  
  return c.json({
    success: true,
    data: {
      token: newToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
});

/**
 * POST /auth/logout
 * Logout (client-side token removal)
 */
authRoutes.post('/logout', async (c) => {
  console.log('[Auth] Logout requested');
  
  // JWT is stateless, so logout is primarily client-side
  // We could implement token blacklisting here if needed
  
  return c.json({
    success: true,
    data: {
      message: 'Logged out successfully'
    }
  });
});

/**
 * GET /auth/me
 * Get current user info from token
 * 
 * Returns user info including all organizations they belong to.
 * Organizations are looked up from user-org stubs.
 */
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'No token provided', 401);
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  
  if (!payload) {
    throw new AppError('INVALID_TOKEN', 'Invalid or expired token', 401);
  }
  
  // Check if user is a superadmin
  const isSuperadmin = isSuperadminEmail(payload.email, c.env.SUPERADMIN_EMAILS);
  
  // Get user's organizations from stubs
  const userOrgs = await listUserOrganizations(c.env.R2_BUCKET, payload.email, payload.sub);
  
  // Build organizations array with details
  const organizations: UserOrganization[] = [];
  for (const userOrg of userOrgs) {
    const org = await readJSON<Organization>(
      c.env.R2_BUCKET,
      getOrgProfilePath(userOrg.orgId)
    );
    if (org) {
      organizations.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: userOrg.role
      });
    }
  }
  
  console.log('[Auth] /me returning user:', payload.sub, 'with', organizations.length, 'organizations');
  
  return c.json({
    success: true,
    data: {
      id: payload.sub,
      email: payload.email,
      isSuperadmin,
      organizations,
      tokenExpiresAt: new Date(payload.exp * 1000).toISOString(),
      tokenExpiringSoon: isTokenExpiringSoon(token)
    }
  });
});

// Helper functions

/**
 * Find user by email across all organizations
 */
async function findUserByEmail(bucket: R2Bucket, email: string, superadminEmails?: string): Promise<User | null> {
  console.log('[Auth] Looking for user with email:', email);
  
  // Check if user is a superadmin (from environment variable)
  if (superadminEmails && isSuperadminEmail(email, superadminEmails)) {
    console.log('[Auth] 🔑 User is a superadmin!');
    return {
      id: `superadmin_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      email: email.toLowerCase(),
      role: 'superadmin',
      organizationId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };
  }
  
  // Check for superadmin in R2 (legacy support)
  const superadminPath = `${R2_PATHS.SECRET}superadmins/${email.toLowerCase()}.json`;
  const superadmin = await readJSON<User>(bucket, superadminPath);
  if (superadmin) {
    return superadmin;
  }
  
  // List all organizations and search for user
  const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
  
  for (const orgDir of orgDirs) {
    // Extract org ID from path
    const match = orgDir.match(/private\/orgs\/([^\/]+)\//);
    if (!match) continue;
    
    const orgId = match[1];
    const userFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
    
    for (const userFile of userFiles) {
      const user = await readJSON<OrganizationMembership>(bucket, userFile);
      if (user && user.email.toLowerCase() === email.toLowerCase()) {
        return {
          id: user.userId,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          createdAt: user.joinedAt,
          updatedAt: user.joinedAt,
          isActive: true
        };
      }
    }
  }
  
  return null;
}

/**
 * Check if email domain is whitelisted for any organization
 */
async function checkDomainWhitelist(bucket: R2Bucket, email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  
  // List all organizations
  const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
  
  for (const file of orgFiles) {
    if (file.endsWith('/profile.json')) {
      const org = await readJSON<Organization>(bucket, file);
      if (org?.settings.allowSelfSignup && org.settings.domainWhitelist.includes(domain)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Create a new user
 */
async function createNewUser(bucket: R2Bucket, email: string): Promise<User> {
  const userId = createUserId();
  const now = new Date().toISOString();
  
  // For now, create as org_member without organization
  // They'll need to be invited to an org
  const user: User = {
    id: userId,
    email,
    role: 'org_member',
    organizationId: null,
    createdAt: now,
    updatedAt: now,
    isActive: true
  };
  
  // Store user in pending users
  await writeJSON(bucket, `${R2_PATHS.PRIVATE}pending-users/${userId}.json`, user);
  
  console.log('[Auth] Created new user:', userId);
  return user;
}

/**
 * Update user's last login timestamp
 */
async function updateUserLastLogin(bucket: R2Bucket, user: User): Promise<void> {
  const now = new Date().toISOString();
  
  if (user.organizationId) {
    const membershipPath = getUserMembershipPath(user.organizationId, user.id);
    const membership = await readJSON<OrganizationMembership>(bucket, membershipPath);
    
    if (membership) {
      // We don't have lastLogin in membership, could add it
      console.log('[Auth] Updated last login for user:', user.id);
    }
  }
}
