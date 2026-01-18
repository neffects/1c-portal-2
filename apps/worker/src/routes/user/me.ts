/**
 * User Me Routes
 * 
 * GET /api/user/me - Get current user info from token
 * 
 * For superadmins, returns ALL organizations in the system (with org_admin role).
 * For regular users, returns only organizations they belong to (from user-org stubs).
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getOrgProfilePath, listFiles } from '../../lib/r2';
import { verifyJWT, isTokenExpiringSoon } from '../../lib/jwt';
import { listUserOrganizations, isSuperadminEmail } from '../../lib/user-stubs';
import { AppError } from '../../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { Organization, UserOrganization } from '@1cc/shared';

export const userMeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /me
 * Get current user info from token
 * 
 * Returns user info including all organizations they belong to.
 * - Superadmins: Get all active organizations in the system (treated as org_admin for each)
 * - Regular users: Get organizations from user-org stubs
 */
userMeRoutes.get('/me', async (c) => {
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
  
  // Build organizations array
  const organizations: UserOrganization[] = [];
  
  if (isSuperadmin) {
    // Superadmins get access to ALL organizations
    console.log('[User] /me - Superadmin user, listing all organizations');
    const prefix = `${R2_PATHS.PRIVATE}orgs/`;
    // Pass null ability - auth paths are allowed during authentication flows
    const orgFiles = await listFiles(c.env.R2_BUCKET, prefix, null);
    
    // Filter for profile.json files only
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    console.log('[User] /me - Found', profileFiles.length, 'organization profiles');
    
    for (const profilePath of profileFiles) {
      // Pass null ability - auth paths are allowed during authentication flows
      const org = await readJSON<Organization>(c.env.R2_BUCKET, profilePath, null);
      if (org && org.isActive) {
        organizations.push({
          id: org.id,
          name: org.name,
          slug: org.slug,
          role: 'org_admin' // Superadmins have full admin access to all orgs
        });
      }
    }
  } else {
    // Regular users: get organizations from user-org stubs
    const userOrgs = await listUserOrganizations(c.env.R2_BUCKET, payload.email, payload.sub);
    
    for (const userOrg of userOrgs) {
      // Pass null ability - auth paths are allowed during authentication flows
      const org = await readJSON<Organization>(
        c.env.R2_BUCKET,
        getOrgProfilePath(userOrg.orgId),
        null
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
  }
  
  console.log('[User] /me returning user:', payload.sub, 'isSuperadmin:', isSuperadmin, 'with', organizations.length, 'organizations');
  
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
