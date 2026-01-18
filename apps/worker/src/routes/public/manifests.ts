/**
 * Public Manifest Routes
 * 
 * GET /public/manifests/site - Get public site manifest
 * GET /public/bundles/:typeId - Get public entity bundle
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, readJSONWithEtag, getManifestPath, getBundlePath, getEntityTypePath, getAppConfigPath } from '../../lib/r2';
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
 * Supports ETag-based conditional requests (If-None-Match header)
 */
publicManifestRoutes.get('/bundles/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  const ifNoneMatch = c.req.header('If-None-Match'); // ETag from client
  console.log('[Public] Getting public bundle:', typeId, ifNoneMatch ? `(If-None-Match: ${ifNoneMatch})` : '');
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check if type is visible to public key
  if (!entityType.visibleTo?.includes('public')) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Read bundle with ETag metadata
  const bundlePath = getBundlePath('public', typeId);
  const { data: bundle, etag } = await readJSONWithEtag<EntityBundle>(c.env.R2_BUCKET, bundlePath);
  
  // Generate ETag for empty bundle (hash of JSON content)
  let bundleEtag: string | null = etag;
  let finalBundle: EntityBundle;
  
  if (!bundle) {
    // Return empty bundle if not exists (bundles don't have versions)
    finalBundle = {
      typeId,
      typeName: entityType.pluralName,
      generatedAt: new Date().toISOString(),
      entityCount: 0,
      entities: []
    };
    
    // Generate ETag for empty bundle (hash of JSON string)
    const emptyBundleJson = JSON.stringify(finalBundle);
    bundleEtag = `"${Buffer.from(emptyBundleJson).toString('base64').substring(0, 32)}"`; // Simple hash approximation
  } else {
    finalBundle = bundle;
  }
  
  // Handle conditional request (If-None-Match)
  if (ifNoneMatch && bundleEtag) {
    // Remove quotes if present for comparison
    const clientEtag = ifNoneMatch.replace(/^"|"$/g, '');
    const serverEtag = bundleEtag.replace(/^"|"$/g, '');
    
    if (clientEtag === serverEtag) {
      console.log('[Public] Bundle ETag matches - returning 304 Not Modified:', typeId);
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': bundleEtag,
          'Cache-Control': 'public, max-age=300' // 5 minutes
        }
      });
    }
  }
  
  // Return bundle with ETag header
  const response = c.json({
    success: true,
    data: finalBundle
  });
  
  // Add ETag header if available
  if (bundleEtag) {
    response.headers.set('ETag', bundleEtag);
    response.headers.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  }
  
  return response;
});
