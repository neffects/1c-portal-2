/**
 * User Me Routes
 * 
 * GET /api/user/me - Get current user info from token
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getOrgProfilePath } from '../../lib/r2';
import { verifyJWT, isTokenExpiringSoon } from '../../lib/jwt';
import { listUserOrganizations, isSuperadminEmail } from '../../lib/user-stubs';
import { AppError } from '../../middleware/error';
import type { Organization, UserOrganization } from '@1cc/shared';

export const userMeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /me
 * Get current user info from token
 * 
 * Returns user info including all organizations they belong to.
 * Organizations are looked up from user-org stubs.
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
  
  console.log('[User] /me returning user:', payload.sub, 'with', organizations.length, 'organizations');
  
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
