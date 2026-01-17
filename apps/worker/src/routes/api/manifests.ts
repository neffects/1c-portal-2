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
import { getUserHighestMembershipKey, loadAppConfig } from '../../lib/bundle-invalidation';
import type { SiteManifest, EntityBundle, EntityType } from '@1cc/shared';

export const apiManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get manifest for user's highest membership key (authenticated users)
 */
apiManifestRoutes.get('/manifests/site', async (c) => {
  console.log('[API] Getting manifest for authenticated user');
  
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = c.get('userRole') === 'superadmin';
  
  if (!userId) {
    // Fallback to public for unauthenticated (shouldn't happen with auth middleware)
    const manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('public'));
    return c.json({
      success: true,
      data: manifest || { generatedAt: new Date().toISOString(), version: 0, entityTypes: [] }
    });
  }
  
  // Get user's highest membership key
  const config = await loadAppConfig(c.env.R2_BUCKET);
  const highestKey = await getUserHighestMembershipKey(c.env.R2_BUCKET, userOrgId || null, isSuperadmin, config);
  
  console.log('[API] User highest membership key:', highestKey);
  
  // Get manifest for that key
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath(highestKey));
  
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
 */
apiManifestRoutes.get('/bundles/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  console.log('[API] Getting bundle for authenticated user:', typeId);
  
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = c.get('userRole') === 'superadmin';
  
  if (!userId) {
    throw new NotFoundError('Entity Bundle', typeId);
  }
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
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
  
  let bundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, getBundlePath(highestKey, typeId));
  
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
