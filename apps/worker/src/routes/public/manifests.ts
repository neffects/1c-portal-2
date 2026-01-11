/**
 * Public Manifest Routes
 * 
 * GET /public/manifests/site - Get public site manifest
 * GET /public/bundles/:typeId - Get public entity bundle
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getManifestPath, getBundlePath, getEntityTypePath } from '../../lib/r2';
import { NotFoundError } from '../../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { SiteManifest, EntityBundle, EntityType } from '@1cc/shared';

export const publicManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get public site manifest (no auth required)
 */
publicManifestRoutes.get('/manifests/site', async (c) => {
  console.log('[Public] Getting public manifest');
  
  // Try to get cached manifest
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('public'));
  
  if (!manifest) {
    // Return empty manifest if not exists
    manifest = {
      generatedAt: new Date().toISOString(),
      version: 0,
      entityTypes: []
    };
  }
  
  return c.json({
    success: true,
    data: manifest
  });
});

/**
 * GET /bundles/:typeId
 * Get public entity bundle (no auth required)
 */
publicManifestRoutes.get('/bundles/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  console.log('[Public] Getting public bundle:', typeId);
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  let bundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, getBundlePath('public', typeId));
  
  if (!bundle) {
    // Return empty bundle if not exists
    bundle = {
      typeId,
      typeName: entityType.pluralName,
      generatedAt: new Date().toISOString(),
      version: 0,
      entityCount: 0,
      entities: []
    };
  }
  
  return c.json({
    success: true,
    data: bundle
  });
});
