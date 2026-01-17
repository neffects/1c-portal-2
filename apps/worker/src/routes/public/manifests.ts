/**
 * Public Manifest Routes
 * 
 * GET /public/manifests/site - Get public site manifest
 * GET /public/bundles/:typeId - Get public entity bundle
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getManifestPath, getBundlePath, getEntityTypePath, getAppConfigPath } from '../../lib/r2';
import { NotFoundError } from '../../middleware/error';
import type { SiteManifest, EntityBundle, EntityType, AppConfig } from '@1cc/shared';

export const publicManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get public site manifest (no auth required)
 * Returns manifest for 'public' membership key
 */
publicManifestRoutes.get('/manifests/site', async (c) => {
  console.log('[Public] Getting public manifest - route matched');
  
  try {
    // Try to get cached manifest for 'public' key
    const manifestPath = getManifestPath('public');
    console.log('[Public] Reading manifest from path:', manifestPath);
    
    let manifest: SiteManifest;
    try {
      const fetchedManifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, manifestPath);
      
      if (!fetchedManifest) {
        // Return empty manifest if not exists
        console.log('[Public] Manifest not found in R2, returning empty manifest');
        manifest = {
          generatedAt: new Date().toISOString(),
          version: 0,
          entityTypes: []
        };
      } else {
        manifest = fetchedManifest;
        console.log('[Public] Manifest loaded from R2:', manifest.entityTypes.length, 'entity types');
      }
    } catch (readError) {
      // If readJSON throws, log and return empty manifest
      console.error('[Public] Error reading manifest from R2:', readError);
      manifest = {
        generatedAt: new Date().toISOString(),
        version: 0,
        entityTypes: []
      };
    }
    
    // Ensure manifest is valid
    if (!manifest) {
      console.warn('[Public] Manifest is null, creating empty manifest');
      manifest = {
        generatedAt: new Date().toISOString(),
        version: 0,
        entityTypes: []
      };
    }
    
    const response = {
      success: true,
      data: manifest
    };
    
    console.log('[Public] Returning manifest response with', manifest.entityTypes.length, 'entity types');
    
    // Explicitly return JSON response
    return c.json(response, 200);
  } catch (error) {
    console.error('[Public] Unexpected error getting manifest:', error);
    console.error('[Public] Error stack:', error instanceof Error ? error.stack : 'No stack');
    // Re-throw to be caught by error handler - it will return proper JSON error response
    throw error;
  }
});

/**
 * GET /bundles/:typeId
 * Get public entity bundle (no auth required)
 * Returns bundle for 'public' membership key
 */
publicManifestRoutes.get('/bundles/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  console.log('[Public] Getting public bundle:', typeId);
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check if type is visible to public key
  if (!entityType.visibleTo?.includes('public')) {
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
