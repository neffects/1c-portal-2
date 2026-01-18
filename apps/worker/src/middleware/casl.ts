/**
 * CASL Authorization Middleware
 * 
 * Provides middleware helpers for checking CASL abilities and membership keys in route handlers.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import type { Actions, Subjects } from '../lib/abilities';
import { getUserMembershipKeys, loadAppConfig } from '../lib/bundle-invalidation';
import type { MembershipKeyId } from '@1cc/shared';

/**
 * Middleware that requires a specific ability
 * 
 * SECURITY: Explicitly checks for undefined ability to prevent silent failures
 */
export function requireAbility(action: Actions, subject: Subjects) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const ability = c.get('ability');
    
    // Explicit check for undefined ability (should not happen if authMiddleware ran)
    if (!ability) {
      console.error('[CASL] Ability not found in context - authMiddleware may have failed');
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required - ability not found'
        }
      }, 401);
    }
    
    if (!ability.can(action, subject)) {
      console.log('[CASL] Permission denied:', { action, subject, userId: c.get('userId') });
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Cannot ${action} ${subject}`
        }
      }, 403);
    }
    
    await next();
  };
}

/**
 * Middleware that requires a specific membership key
 * Returns 403 if user doesn't have the required key
 */
export function requireMembershipKey(keyId: MembershipKeyId) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const userId = c.get('userId');
    const userOrgId = c.get('organizationId');
    const isSuperadmin = c.get('isSuperadmin') || false;
    
    if (!userId) {
      // Public key doesn't require auth
      if (keyId === 'public') {
        await next();
        return;
      }
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      }, 401);
    }
    
    // Get user's membership keys
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const userKeys = await getUserMembershipKeys(c.env.R2_BUCKET, userOrgId || null, isSuperadmin, config);
    
    if (!userKeys.includes(keyId)) {
      console.log('[CASL] Membership key denied:', { keyId, userKeys, userId });
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access requires ${keyId} membership key`
        }
      }, 403);
    }
    
    await next();
  };
}
