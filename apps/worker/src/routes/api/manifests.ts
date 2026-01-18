/**
 * API Manifest Routes
 * 
 * GET /api/manifests/site - Get platform manifest (authenticated)
 * GET /api/bundles/:typeId - Get platform entity bundle (authenticated)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, readJSONWithEtag } from '../../lib/r2-casl';
import { getManifestPath, getBundlePath, getEntityTypePath } from '../../lib/r2';
import { requireAbility } from '../../middleware/casl';
import { NotFoundError } from '../../middleware/error';
import { getUserHighestMembershipKey, loadAppConfig } from '../../lib/bundle-invalidation';
import type { SiteManifest, EntityBundle, EntityType } from '@1cc/shared';

export const apiManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get manifest for user's highest membership key (authenticated users)
 */
apiManifestRoutes.get('/manifests/site', requireAbility('read', 'Platform'), async (c) => {
  console.log('[API] Getting manifest for authenticated user');
  
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = c.get('userRole') === 'superadmin';
  const ability = c.get('ability');
  
  if (!userId || !ability) {
    // Fallback to public for unauthenticated (shouldn't happen with auth middleware)
    const manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('public'), null);
    return c.json({
      success: true,
      data: manifest || { generatedAt: new Date().toISOString(), version: 0, entityTypes: [] }
    });
  }
  
  // Get user's highest membership key
  const config = await loadAppConfig(c.env.R2_BUCKET);
  const highestKey = await getUserHighestMembershipKey(c.env.R2_BUCKET, userOrgId || null, isSuperadmin, config);
  
  console.log('[API] User highest membership key:', highestKey);
  
  // Get manifest for that key (public paths don't require ability)
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath(highestKey), ability);
  
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
 * Get entity bundle for user's highest membership key (authenticated users)
 * Supports ETag-based conditional requests (If-None-Match header)
 */
apiManifestRoutes.get('/bundles/:typeId', requireAbility('read', 'Entity'), async (c) => {
  const typeId = c.req.param('typeId');
  const ifNoneMatch = c.req.header('If-None-Match'); // ETag from client
  console.log('[API] Getting bundle for authenticated user:', typeId, ifNoneMatch ? `(If-None-Match: ${ifNoneMatch})` : '');
  
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = c.get('userRole') === 'superadmin';
  const ability = c.get('ability');
  
  if (!userId || !ability) {
    throw new NotFoundError('Entity Bundle', typeId);
  }
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId), ability, 'read', 'EntityType');
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Get user's highest membership key
  const config = await loadAppConfig(c.env.R2_BUCKET);
  const highestKey = await getUserHighestMembershipKey(c.env.R2_BUCKET, userOrgId || null, isSuperadmin, config);
  
  // Check if type is visible to this key
  if (!entityType.visibleTo?.includes(highestKey)) {
    throw new NotFoundError('Entity Bundle', typeId);
  }
  
  // Read bundle with ETag metadata (public bundles don't require ability, but we have it)
  const bundlePath = getBundlePath(highestKey, typeId);
  const { data: bundle, etag } = await readJSONWithEtag<EntityBundle>(c.env.R2_BUCKET, bundlePath, ability);
  
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
      console.log('[API] Bundle ETag matches - returning 304 Not Modified:', typeId);
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
