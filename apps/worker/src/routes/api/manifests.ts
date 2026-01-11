/**
 * API Manifest Routes
 * 
 * GET /api/manifests/site - Get platform manifest (authenticated)
 * GET /api/bundles/:typeId - Get platform entity bundle (authenticated)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getManifestPath, getBundlePath, getEntityTypePath } from '../../lib/r2';
import { NotFoundError } from '../../middleware/error';
import type { SiteManifest, EntityBundle, EntityType } from '@1cc/shared';

export const apiManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get platform manifest (authenticated users)
 */
apiManifestRoutes.get('/manifests/site', async (c) => {
  console.log('[API] Getting platform manifest');
  
  // Get authenticated (platform) manifest
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('authenticated'));
  
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
 * Get platform entity bundle (authenticated users)
 */
apiManifestRoutes.get('/bundles/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  console.log('[API] Getting platform bundle:', typeId);
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  let bundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, getBundlePath('authenticated', typeId));
  
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
