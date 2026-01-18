/**
 * Bundle Invalidation Service
 * 
 * Centralized service for regenerating bundles and manifests when entities change.
 * Uses config-driven membership keys for access control.
 * 
 * Bundle types:
 * - Global bundles: bundles/{keyId}/{typeId}.json (published entities, field-projected)
 * - Org member bundles: bundles/org/{orgId}/member/{typeId}.json (published only, all fields)
 * - Org admin bundles: bundles/org/{orgId}/admin/{typeId}.json (draft + pending + deleted, all fields)
 * 
 * Regeneration triggers:
 * - Entity create/update/delete
 * - Entity status transitions (publish/unpublish)
 * - Entity type create/update
 * - Organization permission changes
 */

import { R2_PATHS } from '@1cc/shared';
import { 
  readJSON, writeJSON, listFiles, headFile,
  getBundlePath, getManifestPath, getEntityTypePath, getOrgPermissionsPath,
  getOrgMemberBundlePath, getOrgAdminBundlePath, getGlobalAdminBundlePath,
  getOrgMemberManifestPath, getOrgAdminManifestPath,
  getAppConfigPath,
  getEntityStubPath
} from './r2';
import type { AppAbility } from './abilities';
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
 * Auto-creates default config if missing (for fresh deployments).
 */
let cachedConfig: AppConfig | null = null;

export async function loadAppConfig(bucket: R2Bucket, ability: AppAbility | null = null): Promise<AppConfig> {
  if (cachedConfig) {
    // Ensure public key exists in cached config too
    return ensurePublicKeyPresent(cachedConfig);
  }
  
  // Config paths are system paths - allow null ability (with warning in r2-casl)
  let config = await readJSON<AppConfig>(bucket, getAppConfigPath(), ability);
  
  if (!config) {
    // Auto-initialize default config if missing
    console.warn('[Config] App config not found in R2, auto-creating default config');
    console.warn('[Config] This is expected on first run but should not happen in production');
    config = createDefaultAppConfig();
    await writeJSON(bucket, getAppConfigPath(), config, ability);
    console.log('[Config] Default app config created at:', getAppConfigPath());
  }
  
  // Ensure public key is always present
  const configWithPublic = ensurePublicKeyPresent(config);
  
  cachedConfig = configWithPublic;
  return configWithPublic;
}

/**
 * Create default app config for auto-initialization
 * Matches the structure in apps/worker/src/config/app.json
 */
function createDefaultAppConfig(): AppConfig {
  return {
    version: '1.0.0',
    environment: 'development',
    apiBaseUrl: 'http://localhost:8787',
    r2PublicUrl: 'http://localhost:8787/assets',
    features: {
      alerts: true,
      offlineMode: true,
      realtime: false,
      darkMode: true
    },
    branding: {
      rootOrgId: 'root001',
      siteName: '1C Portal',
      defaultTheme: 'light',
      logoUrl: '/logo.svg'
    },
    sync: {
      bundleRefreshInterval: 300000,
      staleTime: 60000,
      gcTime: 86400000
    },
    auth: {
      magicLinkExpiry: 600,
      sessionDuration: 604800
    },
    membershipKeys: {
      keys: [
        {
          id: 'public',
          name: 'Public',
          description: 'Accessible to everyone without authentication',
          requiresAuth: false,
          order: 0
        },
        {
          id: 'platform',
          name: 'Platform',
          description: 'All authenticated platform users',
          requiresAuth: true,
          order: 1
        },
        {
          id: 'member',
          name: 'Member',
          description: 'Full member organization users',
          requiresAuth: true,
          order: 2
        }
      ],
      organizationTiers: [
        {
          id: 'platform',
          name: 'Platform Tier',
          grantedKeys: ['public', 'platform']
        },
        {
          id: 'full_member',
          name: 'Full Member',
          grantedKeys: ['public', 'platform', 'member']
        }
      ]
    }
  };
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
 * @param ability - User's CASL ability (required for R2 access)
 */
export async function regenerateEntityBundles(
  bucket: R2Bucket,
  entityTypeId: string,
  organizationId: string | null,
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating bundles for entity change:', {
    entityTypeId,
    organizationId
  });

  try {
    // Load entity type to get visibility config
    // Entity types are system/public paths - allow null ability (with warning)
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId), ability);
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
        await regenerateGlobalBundle(bucket, keyId, entityTypeId, entityType, config, ability);
        
        // Also regenerate admin bundle (draft + pending + archived + deleted entities)
        // Admin bundles include all draft/pending/archived/deleted entities regardless of visibility
        console.log('[BundleInvalidation] Regenerating global admin bundle for key:', keyId);
        await regenerateGlobalAdminBundle(bucket, keyId, entityTypeId, entityType, ability);
      }
    }

    // Regenerate org bundles if entity is org-scoped
    if (organizationId) {
      console.log('[BundleInvalidation] Regenerating org bundles for:', organizationId);
      await regenerateOrgBundlesForType(bucket, organizationId, entityTypeId, entityType, ability);
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
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<EntityBundle> {
  console.log('[BundleInvalidation] Generating global bundle:', keyId, typeId);
  
  // Find all entities of this type across all orgs
  // Entities are stored in public/, platform/, or private/orgs/{orgId}/ based on visibility
  const entities: BundleEntity[] = [];
  
  // Check public entities
  const publicPrefix = `${R2_PATHS.PUBLIC}entities/`;
  await collectEntitiesFromPrefix(bucket, publicPrefix, typeId, keyId, entityType, config, entities, ability);
  
  // Check platform entities
  const platformPrefix = `${R2_PATHS.PLATFORM}entities/`;
  await collectEntitiesFromPrefix(bucket, platformPrefix, typeId, keyId, entityType, config, entities, ability);
  
  // Check org entities (only if they have visibility that includes this key)
  if (entityType.visibleTo?.includes(keyId)) {
    const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`, ability);
    const orgIds = new Set<string>();
    for (const dir of orgDirs) {
      const match = dir.match(/orgs\/([^\/]+)\//);
      if (match) orgIds.add(match[1]);
    }
    
    for (const orgId of orgIds) {
      const orgPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
      await collectEntitiesFromPrefix(bucket, orgPrefix, typeId, keyId, entityType, config, entities, ability);
    }
  }
  
  // Create bundle - NOTE: Use typeId (NOT entityTypeId) to identify the entity type
  // Bundles don't have versions - change detection uses HTTP ETags
  const bundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    entityCount: entities.length,
    entities
  };
  
  // Save bundle
  const bundlePath = getBundlePath(keyId, typeId);
  await writeJSON(bucket, bundlePath, bundle, ability);
  
  console.log('[BundleInvalidation] Generated global bundle with', entities.length, 'entities at:', bundlePath);
  
  // Update manifest
  await updateGlobalManifestForBundle(bucket, keyId, typeId, bundle, config, ability);
  
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
  output: BundleEntity[],
  ability: AppAbility | null = null
): Promise<void> {
  const entityFiles = await listFiles(bucket, prefix, ability);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  for (const latestFile of latestFiles) {
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile, ability);
    if (!latestPointer) continue;
    
    // Global bundles only include published entities
    if (latestPointer.status !== 'published') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath, ability);
    
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
 * Regenerate a global admin bundle for a specific membership key (draft + pending + archived + deleted entities)
 * Admin bundles include ALL draft/pending/archived/deleted entities, not filtered by membership key visibility
 * Pending entities need approval, archived entities can be restored
 */
async function regenerateGlobalAdminBundle(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  typeId: string,
  entityType: EntityType,
  ability: AppAbility | null = null
): Promise<EntityBundle> {
  console.log('[BundleInvalidation] Generating global admin bundle:', keyId, typeId);
  
  // Collect draft, pending, archived, and deleted entities from global storage (public/ and platform/)
  // Admin bundles include ALL draft/pending/archived/deleted entities regardless of visibility
  const adminEntities: BundleEntity[] = [];
  
  // Check public entities
  const publicPrefix = `${R2_PATHS.PUBLIC}entities/`;
  const publicFiles = await listFiles(bucket, publicPrefix, ability);
  const publicLatestFiles = publicFiles.filter(f => f.endsWith('/latest.json'));
  
  for (const latestFile of publicLatestFiles) {
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile, ability);
    if (!latestPointer) continue;
    
    // Admin bundles include draft, pending, archived, and deleted entities (pending needs approval, archived can be restored)
    if (latestPointer.status !== 'draft' && latestPointer.status !== 'pending' && latestPointer.status !== 'archived' && latestPointer.status !== 'deleted') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath, ability);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    // Create bundle entity - NOTE: Do NOT include entityTypeId
    // Admin bundles include all fields (no field projection)
    const bundleEntity: BundleEntity = {
      id: entity.id,
      status: entity.status,
      name: entity.name || `Entity ${entity.id}`,
      slug: entity.slug || '',
      data: entity.data, // Dynamic fields only (does NOT include entityTypeId)
      updatedAt: entity.updatedAt
    };
    
    adminEntities.push(bundleEntity);
  }
  
  // Check platform entities
  const platformPrefix = `${R2_PATHS.PLATFORM}entities/`;
  const platformFiles = await listFiles(bucket, platformPrefix, ability);
  const platformLatestFiles = platformFiles.filter(f => f.endsWith('/latest.json'));
  
  for (const latestFile of platformLatestFiles) {
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    const latestPointer = await readJSON<{ version: number; status: string }>(bucket, latestFile, ability);
    if (!latestPointer) continue;
    
    // Admin bundles only include draft and deleted entities
    if (latestPointer.status !== 'draft' && latestPointer.status !== 'deleted') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath, ability);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    // Skip if already added from public prefix (avoid duplicates)
    if (adminEntities.some(e => e.id === entity.id)) continue;
    
    // Create bundle entity - NOTE: Do NOT include entityTypeId
    // Admin bundles include all fields (no field projection)
    const bundleEntity: BundleEntity = {
      id: entity.id,
      status: entity.status,
      name: entity.name || `Entity ${entity.id}`,
      slug: entity.slug || '',
      data: entity.data, // Dynamic fields only (does NOT include entityTypeId)
      updatedAt: entity.updatedAt
    };
    
    adminEntities.push(bundleEntity);
  }
  
  // Create bundle - NOTE: Use typeId (NOT entityTypeId) to identify the entity type
  // Bundles don't have versions - change detection uses HTTP ETags
  const bundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    entityCount: adminEntities.length,
    entities: adminEntities
  };
  
  // Save bundle
  const bundlePath = getGlobalAdminBundlePath(keyId, typeId);
  await writeJSON(bucket, bundlePath, bundle, ability);
  
  console.log('[BundleInvalidation] Generated global admin bundle with', adminEntities.length, 'entities at:', bundlePath);
  
  return bundle;
}

/**
 * Regenerate org bundles (member and admin) for a specific type
 * Uses entity stubs to find all entities, then locates latestPointer from correct path
 */
async function regenerateOrgBundlesForType(
  bucket: R2Bucket,
  orgId: string,
  typeId: string,
  entityType: EntityType,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Generating org bundles:', orgId, typeId);
  
  // Find all entity stubs for this org and typeId (more reliable than scanning paths)
  const stubFiles = await listFiles(bucket, `${R2_PATHS.STUBS}`, ability);
  const relevantStubs: { entityId: string }[] = [];
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    const stub = await readJSON<{ entityId: string; organizationId: string | null; entityTypeId: string }>(bucket, stubFile, ability);
    if (stub && stub.organizationId === orgId && stub.entityTypeId === typeId) {
      relevantStubs.push({ entityId: stub.entityId });
    }
  }
  
  console.log('[BundleInvalidation] Found', relevantStubs.length, 'entity stubs for org', orgId, 'type', typeId);
  
  const memberEntities: BundleEntity[] = [];
  const adminEntities: BundleEntity[] = [];
  
  for (const { entityId } of relevantStubs) {
    // Find latestPointer by checking members path first, then visibility-based paths
    // Published org entities with public/authenticated visibility may be in visibility-based paths
    let latestPointer: { version: number; status: string; visibility: string } | null = null;
    let storageVisibility: 'public' | 'authenticated' | 'members' = 'members';
    
    // Check members path first (always has a pointer due to dual-path write)
    const membersLatestPath = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/${entityId}/latest.json`;
    latestPointer = await readJSON<{ version: number; status: string; visibility: string }>(bucket, membersLatestPath, ability);
    
    if (latestPointer) {
      // Determine actual storage location based on status and visibility
      if (latestPointer.status === 'draft' || latestPointer.status === 'pending') {
        // Drafts/pending are always in members path
        storageVisibility = 'members';
      } else if (latestPointer.visibility === 'members') {
        // Published with members visibility
        storageVisibility = 'members';
      } else {
        // Published with public/authenticated visibility - check visibility path
        storageVisibility = latestPointer.visibility;
        const visibilityLatestPath = latestPointer.visibility === 'public'
          ? `${R2_PATHS.PUBLIC}entities/${entityId}/latest.json`
          : `${R2_PATHS.PLATFORM}entities/${entityId}/latest.json`;
        const visibilityPointer = await readJSON<{ version: number; status: string; visibility: string }>(bucket, visibilityLatestPath, ability);
        if (visibilityPointer) {
          latestPointer = visibilityPointer; // Use pointer from visibility path (more authoritative)
        }
      }
    } else {
      // Not in members path, check visibility-based paths (for published entities)
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = visibility === 'public'
          ? `${R2_PATHS.PUBLIC}entities/${entityId}/latest.json`
          : `${R2_PATHS.PLATFORM}entities/${entityId}/latest.json`;
        latestPointer = await readJSON<{ version: number; status: string; visibility: string }>(bucket, latestPath, ability);
        if (latestPointer) {
          // Verify ownership
          const versionPath = `${latestPath.replace('/latest.json', '')}/v${latestPointer.version}.json`;
          const testEntity = await readJSON<Entity>(bucket, versionPath, ability);
          if (testEntity && testEntity.organizationId === orgId) {
            storageVisibility = visibility;
            break;
          }
          latestPointer = null;
        }
      }
    }
    
    if (!latestPointer) {
      console.warn('[BundleInvalidation] No latestPointer found for entity:', entityId, 'org:', orgId);
      continue;
    }
    
    // Read entity from correct storage location
    const versionPath = storageVisibility === 'members'
      ? `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/${entityId}/v${latestPointer.version}.json`
      : storageVisibility === 'public'
      ? `${R2_PATHS.PUBLIC}entities/${entityId}/v${latestPointer.version}.json`
      : `${R2_PATHS.PLATFORM}entities/${entityId}/v${latestPointer.version}.json`;
    
    const entity = await readJSON<Entity>(bucket, versionPath, ability);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    // Create bundle entity - use latestPointer.status (authoritative), not entity.status
    const bundleEntity: BundleEntity = {
      id: entity.id,
      status: latestPointer.status, // Use latestPointer.status (authoritative source)
      name: entity.name || `Entity ${entity.id}`,
      slug: entity.slug || '',
      data: entity.data, // Dynamic fields only (does NOT include entityTypeId)
      updatedAt: entity.updatedAt
    };
    
    // Member bundle: Published only (check latestPointer.status)
    if (latestPointer.status === 'published') {
      memberEntities.push(bundleEntity);
    }
    
    // Admin bundle: Draft + Pending + Archived + Deleted (check latestPointer.status)
    // Pending entities need approval, archived entities can be restored
    if (latestPointer.status === 'draft' || latestPointer.status === 'pending' || latestPointer.status === 'archived' || latestPointer.status === 'deleted') {
      adminEntities.push(bundleEntity);
    }
  }
  
  // Save member bundle - NOTE: Use typeId (NOT entityTypeId)
  // Bundles don't have versions - change detection uses HTTP ETags
  const memberBundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    entityCount: memberEntities.length,
    entities: memberEntities
  };
  await writeJSON(bucket, getOrgMemberBundlePath(orgId, typeId), memberBundle, ability);
  console.log('[BundleInvalidation] Generated org member bundle with', memberEntities.length, 'entities');
  
  // Save admin bundle - NOTE: Use typeId (NOT entityTypeId)
  // Bundles don't have versions - change detection uses HTTP ETags
  const adminBundle: EntityBundle = {
    typeId, // Bundle-level type identifier (NOT entityTypeId)
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    entityCount: adminEntities.length,
    entities: adminEntities
  };
  await writeJSON(bucket, getOrgAdminBundlePath(orgId, typeId), adminBundle, ability);
  console.log('[BundleInvalidation] Generated org admin bundle with', adminEntities.length, 'entities');
  
  // Update org manifests
  await updateOrgManifestForBundle(bucket, orgId, typeId, memberBundle, 'member', ability);
  await updateOrgManifestForBundle(bucket, orgId, typeId, adminBundle, 'admin', ability);
}

/**
 * Update global manifest for a specific entity type (works without bundles)
 * Used when entity types are created/updated - directly updates manifest using known typeId
 */
async function updateGlobalManifestForType(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  typeId: string,
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Updating global manifest for type:', keyId, typeId);
  
  const manifestPath = getManifestPath(keyId);
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath, ability);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  // Read entity type directly (strongly consistent read after write)
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId), ability);
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found for manifest update:', typeId);
    return;
  }
  
  // Try to get bundle for count/version info (optional - use defaults if not exists)
  const bundlePath = getBundlePath(keyId, typeId);
  const bundle = await readJSON<EntityBundle>(bucket, bundlePath, ability);
  
  // Only include if this type is visible to this key and is active
  if (!entityType.isActive || !entityType.visibleTo?.includes(keyId)) {
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
      entityCount: bundle?.entityCount || 0,
      lastUpdated: bundle?.generatedAt || new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      manifest.entityTypes[existingIndex] = typeEntry;
    } else {
      manifest.entityTypes.push(typeEntry);
    }
  }
  
  // Include config in manifest
  manifest.config = {
    branding: config.branding,
    features: config.features,
    sync: config.sync,
    auth: config.auth,
    apiBaseUrl: config.apiBaseUrl,
    r2PublicUrl: config.r2PublicUrl
  };
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest, ability);
  console.log('[BundleInvalidation] Global manifest updated at:', manifestPath);
}

/**
 * Update global manifest after a bundle changes
 */
async function updateGlobalManifestForBundle(
  bucket: R2Bucket,
  keyId: MembershipKeyId,
  typeId: string,
  bundle: EntityBundle,
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Updating global manifest for key:', keyId);
  
  const manifestPath = getManifestPath(keyId);
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath, ability);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId), ability);
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
      lastUpdated: bundle.generatedAt
    };
    
    if (existingIndex >= 0) {
      manifest.entityTypes[existingIndex] = typeEntry;
    } else {
      manifest.entityTypes.push(typeEntry);
    }
  }
  
  // Include config in manifest
  manifest.config = {
    branding: config.branding,
    features: config.features,
    sync: config.sync,
    auth: config.auth,
    apiBaseUrl: config.apiBaseUrl,
    r2PublicUrl: config.r2PublicUrl
  };
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest, ability);
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
  role: 'member' | 'admin',
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Updating org manifest:', orgId, role);
  
  const manifestPath = role === 'admin' 
    ? getOrgAdminManifestPath(orgId)
    : getOrgMemberManifestPath(orgId);
  
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath, ability);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId), ability);
  if (!entityType) {
    console.error('[BundleInvalidation] Entity type not found for manifest update:', typeId);
    return;
  }
  
  // Check if org has access to this type
  const permissions = await readJSON<EntityTypePermissions>(
    bucket,
    getOrgPermissionsPath(orgId),
    ability
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
  
  await writeJSON(bucket, manifestPath, manifest, ability);
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
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating all manifests for type:', entityTypeId);
  
  try {
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId), ability);
    if (!entityType) {
      throw new Error(`Entity type ${entityTypeId} not found`);
    }
    
    console.log('[BundleInvalidation] Entity type visibleTo:', entityType.visibleTo, 'isActive:', entityType.isActive);
    
    // FIRST: Directly update manifests for the known entityTypeId (avoids listFiles eventual consistency)
    // This ensures immediate updates using strongly consistent reads
    console.log('[BundleInvalidation] Directly updating manifests for type:', entityTypeId);
    for (const keyDef of config.membershipKeys.keys) {
      await updateGlobalManifestForType(bucket, keyDef.id, entityTypeId, config, ability);
    }
    
    // THEN: Regenerate global manifests for full synchronization (ensures all types are in sync)
    console.log('[BundleInvalidation] Regenerating global manifests for full sync:', config.membershipKeys.keys.length, 'membership keys');
    for (const keyDef of config.membershipKeys.keys) {
      console.log('[BundleInvalidation] Regenerating manifest for key:', keyDef.id);
      const manifest = await regenerateGlobalManifest(bucket, keyDef.id, config, ability);
      const typeInManifest = manifest.entityTypes.find(t => t.id === entityTypeId);
      if (typeInManifest) {
        console.log('[BundleInvalidation] Type', entityTypeId, 'is included in', keyDef.id, 'manifest');
      } else {
        console.log('[BundleInvalidation] Type', entityTypeId, 'is NOT included in', keyDef.id, 'manifest (not visible to this key)');
      }
    }
    
    // Regenerate all org manifests that have this type in their permissions
    console.log('[BundleInvalidation] Regenerating org manifests for type:', entityTypeId);
    await regenerateAllOrgManifestsWithType(bucket, entityTypeId, ability);
    
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
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<SiteManifest> {
  console.log('[BundleInvalidation] Generating global manifest for key:', keyId);
  
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`, ability);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  console.log('[BundleInvalidation] Found', definitionFiles.length, 'definition files to check');
  
  const entityTypes: ManifestEntityType[] = [];
  
  for (const file of definitionFiles) {
    try {
      // Verify file actually exists before trying to read it
      // This handles R2 eventual consistency where listFiles might return deleted files
      const fileHead = await headFile(bucket, file, ability);
      if (!fileHead) {
        console.log('[BundleInvalidation] File no longer exists (was deleted), skipping:', file);
        continue;
      }
      
      const entityType = await readJSON<EntityType>(bucket, file, ability, 'read', 'EntityType');
      // Skip if file doesn't exist, is null, or is inactive
      if (!entityType || !entityType.isActive) {
        console.log('[BundleInvalidation] Skipping entity type (missing or inactive):', file);
        continue;
      }
      
      // Only include types visible to this key
      if (!entityType.visibleTo?.includes(keyId)) continue;
      
      // Get bundle for count and version info
      const bundlePath = getBundlePath(keyId, entityType.id);
      const bundle = await readJSON<EntityBundle>(bucket, bundlePath, ability, 'read', 'Entity');
      
      entityTypes.push({
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug,
        description: entityType.description,
        entityCount: bundle?.entityCount || 0,
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
    entityTypes,
    // Include app config for frontend consumption
    config: {
      branding: config.branding,
      features: config.features,
      sync: config.sync,
      auth: config.auth,
      apiBaseUrl: config.apiBaseUrl,
      r2PublicUrl: config.r2PublicUrl
    }
  };
  
  const manifestPath = getManifestPath(keyId);
  await writeJSON(bucket, manifestPath, manifest, ability);
  
  console.log('[BundleInvalidation] Generated global manifest with', entityTypes.length, 'types at:', manifestPath);
  
  return manifest;
}

/**
 * Regenerate all org manifests that include a specific entity type
 */
async function regenerateAllOrgManifestsWithType(
  bucket: R2Bucket,
  entityTypeId: string,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org manifests with type:', entityTypeId);
  
  const permissionFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}policies/organizations/`, ability);
  const jsonFiles = permissionFiles.filter(f => f.endsWith('/entity-type-permissions.json'));
  
  for (const file of jsonFiles) {
    const permissions = await readJSON<EntityTypePermissions>(bucket, file, ability);
    
    if (permissions && permissions.viewable?.includes(entityTypeId)) {
      console.log('[BundleInvalidation] Regenerating manifests for org:', permissions.organizationId);
      await regenerateOrgManifest(bucket, permissions.organizationId, ability);
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
  orgId: string,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating org manifest for:', orgId);
  
  try {
    // Regenerate both member and admin manifests
    await regenerateOrgManifestForRole(bucket, orgId, 'member', ability);
    await regenerateOrgManifestForRole(bucket, orgId, 'admin', ability);
    console.log('[BundleInvalidation] Org manifests regenerated:', orgId);
  } catch (error) {
    console.error('[BundleInvalidation] Error regenerating org manifest:', error);
    throw error;
  }
}

/**
 * Invalidate and regenerate bundles/manifests based on which file was updated
 * 
 * This is the main entry point for bundle invalidation - it analyzes the file path
 * and determines which bundles/manifests need to be regenerated.
 * 
 * @param bucket - R2 bucket instance
 * @param filePath - The R2 path of the file that was updated
 * @param ability - User's CASL ability (required for R2 access)
 * @param entityMetadata - Optional entity metadata to avoid R2 stub read (entityTypeId, organizationId)
 */
export async function invalidateBundlesForFile(
  bucket: R2Bucket,
  filePath: string,
  ability: AppAbility | null = null,
  entityMetadata?: { entityTypeId: string; organizationId: string | null }
): Promise<void> {
  console.log('[BundleInvalidation] Invalidating bundles for file:', filePath);
  
  try {
    const config = await loadAppConfig(bucket, ability);
    
    // Check if this is an entity file
    const entityInfo = extractEntityInfoFromPath(filePath);
    if (entityInfo) {
      // Entity file or stub was updated - use provided metadata or read stub
      let entityTypeId: string;
      let organizationId: string | null;
      
      if (entityMetadata) {
        // Use provided metadata to avoid R2 stub read (optimization)
        entityTypeId = entityMetadata.entityTypeId;
        organizationId = entityMetadata.organizationId;
        console.log('[BundleInvalidation] Using provided entity metadata, avoiding stub read');
      } else if ('entityId' in entityInfo) {
        // Read stub to get entityTypeId (fallback if metadata not provided)
        const stubPath = getEntityStubPath(entityInfo.entityId);
        const stub = await readJSON<{ entityTypeId: string; organizationId: string | null }>(
          bucket,
          stubPath,
          ability,
          'read',
          'Entity'
        );
        
        if (!stub) {
          console.warn('[BundleInvalidation] Entity stub not found for bundle invalidation:', entityInfo.entityId);
          return;
        }
        
        entityTypeId = stub.entityTypeId;
        organizationId = entityInfo.organizationId !== undefined ? entityInfo.organizationId : stub.organizationId;
      } else {
        // Already have entityTypeId (shouldn't happen with current path patterns, but handle it)
        entityTypeId = entityInfo.entityTypeId;
        organizationId = entityInfo.organizationId;
      }
      
      // Regenerate bundles for this entity's type and org
      console.log('[BundleInvalidation] Entity file updated, regenerating bundles for type:', entityTypeId, 'org:', organizationId);
      await regenerateEntityBundles(
        bucket,
        entityTypeId,
        organizationId,
        config,
        ability
      );
      return;
    }
    
    // Check if this is an entity type file
    const entityTypeMatch = filePath.match(/entity-types\/([^\/]+)\/definition\.json$/);
    if (entityTypeMatch) {
      const typeId = entityTypeMatch[1];
      console.log('[BundleInvalidation] Entity type updated, regenerating bundles for all entities of type:', typeId);
      
      // Entity type definition changed - regenerate global bundles
      await regenerateEntityBundles(bucket, typeId, null, config, ability);
      
      // Also regenerate for all organizations that have this type
      // List all orgs and regenerate their bundles for this type
      const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`, ability);
      for (const orgDir of orgDirs) {
        // Extract org ID from path like "orgs/{orgId}/"
        const orgMatch = orgDir.match(/orgs\/([^\/]+)\//);
        if (orgMatch) {
          const orgId = orgMatch[1];
          console.log('[BundleInvalidation] Regenerating org bundles for org:', orgId, 'type:', typeId);
          try {
            await regenerateEntityBundles(bucket, typeId, orgId, config, ability);
          } catch (error) {
            // Log but continue with other orgs
            console.error('[BundleInvalidation] Failed to regenerate bundles for org:', orgId, error);
          }
        }
      }
      return;
    }
    
    // Check if this is an organization profile file
    const orgProfileMatch = filePath.match(/orgs\/([^\/]+)\/profile\.json$/);
    if (orgProfileMatch) {
      const orgId = orgProfileMatch[1];
      console.log('[BundleInvalidation] Organization profile updated, regenerating org manifests:', orgId);
      
      // Organization profile changed - regenerate org manifests
      await regenerateOrgManifest(bucket, orgId, ability);
      return;
    }
    
    // Check if this is an organization permissions file
    const orgPermissionsMatch = filePath.match(/policies\/organizations\/([^\/]+)\/entity-type-permissions\.json$/);
    if (orgPermissionsMatch) {
      const orgId = orgPermissionsMatch[1];
      console.log('[BundleInvalidation] Organization permissions updated, regenerating org manifests:', orgId);
      
      // Organization permissions changed - regenerate org manifests
      // Note: This might also require regenerating bundles if permissions affect which entities are visible
      // For now, just regenerate manifests; bundle regeneration happens when entities change
      await regenerateOrgManifest(bucket, orgId, ability);
      
      // Also regenerate bundles for all entity types that this org has access to
      // This ensures bundles reflect the updated permissions
      const permissions = await readJSON<EntityTypePermissions>(
        bucket,
        getOrgPermissionsPath(orgId),
        ability
      );
      
      if (permissions?.viewable) {
        for (const typeId of permissions.viewable) {
          console.log('[BundleInvalidation] Regenerating bundles for org:', orgId, 'type:', typeId, 'due to permission change');
          try {
            await regenerateEntityBundles(bucket, typeId, orgId, config, ability);
          } catch (error) {
            console.error('[BundleInvalidation] Failed to regenerate bundles for org:', orgId, 'type:', typeId, error);
          }
        }
      }
      return;
    }
    
    // Unknown file type - no bundle invalidation needed
    console.log('[BundleInvalidation] File type not recognized for bundle invalidation:', filePath);
    
  } catch (error) {
    console.error('[BundleInvalidation] Error invalidating bundles for file:', filePath, error);
    throw error;
  }
}

/**
 * Extract entity information from R2 path
 * Returns entityTypeId and organizationId if path is an entity file or stub
 * Note: For stubs, returns entityId only - caller must read stub to get entityTypeId
 */
function extractEntityInfoFromPath(filePath: string): { entityId: string; organizationId: string | null; entityTypeId?: never } | { entityTypeId: string; organizationId: string | null; entityId?: never } | null {
  // Check for entity stub: stubs/{entityId}.json
  const stubMatch = filePath.match(/^stubs\/([^\/]+)\.json$/);
  if (stubMatch) {
    const entityId = stubMatch[1];
    // Return entityId only - caller will need to read stub to get entityTypeId
    return { entityId, organizationId: null };
  }
  
  // Check for entity version or latest file:
  // - public/entities/{entityId}/v{version}.json
  // - platform/entities/{entityId}/v{version}.json  
  // - private/orgs/{orgId}/entities/{entityId}/v{version}.json
  // - public/entities/{entityId}/latest.json
  // - platform/entities/{entityId}/latest.json
  // - private/orgs/{orgId}/entities/{entityId}/latest.json
  const orgEntityMatch = filePath.match(/private\/orgs\/([^\/]+)\/entities\/([^\/]+)\//);
  if (orgEntityMatch) {
    const orgId = orgEntityMatch[1];
    const entityId = orgEntityMatch[2];
    return { entityId, organizationId: orgId };
  }
  
  const globalEntityMatch = filePath.match(/\/(?:public|platform)\/entities\/([^\/]+)\//);
  if (globalEntityMatch) {
    const entityId = globalEntityMatch[1];
    return { entityId, organizationId: null };
  }
  
  return null;
}

/**
 * Regenerate org manifest for a specific role (member or admin)
 */
async function regenerateOrgManifestForRole(
  bucket: R2Bucket,
  orgId: string,
  role: 'member' | 'admin',
  ability: AppAbility | null = null
): Promise<SiteManifest> {
  console.log('[BundleInvalidation] Generating org manifest:', orgId, role);
  
  const permissions = await readJSON<EntityTypePermissions>(
    bucket,
    getOrgPermissionsPath(orgId),
    ability
  );
  
  const allowedTypeIds = permissions?.viewable || [];
  
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`, ability);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  console.log('[BundleInvalidation] Found', definitionFiles.length, 'definition files to check for org manifest');
  
  const entityTypes: ManifestEntityType[] = [];
  
  for (const file of definitionFiles) {
    try {
      // Verify file actually exists before trying to read it
      // This handles R2 eventual consistency where listFiles might return deleted files
      const fileHead = await headFile(bucket, file, ability);
      if (!fileHead) {
        console.log('[BundleInvalidation] File no longer exists (was deleted), skipping:', file);
        continue;
      }
      
      const entityType = await readJSON<EntityType>(bucket, file, ability, 'read', 'EntityType');
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
      const bundle = await readJSON<EntityBundle>(bucket, bundlePath, ability, 'read', 'Entity');
      
      entityTypes.push({
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug,
        description: entityType.description,
        entityCount: bundle?.entityCount || 0,
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
  await writeJSON(bucket, manifestPath, manifest, ability);
  
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
      const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId), null);
      if (!entityType) continue;
      
      await regenerateOrgBundlesForType(bucket, orgId, typeId, entityType, null);
    }
    
    // Also regenerate the org manifests
    await regenerateOrgManifest(bucket, orgId, null);
    
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
  config: AppConfig,
  ability: AppAbility | null = null
): Promise<void> {
  console.log('[BundleInvalidation] Regenerating all manifests after type deletion');
  
  try {
    // Regenerate global manifests for each membership key
    // These functions list entity type files, so deleted types won't be included
    // Note: Due to R2 eventual consistency, listFiles may temporarily return deleted files,
    // but readJSON will return null for non-existent files and they'll be skipped
    for (const keyDef of config.membershipKeys.keys) {
      console.log('[BundleInvalidation] Regenerating global manifest for key:', keyDef.id);
      const manifest = await regenerateGlobalManifest(bucket, keyDef.id, config, ability);
      console.log('[BundleInvalidation] Regenerated manifest for key', keyDef.id, 'with', manifest.entityTypes.length, 'types:', manifest.entityTypes.map(t => t.id).join(', '));
    }
    
    // Regenerate all org manifests
    // List all org permission files and regenerate each org's manifest
    const permissionFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}policies/organizations/`, ability);
    const jsonFiles = permissionFiles.filter(f => f.endsWith('/entity-type-permissions.json'));
    
    console.log('[BundleInvalidation] Found', jsonFiles.length, 'org permission files to process');
    
    for (const file of jsonFiles) {
      try {
        const permissions = await readJSON<EntityTypePermissions>(bucket, file, ability, 'read', 'Organization');
        if (permissions && permissions.organizationId) {
          console.log('[BundleInvalidation] Regenerating manifest for org:', permissions.organizationId);
          await regenerateOrgManifest(bucket, permissions.organizationId, ability);
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
