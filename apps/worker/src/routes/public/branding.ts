/**
 * Public Branding Routes
 * 
 * GET /public/branding - Get platform branding config (public)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getPlatformConfigPath } from '../../lib/r2';
import type { BrandingConfig } from '@1cc/shared';

export const brandingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /branding
 * Get platform branding configuration (public endpoint)
 */
brandingRoutes.get('/branding', async (c) => {
  console.log('[Public] Getting branding config');
  
  try {
    // Read platform config from R2
    const platformConfig = await readJSON<{ branding?: BrandingConfig }>(c.env.R2_BUCKET, getPlatformConfigPath());
    
    // Return branding config if it exists, otherwise return null
    const branding = platformConfig?.branding || null;
    
    return c.json({
      success: true,
      data: branding
    });
  } catch (error) {
    console.error('[Public] Error getting branding config:', error);
    // Return null if file doesn't exist or error occurs
    return c.json({
      success: true,
      data: null
    });
  }
});
