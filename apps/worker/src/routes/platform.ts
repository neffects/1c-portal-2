/**
 * Platform Routes
 * 
 * Handles platform-wide configuration:
 * - PATCH /branding - Update platform branding config (superadmin only)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { updateBrandingRequestSchema } from '@1cc/shared';
import { readJSON, writeJSON, getPlatformConfigPath } from '../lib/r2';
import { ValidationError } from '../middleware/error';
import type { BrandingConfig, AppConfig } from '@1cc/shared';

export const platformRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * PATCH /branding
 * Update platform branding configuration (superadmin only)
 */
platformRoutes.patch('/branding', 
  zValidator('json', updateBrandingRequestSchema),
  async (c) => {
  console.log('[Platform] Updating branding config');
  
  const updates = c.req.valid('json');
  
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
