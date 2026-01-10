/**
 * Authentication Middleware
 * 
 * Validates JWT tokens and sets user context for protected routes.
 * Also handles role-based access control checks.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { verifyJWT } from '../lib/jwt';
import type { JWTPayload, UserRole } from '@1cc/shared';

/**
 * Main authentication middleware
 * Verifies JWT token and sets user in context
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
    
    // Set user context for downstream handlers
    c.set('user', payload);
    c.set('userId', payload.sub);
    c.set('userRole', payload.role);
    c.set('organizationId', payload.organizationId);
    
    console.log('[AuthMiddleware] Authenticated user:', {
      userId: payload.sub,
      role: payload.role,
      organizationId: payload.organizationId
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
 * Role-based access control middleware factory
 * Creates middleware that requires specific roles
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const userRole = c.get('userRole');
    
    if (!userRole) {
      console.log('[RequireRole] No user role found');
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      }, 401);
    }
    
    if (!allowedRoles.includes(userRole)) {
      console.log('[RequireRole] Insufficient permissions:', {
        userRole,
        requiredRoles: allowedRoles
      });
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.'
        }
      }, 403);
    }
    
    console.log('[RequireRole] Access granted for role:', userRole);
    await next();
  };
}

/**
 * Middleware that requires superadmin role
 */
export const requireSuperadmin = requireRole('superadmin');

/**
 * Middleware that requires org admin or superadmin role
 */
export const requireOrgAdmin = requireRole('superadmin', 'org_admin');

/**
 * Middleware that ensures user belongs to the requested organization
 */
export function requireOrgMembership(orgIdParam: string = 'orgId') {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const userRole = c.get('userRole');
    const userOrgId = c.get('organizationId');
    const requestedOrgId = c.req.param(orgIdParam);
    
    // Superadmins can access any organization
    if (userRole === 'superadmin') {
      console.log('[RequireOrgMembership] Superadmin access granted');
      await next();
      return;
    }
    
    // Check if user belongs to the requested organization
    if (userOrgId !== requestedOrgId) {
      console.log('[RequireOrgMembership] Organization mismatch:', {
        userOrgId,
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
    
    console.log('[RequireOrgMembership] Access granted to organization:', requestedOrgId);
    await next();
  };
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
        c.set('user', payload);
        c.set('userId', payload.sub);
        c.set('userRole', payload.role);
        c.set('organizationId', payload.organizationId);
        console.log('[OptionalAuth] User authenticated:', payload.sub);
      }
    } catch (error) {
      // Silently ignore invalid tokens for optional auth
      console.log('[OptionalAuth] Invalid token ignored');
    }
  }
  
  await next();
}
