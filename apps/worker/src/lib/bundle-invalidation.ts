/**
 * Bundle Invalidation Service
 * 
 * Centralized service for regenerating bundles and manifests when entities change.
 * Called synchronously from entity routes to ensure consistency.
 * 
 * Bundle types:
 * - public: Published entities with public visibility
 * - authenticated: Published entities with public or authenticated visibility
 * - members (org): ALL entities (any status) for a specific organization
 * 
 * Regeneration triggers:
 * - Entity create/update/delete
 * - Entity status transitions (publish/unpublish)
 * - Entity type create/update
 * - Organization permission changes
 */

import { R2_PATHS } from '@1cc/shared';
import { 
  readJSON, writeJSON, listFiles,
  getBundlePath, getManifestPath, getEntityTypePath, getOrgPermissionsPath
} from './r2';
import type { 
  Entity, EntityType, EntityBundle, BundleEntity,
  SiteManifest, ManifestEntityType, EntityTypePermissions
} from '@1cc/shared';

// Type alias for visibility scopes
type VisibilityScope = 'public' | 'authenticated' | 'members';

/**
 * Regenerate all affected bundles when an entity changes
 * 
 * This determines which bundles need updating based on:
 * - Entity visibility (public, authenticated, members)
 * - Entity organization (org-scoped vs global)
 * - Entity status for non-org bundles (only published entities)
 * 
 * @param bucket - R2 bucket instance
 * @param entityTypeId - The entity type ID
 * @param organizationId - The organization ID (null for global entities)
 * @param visibility - The entity's visibility scope
 */
export async function regenerateEntityBundles(
  bucket: R2Bucket,
  entityTypeId: string,
  organizationId: string | null,
  visibility: VisibilityScope
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating bundles for entity change:', {
    entityTypeId,
    organizationId,
    visibility
  });

  try {
    // Always regenerate org bundle if entity is org-scoped
    // Org bundles include ALL statuses for admin visibility
    if (organizationId) {
      console.log('[BundleInvalidation] Regenerating org bundle for:', organizationId);
      await regenerateBundle(bucket, 'members', entityTypeId, organizationId);
    }

    // For public visibility entities, update public and authenticated bundles
    // These only include published entities
    if (visibility === 'public') {
      console.log('[BundleInvalidation] Regenerating public bundle');
      await regenerateBundle(bucket, 'public', entityTypeId);
      console.log('[BundleInvalidation] Regenerating authenticated bundle');
      await regenerateBundle(bucket, 'authenticated', entityTypeId);
    }
    
    // For authenticated visibility entities, only update authenticated bundle
    if (visibility === 'authenticated') {
      console.log('[BundleInvalidation] Regenerating authenticated bundle');
      await regenerateBundle(bucket, 'authenticated', entityTypeId);
    }

    console.log('[BundleInvalidation] Bundle regeneration complete');
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating bundles:', error);
    // Re-throw to ensure callers are aware of failures
    throw error;
  }
}

/**
 * Regenerate a single bundle for a specific visibility/type/org combination
 */
async function regenerateBundle(
  bucket: R2Bucket,
  visibility: VisibilityScope,
  typeId: string,
  orgId?: string
): Promise<EntityBundle> {
  console.log('[BundleInvalidation] Generating bundle:', visibility, typeId, orgId || 'global');
  
  // Get entity type for bundle metadata
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found:', typeId);
    throw new Error(`Entity type ${typeId} not found`);
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
  
  console.log('[BundleInvalidation] Found', latestFiles.length, 'entities in prefix:', entityPrefix);
  
  const entities: BundleEntity[] = [];
  
  for (const latestFile of latestFiles) {
    // Get entity ID from path
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    
    // Read latest pointer
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile);
    if (!latestPointer) continue;
    
    // For public/authenticated bundles, only include published entities
    // For members (org) bundles, include ALL statuses for admin visibility and duplicate checking
    if (visibility !== 'members' && latestPointer.status !== 'published') {
      continue;
    }
    
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
  
  console.log('[BundleInvalidation] Generated bundle with', entities.length, 'entities at:', bundlePath);
  
  // Also update the corresponding manifest
  await updateManifestForBundle(bucket, visibility, typeId, bundle, orgId);
  
  return bundle;
}

/**
 * Update the manifest after a bundle changes
 */
async function updateManifestForBundle(
  bucket: R2Bucket,
  visibility: VisibilityScope,
  typeId: string,
  bundle: EntityBundle,
  orgId?: string
): Promise<void> {
  console.log('[BundleInvalidation] Updating manifest for:', visibility, orgId || 'global');
  
  const manifestPath = getManifestPath(visibility, orgId);
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  // Get entity type for manifest entry
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found for manifest update:', typeId);
    return;
  }
  
  // Update or add the entity type entry
  const existingIndex = manifest.entityTypes.findIndex(t => t.id === typeId);
  const typeEntry: ManifestEntityType = {
    id: entityType.id,
    name: entityType.name,
    pluralName: entityType.pluralName,
    slug: entityType.slug,
    description: entityType.description,
    entityCount: bundle.entityCount,
    bundleVersion: bundle.version,
    lastUpdated: bundle.generatedAt
  };
  
  if (existingIndex >= 0) {
    manifest.entityTypes[existingIndex] = typeEntry;
  } else {
    manifest.entityTypes.push(typeEntry);
  }
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest);
  console.log('[BundleInvalidation] Manifest updated at:', manifestPath);
}

/**
 * Regenerate all manifests for an entity type
 * Called when entity type metadata changes (name, slug, description)
 * 
 * @param bucket - R2 bucket instance
 * @param entityTypeId - The entity type ID that changed
 */
export async function regenerateManifestsForType(
  bucket: R2Bucket,
  entityTypeId: string
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating all manifests for type:', entityTypeId);
  
  try {
    // Regenerate public manifest
    await regenerateManifest(bucket, 'public');
    
    // Regenerate authenticated (platform) manifest
    await regenerateManifest(bucket, 'authenticated');
    
    // Regenerate all org manifests that have this type in their permissions
    await regenerateAllOrgManifestsWithType(bucket, entityTypeId);
    
    console.log('[BundleInvalidation] All manifests regenerated for type:', entityTypeId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating manifests for type:', error);
    throw error;
  }
}

/**
 * Regenerate a manifest for a specific visibility scope
 */
async function regenerateManifest(
  bucket: R2Bucket,
  visibility: 'public' | 'authenticated' | 'members',
  orgId?: string
): Promise<SiteManifest> {
  console.log('[BundleInvalidation] Generating manifest for:', visibility, orgId || 'global');
  
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
    
    // Filter by permissions for org manifests
    if (allowedTypeIds !== null && !allowedTypeIds.includes(entityType.id)) {
      continue;
    }
    
    // Get bundle for count and version info
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
  
  console.log('[BundleInvalidation] Generated manifest with', entityTypes.length, 'types at:', manifestPath);
  
  return manifest;
}

/**
 * Regenerate all org manifests that include a specific entity type
 */
async function regenerateAllOrgManifestsWithType(
  bucket: R2Bucket,
  entityTypeId: string
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org manifests with type:', entityTypeId);
  
  // Find all org permissions files
  const permissionFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}policies/organizations/`);
  const jsonFiles = permissionFiles.filter(f => f.endsWith('/entity-type-permissions.json'));
  
  for (const file of jsonFiles) {
    const permissions = await readJSON<EntityTypePermissions>(bucket, file);
    
    // Only regenerate if this org can view the type
    if (permissions && permissions.viewable.includes(entityTypeId)) {
      console.log('[BundleInvalidation] Regenerating manifest for org:', permissions.organizationId);
      await regenerateManifest(bucket, 'members', permissions.organizationId);
    }
  }
}

/**
 * Regenerate the manifest for a specific organization
 * Called when organization permissions change
 * 
 * @param bucket - R2 bucket instance
 * @param orgId - The organization ID
 */
export async function regenerateOrgManifest(
  bucket: R2Bucket,
  orgId: string
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org manifest for:', orgId);
  
  try {
    await regenerateManifest(bucket, 'members', orgId);
    console.log('[BundleInvalidation] Org manifest regenerated:', orgId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating org manifest:', error);
    throw error;
  }
}

/**
 * Regenerate all bundles for an organization when permissions change
 * This ensures bundles exist for all types the org can now view
 * 
 * @param bucket - R2 bucket instance
 * @param orgId - The organization ID
 * @param viewableTypeIds - The list of entity type IDs the org can view
 */
export async function regenerateOrgBundles(
  bucket: R2Bucket,
  orgId: string,
  viewableTypeIds: string[]
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org bundles for:', orgId, 'types:', viewableTypeIds.length);
  
  try {
    for (const typeId of viewableTypeIds) {
      await regenerateBundle(bucket, 'members', typeId, orgId);
    }
    
    // Also regenerate the org manifest
    await regenerateManifest(bucket, 'members', orgId);
    
    console.log('[BundleInvalidation] All org bundles regenerated for:', orgId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating org bundles:', error);
    throw error;
  }
}
