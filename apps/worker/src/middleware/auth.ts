/**
 * Authentication Middleware
 * 
 * Validates JWT tokens and sets user context for protected routes.
 * 
 * Note: JWT only contains user ID and email. Role and organization
 * membership are looked up from user-org stubs per request.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { verifyJWT } from '../lib/jwt';
import { userOrgStubExists, isSuperadminEmail, listUserOrganizations } from '../lib/user-stubs';
import { defineAbilityFor } from '../lib/abilities';
import type { JWTPayload, UserRole } from '@1cc/shared';

/**
 * Main authentication middleware
 * Verifies JWT token and sets user in context
 * 
 * Sets: user, userId, userEmail, isSuperadmin
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  console.log('[AuthMiddleware] Checking authentication');
  
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AuthMiddleware] No bearer token provided');
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a valid Bearer token.'
      }
    }, 401);
  }
  
  const token = authHeader.substring(7);
  
  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    
    if (!payload) {
      console.log('[AuthMiddleware] Invalid or expired token');
      return c.json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired authentication token.'
        }
      }, 401);
    }
    
    // Check if user is a superadmin (by email)
    const superadmin = isSuperadminEmail(payload.email, c.env.SUPERADMIN_EMAILS);
    
    // Set user context for downstream handlers
    // Note: role and org are NOT in JWT - looked up from stubs per request
    c.set('user', payload);
    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('isSuperadmin', superadmin);
    // Set userRole for compatibility - superadmins have 'superadmin' role
    c.set('userRole', superadmin ? 'superadmin' : undefined);
    // organizationId is not set here - it's context-specific and set per request
    
    // Build CASL ability for user
    const userOrgs = await listUserOrganizations(c.env.R2_BUCKET, payload.email, payload.sub);
    const ability = defineAbilityFor({
      isSuperadmin: superadmin,
      orgMemberships: userOrgs.map(org => ({ orgId: org.orgId, role: org.role })),
      currentOrgId: undefined // Will be set by org middleware
    });
    c.set('ability', ability);
    
    console.log('[AuthMiddleware] Authenticated user:', {
      userId: payload.sub,
      email: payload.email,
      isSuperadmin: superadmin,
      userRole: superadmin ? 'superadmin' : undefined
    });
    
    await next();
  } catch (error) {
    console.error('[AuthMiddleware] Token verification error:', error);
    return c.json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed. Please try logging in again.'
      }
    }, 401);
  }
}

/**
 * Middleware that requires superadmin role
 * Superadmins are identified by email in environment variable
 */
export function requireSuperadmin() {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const isSuperadmin = c.get('isSuperadmin');
    
    if (!isSuperadmin) {
      console.log('[RequireSuperadmin] User is not a superadmin');
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Superadmin access required.'
        }
      }, 403);
    }
    
    console.log('[RequireSuperadmin] Superadmin access granted');
    await next();
  };
}

/**
 * Middleware that ensures user belongs to the requested organization
 * Uses user-org stub files to check membership
 * 
 * @param orgIdParam - Request parameter name containing the org ID (default: 'orgId')
 * @param requiredRoles - Optional: roles required in the org (default: any membership)
 */
export function requireOrgMembership(
  orgIdParam: string = 'orgId',
  requiredRoles?: UserRole[]
) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const userId = c.get('userId');
    const userEmail = c.get('userEmail');
    const isSuperadmin = c.get('isSuperadmin');
    const requestedOrgId = c.req.param(orgIdParam);
    
    if (!userId || !userEmail) {
      console.log('[RequireOrgMembership] No user context');
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      }, 401);
    }
    
    // Superadmins can access any organization
    if (isSuperadmin) {
      console.log('[RequireOrgMembership] Superadmin access granted');
      await next();
      return;
    }
    
    if (!requestedOrgId) {
      console.log('[RequireOrgMembership] No organization ID provided');
      return c.json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Organization ID is required.'
        }
      }, 400);
    }
    
    // Check user-org stub exists
    const stubResult = await userOrgStubExists(
      c.env.R2_BUCKET,
      userEmail,
      userId,
      requestedOrgId
    );
    
    if (!stubResult.exists) {
      console.log('[RequireOrgMembership] No membership stub found:', {
        userId,
        requestedOrgId
      });
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this organization.'
        }
      }, 403);
    }
    
    // Check role if required
    if (requiredRoles && stubResult.role && !requiredRoles.includes(stubResult.role)) {
      console.log('[RequireOrgMembership] Insufficient role:', {
        userRole: stubResult.role,
        requiredRoles
      });
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have the required role in this organization.'
        }
      }, 403);
    }
    
    console.log('[RequireOrgMembership] Access granted to organization:', requestedOrgId, 'role:', stubResult.role);
    await next();
  };
}

/**
 * Middleware that requires org admin role in the specified organization
 */
export function requireOrgAdmin(orgIdParam: string = 'orgId') {
  return requireOrgMembership(orgIdParam, ['org_admin']);
}

/**
 * Optional auth middleware - sets user if token present but doesn't require it
 */
export async function optionalAuth(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      
      if (payload) {
        const superadmin = isSuperadminEmail(payload.email, c.env.SUPERADMIN_EMAILS);
        
        c.set('user', payload);
        c.set('userId', payload.sub);
        c.set('userEmail', payload.email);
        c.set('isSuperadmin', superadmin);
        console.log('[OptionalAuth] User authenticated:', payload.sub);
      }
    } catch (error) {
      // Silently ignore invalid tokens for optional auth
      console.log('[OptionalAuth] Invalid token ignored');
    }
  }
  
  await next();
}
