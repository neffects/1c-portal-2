/**
 * CASL Authorization Middleware
 * 
 * Provides middleware helpers for checking CASL abilities in route handlers.
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import type { Actions, Subjects } from '../lib/abilities';

/**
 * Middleware that requires a specific ability
 */
export function requireAbility(action: Actions, subject: Subjects) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next
  ) => {
    const ability = c.get('ability');
    
    if (!ability?.can(action, subject)) {
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
