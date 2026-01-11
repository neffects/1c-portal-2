/**
 * Manifest Routes
 * 
 * Handles manifest and bundle retrieval for client sync:
 * - GET /public - Get public site manifest
 * - GET /platform - Get platform manifest (auth required)
 * - GET /org/:orgId - Get organization manifest
 * - GET /bundles/:visibility/:typeId - Get entity bundle
 * - POST /sync - Sync check for updates
 * 
 * Note: Bundle/manifest regeneration on data changes is handled by
 * the centralized bundle-invalidation.ts service. This file only handles
 * lazy generation when a manifest/bundle is requested but doesn't exist yet.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { 
  readJSON, writeJSON, listFiles,
  getManifestPath, getBundlePath, getEntityTypePath, getOrgPermissionsPath
} from '../lib/r2';
import { optionalAuth, requireOrgMembership } from '../middleware/auth';
import { NotFoundError, ForbiddenError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { 
  SiteManifest, EntityBundle, ManifestEntityType, BundleEntity,
  EntityType, EntityTypePermissions, Entity, SyncRequest, SyncResponse
} from '@1cc/shared';

export const manifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /public
 * Get public site manifest (no auth required)
 */
manifestRoutes.get('/public', async (c) => {
  console.log('[Manifests] Getting public manifest');
  
  // Try to get cached manifest
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('public'));
  
  if (!manifest) {
    // Generate manifest if not exists
    manifest = await generateManifest(c.env.R2_BUCKET, 'public');
  }
  
  return c.json({
    success: true,
    data: manifest
  });
});

/**
 * GET /platform
 * Get platform manifest (auth required)
 */
manifestRoutes.get('/platform', optionalAuth, async (c) => {
  console.log('[Manifests] Getting platform manifest');
  
  const userId = c.get('userId');
  
  if (!userId) {
    // Return public manifest for unauthenticated users
    const publicManifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('public'));
    return c.json({
      success: true,
      data: publicManifest || { generatedAt: new Date().toISOString(), version: 0, entityTypes: [] }
    });
  }
  
  // Get authenticated (platform) manifest
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, getManifestPath('authenticated'));
  
  if (!manifest) {
    manifest = await generateManifest(c.env.R2_BUCKET, 'authenticated');
  }
  
  return c.json({
    success: true,
    data: manifest
  });
});

/**
 * GET /org/:orgId
 * Get organization-specific manifest
 */
manifestRoutes.get('/org/:orgId', requireOrgMembership('orgId'), async (c) => {
  const orgId = c.req.param('orgId');
  console.log('[Manifests] Getting org manifest:', orgId);
  
  // Get org-specific (members) manifest
  let manifest = await readJSON<SiteManifest>(
    c.env.R2_BUCKET, 
    getManifestPath('members', orgId)
  );
  
  if (!manifest) {
    manifest = await generateManifest(c.env.R2_BUCKET, 'members', orgId);
  }
  
  return c.json({
    success: true,
    data: manifest
  });
});

/**
 * GET /bundles/public/:typeId
 * Get public entity bundle
 */
manifestRoutes.get('/bundles/public/:typeId', async (c) => {
  const typeId = c.req.param('typeId');
  console.log('[Manifests] Getting public bundle:', typeId);
  
  let bundle = await readJSON<EntityBundle>(
    c.env.R2_BUCKET,
    getBundlePath('public', typeId)
  );
  
  if (!bundle) {
    bundle = await generateBundle(c.env.R2_BUCKET, 'public', typeId);
  }
  
  return c.json({
    success: true,
    data: bundle
  });
});

/**
 * GET /bundles/platform/:typeId
 * Get platform entity bundle (auth required)
 */
manifestRoutes.get('/bundles/platform/:typeId', optionalAuth, async (c) => {
  const typeId = c.req.param('typeId');
  const userId = c.get('userId');
  
  console.log('[Manifests] Getting platform bundle:', typeId);
  
  if (!userId) {
    throw new ForbiddenError('Authentication required for platform content');
  }
  
  let bundle = await readJSON<EntityBundle>(
    c.env.R2_BUCKET,
    getBundlePath('authenticated', typeId)
  );
  
  if (!bundle) {
    bundle = await generateBundle(c.env.R2_BUCKET, 'authenticated', typeId);
  }
  
  return c.json({
    success: true,
    data: bundle
  });
});

/**
 * GET /bundles/org/:orgId/:typeId
 * Get organization entity bundle
 */
manifestRoutes.get('/bundles/org/:orgId/:typeId', requireOrgMembership('orgId'), async (c) => {
  const orgId = c.req.param('orgId');
  const typeId = c.req.param('typeId');
  
  console.log('[Manifests] Getting org bundle:', orgId, typeId);
  
  // Check if org has access to this type
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET,
    getOrgPermissionsPath(orgId)
  );
  
  if (!permissions?.viewable.includes(typeId)) {
    throw new ForbiddenError('Organization does not have access to this entity type');
  }
  
  let bundle = await readJSON<EntityBundle>(
    c.env.R2_BUCKET,
    getBundlePath('members', typeId, orgId)
  );
  
  if (!bundle) {
    bundle = await generateBundle(c.env.R2_BUCKET, 'members', typeId, orgId);
  }
  
  return c.json({
    success: true,
    data: bundle
  });
});

/**
 * POST /sync
 * Check for updates and return changed manifests/bundles
 */
manifestRoutes.post('/sync', optionalAuth, async (c) => {
  console.log('[Manifests] Processing sync request');
  
  const body = await c.req.json() as SyncRequest;
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  
  const response: SyncResponse = {
    manifestUpdated: false,
    updatedBundles: [],
    removedTypes: []
  };
  
  // Determine which manifest to check (authenticated for logged-in users, public otherwise)
  const visibility = userId ? 'authenticated' : 'public';
  const manifestPath = getManifestPath(visibility);
  
  const currentManifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, manifestPath);
  
  if (!currentManifest) {
    // No manifest yet
    return c.json({
      success: true,
      data: response
    });
  }
  
  // Check if manifest version changed
  if (!body.manifestVersion || currentManifest.version > body.manifestVersion) {
    response.manifestUpdated = true;
    response.manifest = currentManifest;
  }
  
  // Check bundle versions
  if (body.bundleVersions) {
    for (const type of currentManifest.entityTypes) {
      const clientVersion = body.bundleVersions[type.id];
      
      if (!clientVersion || type.bundleVersion > clientVersion) {
        const bundle = await readJSON<EntityBundle>(
          c.env.R2_BUCKET,
          getBundlePath(visibility, type.id)
        );
        
        if (bundle) {
          response.updatedBundles.push(bundle);
        }
      }
    }
    
    // Check for removed types
    const currentTypeIds = new Set(currentManifest.entityTypes.map(t => t.id));
    for (const typeId of Object.keys(body.bundleVersions)) {
      if (!currentTypeIds.has(typeId)) {
        response.removedTypes.push(typeId);
      }
    }
  }
  
  console.log('[Manifests] Sync response:', {
    manifestUpdated: response.manifestUpdated,
    updatedBundles: response.updatedBundles.length,
    removedTypes: response.removedTypes.length
  });
  
  return c.json({
    success: true,
    data: response
  });
});

// Helper functions

/**
 * Generate site manifest for a visibility scope
 * Visibility: 'public' | 'authenticated' | 'members'
 */
async function generateManifest(
  bucket: R2Bucket,
  visibility: 'public' | 'authenticated' | 'members',
  orgId?: string
): Promise<SiteManifest> {
  console.log('[Manifests] Generating manifest for:', visibility, orgId || '');
  
  // Get all entity types
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  const entityTypes: ManifestEntityType[] = [];
  
  // Filter by org permissions for members-only manifests
  let allowedTypeIds: string[] | null = null;
  if (visibility === 'members' && orgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      bucket,
      getOrgPermissionsPath(orgId)
    );
    allowedTypeIds = permissions?.viewable || [];
  }
  
  for (const file of definitionFiles) {
    const entityType = await readJSON<EntityType>(bucket, file);
    if (!entityType || !entityType.isActive) continue;
    
    // Filter by permissions
    if (allowedTypeIds !== null && !allowedTypeIds.includes(entityType.id)) {
      continue;
    }
    
    // Count entities and get bundle version
    const bundlePath = getBundlePath(visibility, entityType.id, orgId);
    const bundle = await readJSON<EntityBundle>(bucket, bundlePath);
    
    entityTypes.push({
      id: entityType.id,
      name: entityType.name,
      pluralName: entityType.pluralName,
      slug: entityType.slug,
      description: entityType.description,
      entityCount: bundle?.entityCount || 0,
      bundleVersion: bundle?.version || 0,
      lastUpdated: bundle?.generatedAt || new Date().toISOString()
    });
  }
  
  const manifest: SiteManifest = {
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityTypes
  };
  
  // Save manifest
  const manifestPath = getManifestPath(visibility, orgId);
  await writeJSON(bucket, manifestPath, manifest);
  
  console.log('[Manifests] Generated manifest with', entityTypes.length, 'types');
  
  return manifest;
}

/**
 * Generate entity bundle for a type
 * Visibility: 'public' | 'authenticated' | 'members'
 */
async function generateBundle(
  bucket: R2Bucket,
  visibility: 'public' | 'authenticated' | 'members',
  typeId: string,
  orgId?: string
): Promise<EntityBundle> {
  console.log('[Manifests] Generating bundle for:', visibility, typeId, orgId || '');
  
  // Get entity type
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Determine entity path prefix based on visibility
  let entityPrefix: string;
  if (visibility === 'members' && orgId) {
    entityPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
  } else if (visibility === 'authenticated') {
    entityPrefix = `${R2_PATHS.PLATFORM}entities/`;
  } else {
    entityPrefix = `${R2_PATHS.PUBLIC}entities/`;
  }
  
  // List all entity directories
  const entityFiles = await listFiles(bucket, entityPrefix);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  const entities: BundleEntity[] = [];
  
  for (const latestFile of latestFiles) {
    // Get entity ID from path
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    
    // Read latest pointer
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile);
    if (!latestPointer) continue;
    
    // Only filter by status for public/authenticated bundles
    // Org (members) bundles include all statuses for admin visibility and duplicate checking
    if (visibility !== 'members' && latestPointer.status !== 'published') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    entities.push({
      id: entity.id,
      version: entity.version,
      status: entity.status,
      slug: entity.slug,
      data: entity.data,
      updatedAt: entity.updatedAt
    });
  }
  
  const bundle: EntityBundle = {
    typeId,
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityCount: entities.length,
    entities
  };
  
  // Save bundle
  const bundlePath = getBundlePath(visibility, typeId, orgId);
  await writeJSON(bucket, bundlePath, bundle);
  
  console.log('[Manifests] Generated bundle with', entities.length, 'entities');
  
  return bundle;
}

/**
 * Regenerate all manifests (utility function for bulk operations)
 * 
 * Note: For incremental updates triggered by data changes, use the
 * functions in bundle-invalidation.ts instead. This function is for
 * bulk regeneration scenarios like initial setup or data migration.
 */
export async function regenerateAllManifests(bucket: R2Bucket): Promise<void> {
  console.log('[Manifests] Regenerating all manifests');
  
  // Regenerate public manifest
  await generateManifest(bucket, 'public');
  
  // Regenerate authenticated (platform) manifest
  await generateManifest(bucket, 'authenticated');
  
  // Regenerate org (members) manifests
  const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
  const orgIds = new Set<string>();
  
  for (const dir of orgDirs) {
    const match = dir.match(/orgs\/([^\/]+)\//);
    if (match) orgIds.add(match[1]);
  }
  
  for (const orgId of orgIds) {
    await generateManifest(bucket, 'members', orgId);
  }
  
  console.log('[Manifests] Regenerated all manifests');
}
