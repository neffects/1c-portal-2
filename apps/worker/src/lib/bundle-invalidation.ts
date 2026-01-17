/**
 * Bundle Invalidation Service
 * 
 * Centralized service for regenerating bundles and manifests when entities change.
 * Uses config-driven membership keys for access control.
 * 
 * Bundle types:
 * - Global bundles: bundles/{keyId}/{typeId}.json (published entities, field-projected)
 * - Org member bundles: bundles/org/{orgId}/member/{typeId}.json (published only, all fields)
 * - Org admin bundles: bundles/org/{orgId}/admin/{typeId}.json (draft + deleted only, all fields)
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
  getBundlePath, getManifestPath, getEntityTypePath, getOrgPermissionsPath,
  getOrgMemberBundlePath, getOrgAdminBundlePath,
  getOrgMemberManifestPath, getOrgAdminManifestPath,
  getAppConfigPath
} from './r2';
import type { 
  Entity, EntityType, EntityBundle, BundleEntity,
  SiteManifest, ManifestEntityType, EntityTypePermissions,
  AppConfig, MembershipKeyId, MembershipKeyDefinition
} from '@1cc/shared';

/**
 * Load app config from R2
 * Caches in memory for performance (config rarely changes)
 * 
 * Ensures 'public' membership key is always present in the config.
 */
let cachedConfig: AppConfig | null = null;

export async function loadAppConfig(bucket: R2Bucket): Promise<AppConfig> {
  if (cachedConfig) {
    // Ensure public key exists in cached config too
    return ensurePublicKeyPresent(cachedConfig);
  }
  
  const config = await readJSON<AppConfig>(bucket, getAppConfigPath());
  if (!config) {
    throw new Error('App config not found');
  }
  
  // Ensure public key is always present
  const configWithPublic = ensurePublicKeyPresent(config);
  
  cachedConfig = configWithPublic;
  return configWithPublic;
}

/**
 * Ensure 'public' membership key is always present in config
 * Adds default public key if missing
 */
function ensurePublicKeyPresent(config: AppConfig): AppConfig {
  const hasPublic = config.membershipKeys?.keys?.some(k => k.id === 'public');
  
  if (!hasPublic) {
    console.log('[Config] Adding default public key to loaded config');
    const defaultPublicKey: MembershipKeyDefinition = {
      id: 'public',
      name: 'Public',
      description: 'Accessible to everyone without authentication',
      requiresAuth: false,
      order: 0
    };
    
    return {
      ...config,
      membershipKeys: {
        keys: [defaultPublicKey, ...(config.membershipKeys?.keys || [])],
        organizationTiers: config.membershipKeys?.organizationTiers || []
      }
    };
  }
  
  return config;
}

/**
 * Clear cached app config (useful for testing or config updates)
 */
export function clearAppConfigCache(): void {
  cachedConfig = null;
}

/**
 * Validate that an array of membership key IDs are valid (exist in config)
 * Returns array of invalid key IDs, or empty array if all valid
 */
export function validateMembershipKeyIds(
  keyIds: string[],
  config: AppConfig
): string[] {
  const validKeyIds = new Set(config.membershipKeys.keys.map(k => k.id));
  return keyIds.filter(keyId => !validKeyIds.has(keyId));
}

/**
 * Validate that a membership tier ID is valid (exists in config)
 * Returns true if valid, false otherwise
 */
export function validateMembershipTierId(
  tierId: string,
  config: AppConfig
): boolean {
  return config.membershipKeys.organizationTiers.some(t => t.id === tierId);
}

/**
 * Validate entityType.visibleTo references valid key IDs
 * Returns error message or null if valid
 */
export function validateVisibleTo(
  visibleTo: string[],
  config: AppConfig
): string | null {
  const invalidKeys = validateMembershipKeyIds(visibleTo, config);
  if (invalidKeys.length > 0) {
    return `Invalid membership key IDs in visibleTo: ${invalidKeys.join(', ')}. Valid keys are: ${config.membershipKeys.keys.map(k => k.id).join(', ')}`;
  }
  return null;
}

/**
 * Validate entityType.fieldVisibility references valid key IDs
 * Returns error message or null if valid
 */
export function validateFieldVisibility(
  fieldVisibility: Record<string, string[]> | undefined,
  config: AppConfig
): string | null {
  if (!fieldVisibility) return null;
  
  const allKeys = Object.values(fieldVisibility).flat();
  const invalidKeys = validateMembershipKeyIds(allKeys, config);
  if (invalidKeys.length > 0) {
    return `Invalid membership key IDs in fieldVisibility: ${invalidKeys.join(', ')}. Valid keys are: ${config.membershipKeys.keys.map(k => k.id).join(', ')}`;
  }
  return null;
}

/**
 * Get user's membership keys based on their organization tier
 * Returns array of key IDs the user has access to
 */
export async function getUserMembershipKeys(
  bucket: R2Bucket,
  organizationId: string | null,
  isSuperadmin: boolean,
  config: AppConfig
): Promise<MembershipKeyId[]> {
  // Everyone gets public key
  const keys: MembershipKeyId[] = ['public'];
  
  if (!isSuperadmin && organizationId) {
    // Get org to determine membership key
    const { getOrgProfilePath } = await import('./r2');
    const org = await readJSON<{ membershipKey?: string; membershipTier?: string }>(bucket, getOrgProfilePath(organizationId));
    
    // Use membershipKey if available, fall back to membershipTier for backward compatibility
    const orgKeyId = org?.membershipKey || org?.membershipTier;
    
    if (orgKeyId) {
      // Find the org's membership key
      const orgKey = config.membershipKeys.keys.find(k => k.id === orgKeyId);
      
      if (orgKey) {
        // User gets all keys up to and including their org's key (based on order)
        // This means if org has "member" key (order 2), user gets: public (0), platform (1), member (2)
        const orgOrder = orgKey.order;
        
        for (const keyDef of config.membershipKeys.keys) {
          // Include all keys with order <= org's key order
          if (keyDef.order <= orgOrder && !keys.includes(keyDef.id)) {
            keys.push(keyDef.id);
          }
        }
      }
    }
  } else if (isSuperadmin) {
    // Superadmins get all keys
    for (const keyDef of config.membershipKeys.keys) {
      if (!keys.includes(keyDef.id)) {
        keys.push(keyDef.id);
      }
    }
  }
  
  // Sort by order (higher order = more access)
  return keys.sort((a, b) => {
    const keyA = config.membershipKeys.keys.find(k => k.id === a);
    const keyB = config.membershipKeys.keys.find(k => k.id === b);
    return (keyB?.order || 0) - (keyA?.order || 0);
  });
}

/**
 * Get user's highest membership key (most privileged)
 */
export async function getUserHighestMembershipKey(
  bucket: R2Bucket,
  organizationId: string | null,
  isSuperadmin: boolean,
  config: AppConfig
): Promise<MembershipKeyId> {
  const keys = await getUserMembershipKeys(bucket, organizationId, isSuperadmin, config);
  return keys[0] || 'public';
}

// Legacy visibility scope for entity storage (entities still stored by old visibility)
type LegacyVisibility = 'public' | 'authenticated' | 'members';

/**
 * Project entity fields based on membership key visibility
 * Returns entity with only fields visible to the specified key
 * 
 * This is exported for use in entity GET endpoints
 */
export function projectFieldsForKey(
  entity: Entity,
  entityType: EntityType,
  keyId: MembershipKeyId,
  config: AppConfig
): Entity {
  // If no field visibility config, return all fields
  if (!entityType.fieldVisibility) {
    return entity;
  }

  // Get all fields visible to this key
  const visibleFieldIds = new Set<string>();
  
  // Add all fields that are visible to this key
  for (const [fieldId, visibleKeys] of Object.entries(entityType.fieldVisibility)) {
    if (visibleKeys.includes(keyId)) {
      visibleFieldIds.add(fieldId);
    }
  }

  // If type-level visibleTo includes this key, include fields without explicit visibility
  if (entityType.visibleTo?.includes(keyId)) {
    for (const field of entityType.fields) {
      // If field doesn't have explicit visibility, it's visible at type level
      if (!entityType.fieldVisibility[field.id]) {
        visibleFieldIds.add(field.id);
      }
    }
  }

  // Project the data object
  const projectedData: Record<string, unknown> = {};
  for (const fieldId of visibleFieldIds) {
    if (entity.data && fieldId in entity.data) {
      projectedData[fieldId] = entity.data[fieldId];
    }
  }

  return {
    ...entity,
    data: projectedData
  };
}

/**
 * Get legacy visibility scope from entity's current visibility setting
 * This maps old visibility values to determine where entities are stored
 */
function getLegacyVisibility(entity: Entity): LegacyVisibility {
  // Entities still use old visibility field for storage location
  // This will be migrated over time
  const visibility = (entity as any).visibility || 'authenticated';
  if (visibility === 'public') return 'public';
  if (visibility === 'members') return 'members';
  return 'authenticated';
}

/**
 * Regenerate all affected bundles when an entity changes
 * 
 * @param bucket - R2 bucket instance
 * @param entityTypeId - The entity type ID
 * @param organizationId - The organization ID (null for global entities)
 * @param config - App config with membership keys
 */
export async function regenerateEntityBundles(
  bucket: R2Bucket,
  entityTypeId: string,
  organizationId: string | null,
  config: AppConfig
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating bundles for entity change:', {
    entityTypeId,
    organizationId
  });

  try {
    // Load entity type to get visibility config
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId));
    if (!entityType) {
      throw new Error(`Entity type ${entityTypeId} not found`);
    }

    // Regenerate global bundles for each membership key in visibleTo
    const visibleTo = entityType.visibleTo;
    if (!visibleTo || !Array.isArray(visibleTo)) {
      console.warn('[BundleInvalidation] Entity type', entityTypeId, 'has invalid visibleTo:', visibleTo);
      // If no visibleTo, skip global bundle regeneration but continue with org bundles if needed
    } else {
      for (const keyId of visibleTo) {
        if (!keyId || typeof keyId !== 'string') {
          console.warn('[BundleInvalidation] Skipping invalid key ID:', keyId);
          continue;
        }
        
        const keyDef = config.membershipKeys.keys.find(k => k.id === keyId);
        if (!keyDef) {
          console.warn('[BundleInvalidation] Unknown membership key:', keyId);
          continue;
        }
        
        console.log('[BundleInvalidation] Regenerating global bundle for key:', keyId);
        await regenerateGlobalBundle(bucket, keyId, entityTypeId, entityType, config);
      }
    }

    // Regenerate org bundles if entity is org-scoped
    if (organizationId) {
      console.log('[BundleInvalidation] Regenerating org bundles for:', organizationId);
      await regenerateOrgBundlesForType(bucket, organizationId, entityTypeId, entityType);
    }

    console.log('[BundleInvalidation] Bundle regeneration complete');
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating bundles:', error);
    throw error;
  }
}

/**
 * Regenerate a global bundle for a specific membership key
 */
async function regenerateGlobalBundle(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  typeId: string,
  entityType: EntityType,
  config: AppConfig
): Promise<EntityBundle> {
  console.log('[BundleInvalidation] Generating global bundle:', keyId, typeId);
  
  // Find all entities of this type across all orgs
  // Entities are stored in public/, platform/, or private/orgs/{orgId}/ based on visibility
  const entities: BundleEntity[] = [];
  
  // Check public entities
  const publicPrefix = `${R2_PATHS.PUBLIC}entities/`;
  await collectEntitiesFromPrefix(bucket, publicPrefix, typeId, keyId, entityType, config, entities);
  
  // Check platform entities
  const platformPrefix = `${R2_PATHS.PLATFORM}entities/`;
  await collectEntitiesFromPrefix(bucket, platformPrefix, typeId, keyId, entityType, config, entities);
  
  // Check org entities (only if they have visibility that includes this key)
  if (entityType.visibleTo?.includes(keyId)) {
    const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
    const orgIds = new Set<string>();
    for (const dir of orgDirs) {
      const match = dir.match(/orgs\/([^\/]+)\//);
      if (match) orgIds.add(match[1]);
    }
    
    for (const orgId of orgIds) {
      const orgPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
      await collectEntitiesFromPrefix(bucket, orgPrefix, typeId, keyId, entityType, config, entities);
    }
  }
  
  // Create bundle - NOTE: Use typeId (NOT entityTypeId) to identify the entity type
  const bundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityCount: entities.length,
    entities
  };
  
  // Save bundle
  const bundlePath = getBundlePath(keyId, typeId);
  await writeJSON(bucket, bundlePath, bundle);
  
  console.log('[BundleInvalidation] Generated global bundle with', entities.length, 'entities at:', bundlePath);
  
  // Update manifest
  await updateGlobalManifestForBundle(bucket, keyId, typeId, bundle, config);
  
  return bundle;
}

/**
 * Collect entities from a prefix, filter by status and project fields
 */
async function collectEntitiesFromPrefix(
  bucket: R2Bucket,
  prefix: string,
  typeId: string,
  keyId: MembershipKeyId,
  entityType: EntityType,
  config: AppConfig,
  output: BundleEntity[]
): Promise<void> {
  const entityFiles = await listFiles(bucket, prefix);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  for (const latestFile of latestFiles) {
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile);
    if (!latestPointer) continue;
    
    // Global bundles only include published entities
    if (latestPointer.status !== 'published') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    // Project fields for this membership key
    const projectedEntity = projectFieldsForKey(entity, entityType, keyId, config);
    
    // Create bundle entity - NOTE: Do NOT include entityTypeId
    // The entity type is identified by the parent bundle's typeId field
    output.push({
      id: projectedEntity.id,
      status: projectedEntity.status,
      name: projectedEntity.name, // Top-level property
      slug: projectedEntity.slug, // Top-level property
      data: projectedEntity.data, // Dynamic fields only (does NOT include entityTypeId)
      updatedAt: projectedEntity.updatedAt
    });
  }
}

/**
 * Regenerate org bundles (member and admin) for a specific type
 */
async function regenerateOrgBundlesForType(
  bucket: R2Bucket,
  orgId: string,
  typeId: string,
  entityType: EntityType
): Promise<void> {
  console.log('[BundleInvalidation] Generating org bundles:', orgId, typeId);
  
  const orgPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
  const entityFiles = await listFiles(bucket, orgPrefix);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  const memberEntities: BundleEntity[] = [];
  const adminEntities: BundleEntity[] = [];
  
  for (const latestFile of latestFiles) {
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile);
    if (!latestPointer) continue;
    
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    // Create bundle entity - NOTE: Do NOT include entityTypeId
    // The entity type is identified by the parent bundle's typeId field
    // Name and slug are top-level properties
    const bundleEntity: BundleEntity = {
      id: entity.id,
      status: entity.status,
      name: entity.name || `Entity ${entity.id}`,
      slug: entity.slug || '',
      data: entity.data, // Dynamic fields only (does NOT include entityTypeId)
      updatedAt: entity.updatedAt
    };
    
    // Member bundle: Published only
    if (entity.status === 'published') {
      memberEntities.push(bundleEntity);
    }
    
    // Admin bundle: Draft + Deleted only
    if (entity.status === 'draft' || entity.status === 'deleted') {
      adminEntities.push(bundleEntity);
    }
  }
  
  // Save member bundle - NOTE: Use typeId (NOT entityTypeId)
  const memberBundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityCount: memberEntities.length,
    entities: memberEntities
  };
  await writeJSON(bucket, getOrgMemberBundlePath(orgId, typeId), memberBundle);
  console.log('[BundleInvalidation] Generated org member bundle with', memberEntities.length, 'entities');
  
  // Save admin bundle - NOTE: Use typeId (NOT entityTypeId)
  const adminBundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityCount: adminEntities.length,
    entities: adminEntities
  };
  await writeJSON(bucket, getOrgAdminBundlePath(orgId, typeId), adminBundle);
  console.log('[BundleInvalidation] Generated org admin bundle with', adminEntities.length, 'entities');
  
  // Update org manifests
  await updateOrgManifestForBundle(bucket, orgId, typeId, memberBundle, 'member');
  await updateOrgManifestForBundle(bucket, orgId, typeId, adminBundle, 'admin');
}

/**
 * Update global manifest after a bundle changes
 */
async function updateGlobalManifestForBundle(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  typeId: string,
  bundle: EntityBundle,
  config: AppConfig
): Promise<void> {
  console.log('[BundleInvalidation] Updating global manifest for key:', keyId);
  
  const manifestPath = getManifestPath(keyId);
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found for manifest update:', typeId);
    return;
  }
  
  // Only include if this type is visible to this key
  if (!entityType.visibleTo?.includes(keyId)) {
    // Remove from manifest if it exists
    manifest.entityTypes = manifest.entityTypes.filter(t => t.id !== typeId);
  } else {
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
  }
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest);
  console.log('[BundleInvalidation] Global manifest updated at:', manifestPath);
}

/**
 * Update org manifest after a bundle changes
 */
async function updateOrgManifestForBundle(
  bucket: R2Bucket,
  orgId: string,
  typeId: string,
  bundle: EntityBundle,
  role: 'member' | 'admin'
): Promise<void> {
  console.log('[BundleInvalidation] Updating org manifest:', orgId, role);
  
  const manifestPath = role === 'admin' 
    ? getOrgAdminManifestPath(orgId)
    : getOrgMemberManifestPath(orgId);
  
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found for manifest update:', typeId);
    return;
  }
  
  // Check if org has access to this type
  const permissions = await readJSON<EntityTypePermissions>(
    bucket,
    getOrgPermissionsPath(orgId)
  );
  
  if (!permissions?.viewable.includes(typeId)) {
    // Remove from manifest if it exists
    manifest.entityTypes = manifest.entityTypes.filter(t => t.id !== typeId);
  } else {
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
  }
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest);
  console.log('[BundleInvalidation] Org manifest updated at:', manifestPath);
}

/**
 * Regenerate all manifests for an entity type
 * Called when entity type metadata changes (name, slug, description, visibleTo, fieldVisibility)
 * 
 * @param bucket - R2 bucket instance
 * @param entityTypeId - The entity type ID that changed
 * @param config - App config with membership keys
 */
export async function regenerateManifestsForType(
  bucket: R2Bucket,
  entityTypeId: string,
  config: AppConfig
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating all manifests for type:', entityTypeId);
  
  try {
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId));
    if (!entityType) {
      throw new Error(`Entity type ${entityTypeId} not found`);
    }
    
    console.log('[BundleInvalidation] Entity type visibleTo:', entityType.visibleTo, 'isActive:', entityType.isActive);
    
    // Regenerate global manifests for each membership key
    console.log('[BundleInvalidation] Regenerating global manifests for', config.membershipKeys.keys.length, 'membership keys');
    for (const keyDef of config.membershipKeys.keys) {
      console.log('[BundleInvalidation] Regenerating manifest for key:', keyDef.id);
      const manifest = await regenerateGlobalManifest(bucket, keyDef.id, config);
      const typeInManifest = manifest.entityTypes.find(t => t.id === entityTypeId);
      if (typeInManifest) {
        console.log('[BundleInvalidation] Type', entityTypeId, 'is included in', keyDef.id, 'manifest');
      } else {
        console.log('[BundleInvalidation] Type', entityTypeId, 'is NOT included in', keyDef.id, 'manifest (not visible to this key)');
      }
    }
    
    // Regenerate all org manifests that have this type in their permissions
    console.log('[BundleInvalidation] Regenerating org manifests for type:', entityTypeId);
    await regenerateAllOrgManifestsWithType(bucket, entityTypeId);
    
    console.log('[BundleInvalidation] All manifests regenerated for type:', entityTypeId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating manifests for type:', entityTypeId, error);
    throw error;
  }
}

/**
 * Regenerate a global manifest for a specific membership key
 */
async function regenerateGlobalManifest(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  config: AppConfig
): Promise<SiteManifest> {
  console.log('[BundleInvalidation] Generating global manifest for key:', keyId);
  
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  console.log('[BundleInvalidation] Found', definitionFiles.length, 'definition files to check');
  
  const entityTypes: ManifestEntityType[] = [];
  
  for (const file of definitionFiles) {
    try {
      // Verify file actually exists before trying to read it
      // This handles R2 eventual consistency where listFiles might return deleted files
      const fileHead = await bucket.head(file);
      if (!fileHead) {
        console.log('[BundleInvalidation] File no longer exists (was deleted), skipping:', file);
        continue;
      }
      
      const entityType = await readJSON<EntityType>(bucket, file);
      // Skip if file doesn't exist, is null, or is inactive
      if (!entityType || !entityType.isActive) {
        console.log('[BundleInvalidation] Skipping entity type (missing or inactive):', file);
        continue;
      }
      
      // Only include types visible to this key
      if (!entityType.visibleTo?.includes(keyId)) continue;
      
      // Get bundle for count and version info
      const bundlePath = getBundlePath(keyId, entityType.id);
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
    } catch (err) {
      // Skip files that can't be read (deleted, corrupted, etc.)
      console.warn('[BundleInvalidation] Error reading entity type file, skipping:', file, err instanceof Error ? err.message : err);
      continue;
    }
  }
  
  const manifest: SiteManifest = {
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityTypes
  };
  
  const manifestPath = getManifestPath(keyId);
  await writeJSON(bucket, manifestPath, manifest);
  
  console.log('[BundleInvalidation] Generated global manifest with', entityTypes.length, 'types at:', manifestPath);
  
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
  
  const permissionFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}policies/organizations/`);
  const jsonFiles = permissionFiles.filter(f => f.endsWith('/entity-type-permissions.json'));
  
  for (const file of jsonFiles) {
    const permissions = await readJSON<EntityTypePermissions>(bucket, file);
    
    if (permissions && permissions.viewable?.includes(entityTypeId)) {
      console.log('[BundleInvalidation] Regenerating manifests for org:', permissions.organizationId);
      await regenerateOrgManifest(bucket, permissions.organizationId);
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
    // Regenerate both member and admin manifests
    await regenerateOrgManifestForRole(bucket, orgId, 'member');
    await regenerateOrgManifestForRole(bucket, orgId, 'admin');
    console.log('[BundleInvalidation] Org manifests regenerated:', orgId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating org manifest:', error);
    throw error;
  }
}

/**
 * Regenerate org manifest for a specific role (member or admin)
 */
async function regenerateOrgManifestForRole(
  bucket: R2Bucket,
  orgId: string,
  role: 'member' | 'admin'
): Promise<SiteManifest> {
  console.log('[BundleInvalidation] Generating org manifest:', orgId, role);
  
  const permissions = await readJSON<EntityTypePermissions>(
    bucket,
    getOrgPermissionsPath(orgId)
  );
  
  const allowedTypeIds = permissions?.viewable || [];
  
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  console.log('[BundleInvalidation] Found', definitionFiles.length, 'definition files to check for org manifest');
  
  const entityTypes: ManifestEntityType[] = [];
  
  for (const file of definitionFiles) {
    try {
      // Verify file actually exists before trying to read it
      // This handles R2 eventual consistency where listFiles might return deleted files
      const fileHead = await bucket.head(file);
      if (!fileHead) {
        console.log('[BundleInvalidation] File no longer exists (was deleted), skipping:', file);
        continue;
      }
      
      const entityType = await readJSON<EntityType>(bucket, file);
      // Skip if file doesn't exist, is null, or is inactive
      if (!entityType || !entityType.isActive) {
        console.log('[BundleInvalidation] Skipping entity type (missing or inactive):', file);
        continue;
      }
      
      // Filter by permissions
      if (!allowedTypeIds.includes(entityType.id)) continue;
      
      // Get bundle for count and version info
      const bundlePath = role === 'admin'
        ? getOrgAdminBundlePath(orgId, entityType.id)
        : getOrgMemberBundlePath(orgId, entityType.id);
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
    } catch (err) {
      // Skip files that can't be read (deleted, corrupted, etc.)
      console.warn('[BundleInvalidation] Error reading entity type file, skipping:', file, err instanceof Error ? err.message : err);
      continue;
    }
  }
  
  const manifest: SiteManifest = {
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityTypes
  };
  
  const manifestPath = role === 'admin'
    ? getOrgAdminManifestPath(orgId)
    : getOrgMemberManifestPath(orgId);
  await writeJSON(bucket, manifestPath, manifest);
  
  console.log('[BundleInvalidation] Generated org manifest with', entityTypes.length, 'types at:', manifestPath);
  
  return manifest;
}

/**
 * Regenerate all bundles for an organization when permissions change
 * This ensures bundles exist for all types the org can now view
 * 
 * @param bucket - R2 bucket instance
 * @param orgId - The organization ID
 * @param viewableTypeIds - The list of entity type IDs the org can view
 * @param config - App config with membership keys
 */
export async function regenerateOrgBundles(
  bucket: R2Bucket,
  orgId: string,
  viewableTypeIds: string[],
  config: AppConfig
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org bundles for:', orgId, 'types:', viewableTypeIds.length);
  
  try {
    for (const typeId of viewableTypeIds) {
      const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
      if (!entityType) continue;
      
      await regenerateOrgBundlesForType(bucket, orgId, typeId, entityType);
    }
    
    // Also regenerate the org manifests
    await regenerateOrgManifest(bucket, orgId);
    
    console.log('[BundleInvalidation] All org bundles regenerated for:', orgId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating org bundles:', error);
    throw error;
  }
}

/**
 * Regenerate all manifests after an entity type is deleted
 * This ensures all manifests (global and org) reflect the deletion
 * 
 * @param bucket - R2 bucket instance
 * @param config - App config with membership keys
 */
export async function regenerateAllManifests(
  bucket: R2Bucket,
  config: AppConfig
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating all manifests after type deletion');
  
  try {
    // Regenerate global manifests for each membership key
    // These functions list entity type files, so deleted types won't be included
    // Note: Due to R2 eventual consistency, listFiles may temporarily return deleted files,
    // but readJSON will return null for non-existent files and they'll be skipped
    for (const keyDef of config.membershipKeys.keys) {
      console.log('[BundleInvalidation] Regenerating global manifest for key:', keyDef.id);
      const manifest = await regenerateGlobalManifest(bucket, keyDef.id, config);
      console.log('[BundleInvalidation] Regenerated manifest for key', keyDef.id, 'with', manifest.entityTypes.length, 'types:', manifest.entityTypes.map(t => t.id).join(', '));
    }
    
    // Regenerate all org manifests
    // List all org permission files and regenerate each org's manifest
    const permissionFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}policies/organizations/`);
    const jsonFiles = permissionFiles.filter(f => f.endsWith('/entity-type-permissions.json'));
    
    console.log('[BundleInvalidation] Found', jsonFiles.length, 'org permission files to process');
    
    for (const file of jsonFiles) {
      try {
        const permissions = await readJSON<EntityTypePermissions>(bucket, file);
        if (permissions && permissions.organizationId) {
          console.log('[BundleInvalidation] Regenerating manifest for org:', permissions.organizationId);
          await regenerateOrgManifest(bucket, permissions.organizationId);
        }
      } catch (err) {
        console.error('[BundleInvalidation] Error regenerating org manifest from file:', file, err);
        // Continue with other orgs even if one fails
      }
    }
    
    console.log('[BundleInvalidation] All manifests regenerated after type deletion');
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating all manifests:', error);
    throw error;
  }
}
