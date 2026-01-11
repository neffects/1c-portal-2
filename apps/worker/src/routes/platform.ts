/**
 * Platform Routes
 * 
 * Handles platform-wide configuration:
 * - GET /branding - Get platform branding config
 * - PATCH /branding - Update platform branding config (superadmin only)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { updateBrandingRequestSchema } from '@1cc/shared';
import { readJSON, writeJSON, getPlatformConfigPath } from '../lib/r2';
import { requireSuperadmin, optionalAuth } from '../middleware/auth';
import { ValidationError } from '../middleware/error';
import type { BrandingConfig, AppConfig } from '@1cc/shared';

export const platformRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /branding
 * Get platform branding configuration (public endpoint - optional auth)
 */
platformRoutes.get('/branding', optionalAuth, async (c) => {
  console.log('[Platform] Getting branding config');
  
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
    console.error('[Platform] Error getting branding config:', error);
    // Return null if file doesn't exist or error occurs
    return c.json({
      success: true,
      data: null
    });
  }
});

/**
 * PATCH /branding
 * Update platform branding configuration (superadmin only)
 */
platformRoutes.patch('/branding', requireSuperadmin, async (c) => {
  console.log('[Platform] Updating branding config');
  
  const body = await c.req.json();
  console.log('[Platform] Received branding update:', JSON.stringify(body, null, 2));
  
  const result = updateBrandingRequestSchema.safeParse(body);
  
  if (!result.success) {
    console.error('[Platform] Validation errors:', JSON.stringify(result.error.errors, null, 2));
    throw new ValidationError('Invalid branding data', { errors: result.error.errors });
  }
  
  const updates = result.data;
  
  // Read existing platform config or create new
  let platformConfig = await readJSON<{ branding?: BrandingConfig }>(c.env.R2_BUCKET, getPlatformConfigPath());
  
  if (!platformConfig) {
    platformConfig = {};
  }
  
  // Merge branding updates
  const existingBranding = platformConfig.branding || {
    rootOrgId: 'root001',
    siteName: 'OneConsortium',
    defaultTheme: 'light' as const,
    logoUrl: '/logo.svg'
  } as BrandingConfig;
  
  const updatedBranding: BrandingConfig = {
    ...existingBranding,
    ...updates
  };
  
  // Ensure required fields are present
  if (!updatedBranding.siteName) {
    updatedBranding.siteName = 'OneConsortium';
  }
  if (!updatedBranding.logoUrl) {
    updatedBranding.logoUrl = '/logo.svg';
  }
  if (!updatedBranding.rootOrgId) {
    updatedBranding.rootOrgId = 'root001';
  }
  if (!updatedBranding.defaultTheme) {
    updatedBranding.defaultTheme = 'light';
  }
  
  // Update platform config
  platformConfig.branding = updatedBranding;
  
  // Save to R2
  await writeJSON(c.env.R2_BUCKET, getPlatformConfigPath(), platformConfig);
  
  console.log('[Platform] Updated branding config');
  
  return c.json({
    success: true,
    data: updatedBranding
  });
});
