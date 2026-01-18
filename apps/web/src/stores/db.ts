/**
 * TanStack DB Store
 * 
 * Manages offline-first data storage with indexing and queries.
 * Automatically syncs with server manifests and bundles.
 * 
 * Database schema:
 * - manifests: Store SiteManifest data with versions
 * - entityTypes: Indexed entity type entries (FK to manifests)
 * - bundles: Bundle metadata with ETag tracking
 * - entities: Individual bundle entities with indexes
 */

import { createCollection, localStorageCollectionOptions } from '@tanstack/db';
import type { 
  SiteManifest, 
  EntityBundle, 
  BundleEntity, 
  ManifestEntityType,
  AppConfig 
} from '@1cc/shared';

// Database row types
interface ManifestRow {
  id: string; // 'platform' | 'public' | 'org:${orgId}:member' | 'org:${orgId}:admin'
  version: number;
  generatedAt: string;
  entityTypes: ManifestEntityType[];
  config: AppConfig | null;
  etag: string | null; // HTTP ETag from last response (for conditional requests)
  syncedAt: string; // Last sync timestamp (ISO 8601)
}

interface EntityTypeRow {
  id: string; // Entity type ID
  manifestId: string; // FK to manifests.id
  name: string;
  pluralName: string;
  slug: string;
  description?: string;
  entityCount: number;
  lastUpdated: string;
}

interface BundleRow {
  id: string; // `${manifestId}:${typeId}` - composite key
  manifestId: string; // FK to manifests.id
  typeId: string;
  typeName: string;
  etag: string | null; // HTTP ETag from last response (for conditional requests)
  generatedAt: string;
  entityCount: number;
  syncedAt: string; // Last sync timestamp (ISO 8601)
}

interface EntityRow {
  id: string; // Entity ID
  bundleId: string; // FK to bundles.id
  typeId: string; // Denormalized for faster queries
  status: string; // EntityStatus
  name: string;
  slug: string;
  data: Record<string, unknown>; // Dynamic fields
  updatedAt: string;
}

/**
 * Database instance type - collections grouped together
 * Note: TanStack DB doesn't have createDatabase, collections are standalone
 */
type DatabaseInstance = {
  collections: {
    manifests: any; // Collection type - inferred from createCollection return
    entityTypes: any; // Collection type - inferred from createCollection return
    bundles: any; // Collection type - inferred from createCollection return
    entities: any; // Collection type - inferred from createCollection return
  };
};

/**
 * Create database with collections using LocalStorageCollection for persistence
 * TanStack DB v0.5.20 doesn't export createDatabase - collections are standalone
 * We group them in an object for easier access
 * 
 * All collections use localStorageCollectionOptions for persistence across page reloads
 * and cross-tab synchronization via storage events
 */
function createAppDatabase(): DatabaseInstance {
  // Manifests collection - persisted to localStorage with cross-tab sync
  // startSync: true ensures data is loaded from localStorage immediately
  const manifests = createCollection(
    localStorageCollectionOptions<ManifestRow>({
      id: 'manifests',
      storageKey: '1cc-portal-manifests',
      getKey: (item) => item.id,
      startSync: true, // Start syncing immediately to hydrate from localStorage
    })
  );

  // Entity types collection (indexed by manifest) - persisted to localStorage
  const entityTypes = createCollection(
    localStorageCollectionOptions<EntityTypeRow>({
      id: 'entityTypes',
      storageKey: '1cc-portal-entity-types',
      getKey: (item) => item.id,
      startSync: true, // Start syncing immediately to hydrate from localStorage
    })
  );

  // Bundles collection - persisted to localStorage with ETag tracking
  const bundles = createCollection(
    localStorageCollectionOptions<BundleRow>({
      id: 'bundles',
      storageKey: '1cc-portal-bundles',
      getKey: (item) => item.id,
      startSync: true, // Start syncing immediately to hydrate from localStorage
    })
  );

  // Entities collection (from bundles) - persisted to localStorage
  const entities = createCollection(
    localStorageCollectionOptions<EntityRow>({
      id: 'entities',
      storageKey: '1cc-portal-entities',
      getKey: (item) => item.id,
      startSync: true, // Start syncing immediately to hydrate from localStorage
    })
  );

  // Group collections in an object (no createDatabase function exists)
  const db: DatabaseInstance = {
    collections: {
      manifests,
      entityTypes,
      bundles,
      entities,
    },
  };

  console.log('[DB] Database initialized with LocalStorageCollection persistence');
  console.log('[DB] Storage keys:', {
    manifests: '1cc-portal-manifests',
    entityTypes: '1cc-portal-entity-types',
    bundles: '1cc-portal-bundles',
    entities: '1cc-portal-entities',
  });
  
  // Trigger hydration by accessing collections (forces load from localStorage)
  // This ensures data is loaded even if startSync doesn't work as expected
  if (typeof window !== 'undefined') {
    try {
      // Access collections to trigger hydration
      const manifestCount = Array.from(manifests.values()).length;
      const typeCount = Array.from(entityTypes.values()).length;
      const bundleCount = Array.from(bundles.values()).length;
      const entityCount = Array.from(entities.values()).length;
      
      console.log('[DB] Hydration check after initialization:', {
        manifests: manifestCount,
        entityTypes: typeCount,
        bundles: bundleCount,
        entities: entityCount,
      });
      
      // Also check localStorage directly to verify data exists
      const storedManifests = localStorage.getItem('1cc-portal-manifests');
      const storedTypes = localStorage.getItem('1cc-portal-entity-types');
      const storedBundles = localStorage.getItem('1cc-portal-bundles');
      const storedEntities = localStorage.getItem('1cc-portal-entities');
      
      if (storedManifests && manifestCount === 0) {
        console.warn('[DB] WARNING: localStorage has manifests but collection is empty!');
        console.warn('[DB] localStorage data:', storedManifests.substring(0, 200));
      }
      if (storedTypes && typeCount === 0) {
        console.warn('[DB] WARNING: localStorage has entity types but collection is empty!');
      }
      if (storedBundles && bundleCount === 0) {
        console.warn('[DB] WARNING: localStorage has bundles but collection is empty!');
      }
      if (storedEntities && entityCount === 0) {
        console.warn('[DB] WARNING: localStorage has entities but collection is empty!');
      }
    } catch (err) {
      console.error('[DB] Error during hydration check:', err);
    }
  }

  return db;
}

// Initialize database singleton
let database: ReturnType<typeof createAppDatabase> | null = null;

/**
 * Get or create database instance
 * This should be called early to ensure collections are initialized and hydrated
 */
export function getDatabase() {
  if (!database) {
    console.log('[DB] Creating database instance...');
    database = createAppDatabase();
    
    // Expose debug function globally for browser console
    if (typeof window !== 'undefined') {
      (window as any).debugDB = debugDatabase;
      (window as any).hydrateDB = hydrateDatabase;
      console.log('[DB] Debug functions available:');
      console.log('[DB]   - debugDB() - Check database contents');
      console.log('[DB]   - hydrateDB() - Manually trigger hydration');
    }
  }
  return database;
}

/**
 * Manually trigger hydration of all collections from localStorage
 * This can be called if collections aren't auto-hydrating
 */
export function hydrateDatabase() {
  console.log('[DB] Manually triggering hydration...');
  const db = getDatabase();
  
  // Access each collection to trigger hydration
  try {
    const manifestCount = Array.from(db.collections.manifests.values()).length;
    const typeCount = Array.from(db.collections.entityTypes.values()).length;
    const bundleCount = Array.from(db.collections.bundles.values()).length;
    const entityCount = Array.from(db.collections.entities.values()).length;
    
    console.log('[DB] After manual hydration:', {
      manifests: manifestCount,
      entityTypes: typeCount,
      bundles: bundleCount,
      entities: entityCount,
    });
    
    return {
      manifests: manifestCount,
      entityTypes: typeCount,
      bundles: bundleCount,
      entities: entityCount,
    };
  } catch (err) {
    console.error('[DB] Error during manual hydration:', err);
    throw err;
  }
}

/**
 * Sync manifest into database
 * Checks version and only updates if changed
 */
export async function syncManifest(
  manifestId: string, 
  manifest: SiteManifest,
  etag: string | null = null
): Promise<boolean> {
  try {
    const db = getDatabase();
    console.log('[DB] syncManifest called:', manifestId, 'version:', manifest.version, 'ETag:', etag);
    
    // Check if ETag changed (if we have one stored)
    // TanStack DB: use get() instead of findById()
    const existing = db.collections.manifests.get(manifestId);
    console.log('[DB] Existing manifest:', existing ? `version ${existing.version}, ETag ${existing.etag}` : 'none');
    
    const etagChanged = !existing || !existing.etag || existing.etag !== etag;
    const versionChanged = !existing || existing.version !== manifest.version;
    
    if (!etagChanged && existing && etag) {
      console.log('[DB] Manifest ETag unchanged:', manifestId, 'ETag:', etag);
      return false;
    }
    
    console.log('[DB] Syncing manifest:', manifestId, 'version:', manifest.version, 'entityTypes:', manifest.entityTypes.length, 'ETag:', etag);
    
    // Store manifest with ETag
    // TanStack DB: insert() and update() return transactions that need to be awaited
    const manifestData: ManifestRow = {
      id: manifestId,
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      entityTypes: manifest.entityTypes,
      config: (manifest.config as AppConfig | null) || null, // Type assertion: SiteManifest.config may have partial shape
      etag, // Store ETag from response
      syncedAt: new Date().toISOString(),
    };
    
    if (existing) {
      if (versionChanged) {
        console.log('[DB] Updating existing manifest (version changed):', manifestId);
      } else {
        console.log('[DB] Updating existing manifest (version unchanged, but syncing entity types):', manifestId);
      }
      const tx = db.collections.manifests.update(manifestId, () => manifestData);
      await tx.isPersisted.promise;
      console.log('[DB] Manifest update transaction completed');
    } else {
      console.log('[DB] Inserting new manifest:', manifestId);
      const tx = db.collections.manifests.insert(manifestData);
      await tx.isPersisted.promise;
      console.log('[DB] Manifest insert transaction completed');
    }
    
    // Verify the data was stored in memory
    const verify = db.collections.manifests.get(manifestId);
    if (verify) {
      console.log('[DB] Verified manifest stored in memory:', manifestId, 'version:', verify.version, 'entityTypes:', verify.entityTypes.length);
    } else {
      console.error('[DB] ERROR: Manifest not found in memory after insert/update!', manifestId);
    }
    
    // Also verify localStorage was written
    try {
      const stored = localStorage.getItem('1cc-portal-manifests');
      if (stored) {
        const parsed = JSON.parse(stored);
        const found = Array.isArray(parsed) ? parsed.find((m: ManifestRow) => m.id === manifestId) : null;
        if (found) {
          console.log('[DB] Verified manifest stored in localStorage:', manifestId, 'version:', found.version);
        } else {
          console.warn('[DB] WARNING: Manifest not found in localStorage after write!', manifestId);
        }
      } else {
        console.warn('[DB] WARNING: localStorage key "1cc-portal-manifests" is empty!');
      }
    } catch (err) {
      console.error('[DB] Error checking localStorage:', err);
    }
    
    // ALWAYS sync entity types, even if manifest version unchanged
    // This ensures entity types are synced with the correct manifestId
    // (e.g., if they were previously synced with a different manifestId)
    await syncEntityTypes(manifestId, manifest.entityTypes);
    
    // Trigger bundle sync for changed types
    // This will be called from sync store after fetching bundles
    console.log('[DB] Manifest synced successfully:', manifestId);
    
    return true;
  } catch (error) {
    console.error('[DB] Error syncing manifest:', manifestId, error);
    throw error;
  }
}

/**
 * Sync entity types for a manifest
 */
async function syncEntityTypes(
  manifestId: string,
  types: ManifestEntityType[]
): Promise<void> {
  const db = getDatabase();
  
  console.log('[DB] syncEntityTypes: Syncing', types.length, 'entity types for manifest:', manifestId);
  
  // Get existing types for this manifest
  // TanStack DB: use Array.from(collection.values()).filter() instead of query()
  const allTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  const existingTypes = allTypes.filter((t: EntityTypeRow) => t.manifestId === manifestId);
  const existingIds = new Set(existingTypes.map((t: EntityTypeRow) => t.id));
  const newIds = new Set(types.map(t => t.id));
  
  console.log('[DB] Existing types for manifest', manifestId, ':', existingIds.size, Array.from(existingIds));
  console.log('[DB] New types to sync:', newIds.size, Array.from(newIds));
  
  // Remove entity types no longer in manifest
  for (const typeId of Array.from(existingIds)) {
    if (!newIds.has(typeId)) {
      const tx = db.collections.entityTypes.delete(typeId);
      await tx.isPersisted.promise;
      console.log('[DB] Removed entity type:', typeId, 'from manifest:', manifestId);
    }
  }
  
  // Upsert entity types (bundles don't have versions anymore)
  // TanStack DB: use insert() for new, update() for existing
  for (const type of types) {
    const typeData: EntityTypeRow = {
      id: type.id,
      manifestId, // CRITICAL: Ensure manifestId is set correctly
      name: type.name,
      pluralName: type.pluralName,
      slug: type.slug,
      description: type.description,
      entityCount: type.entityCount,
      lastUpdated: type.lastUpdated,
    };
    
    const existing = db.collections.entityTypes.get(type.id);
    if (existing) {
      // Update existing - but only if manifestId matches or we're updating it
      if (existing.manifestId !== manifestId) {
        console.log('[DB] Updating entity type', type.id, 'manifestId from', existing.manifestId, 'to', manifestId);
      }
      const tx = db.collections.entityTypes.update(type.id, () => typeData);
      await tx.isPersisted.promise;
    } else {
      console.log('[DB] Inserting new entity type:', type.id, 'for manifest:', manifestId);
      const tx = db.collections.entityTypes.insert(typeData);
      await tx.isPersisted.promise;
    }
  }
  
  // Verify the sync
  const verifyTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  const verifyCount = verifyTypes.filter((t: EntityTypeRow) => t.manifestId === manifestId).length;
  console.log('[DB] Verified:', verifyCount, 'entity types now in DB for manifest:', manifestId);
  
  console.log('[DB] Synced', types.length, 'entity types for manifest:', manifestId);
}

/**
 * Sync bundle into database
 * Uses ETags instead of versions - updates if ETag changed
 * @param bundleId - Bundle ID (${manifestId}:${typeId})
 * @param bundle - Bundle data from API
 * @param manifestId - Manifest ID
 * @param etag - HTTP ETag from response header
 * @returns true if bundle was updated, false if ETag unchanged
 */
export async function syncBundle(
  bundleId: string,
  bundle: EntityBundle,
  manifestId: string,
  etag: string | null
): Promise<boolean> {
  try {
    const db = getDatabase();
    console.log('[DB] syncBundle called:', bundleId, 'ETag:', etag, 'entities:', bundle.entityCount);
    
    // Check if ETag changed (if we have one stored)
    // TanStack DB: use get() instead of findById()
    const existing = db.collections.bundles.get(bundleId);
    console.log('[DB] Existing bundle:', existing ? `ETag ${existing.etag}` : 'none');
    
    const etagChanged = !existing || !existing.etag || existing.etag !== etag;
    
    if (!etagChanged && existing && etag) {
      console.log('[DB] Bundle ETag unchanged:', bundleId, 'ETag:', etag);
      return false;
    }
    
    console.log('[DB] Syncing bundle:', bundleId, 'ETag:', etag, 'entities:', bundle.entityCount);
    
    // Store bundle metadata with ETag
    // TanStack DB: use insert() for new, update() for existing
    const bundleData: BundleRow = {
      id: bundleId,
      manifestId,
      typeId: bundle.typeId,
      typeName: bundle.typeName,
      etag, // Store ETag from response
      generatedAt: bundle.generatedAt,
      entityCount: bundle.entityCount,
      syncedAt: new Date().toISOString(),
    };
    
    if (existing) {
      console.log('[DB] Updating existing bundle:', bundleId);
      const tx = db.collections.bundles.update(bundleId, () => bundleData);
      await tx.isPersisted.promise;
      console.log('[DB] Bundle update transaction completed');
    } else {
      console.log('[DB] Inserting new bundle:', bundleId);
      const tx = db.collections.bundles.insert(bundleData);
      await tx.isPersisted.promise;
      console.log('[DB] Bundle insert transaction completed');
    }
    
    // Verify the data was stored in memory
    const verify = db.collections.bundles.get(bundleId);
    if (verify) {
      console.log('[DB] Verified bundle stored in memory:', bundleId, 'ETag:', verify.etag, 'entities:', verify.entityCount);
    } else {
      console.error('[DB] ERROR: Bundle not found in memory after insert/update!', bundleId);
    }
    
    // Also verify localStorage was written
    try {
      const stored = localStorage.getItem('1cc-portal-bundles');
      if (stored) {
        const parsed = JSON.parse(stored);
        const found = Array.isArray(parsed) ? parsed.find((b: BundleRow) => b.id === bundleId) : null;
        if (found) {
          console.log('[DB] Verified bundle stored in localStorage:', bundleId, 'ETag:', found.etag);
        } else {
          console.warn('[DB] WARNING: Bundle not found in localStorage after write!', bundleId);
        }
      } else {
        console.warn('[DB] WARNING: localStorage key "1cc-portal-bundles" is empty!');
      }
    } catch (err) {
      console.error('[DB] Error checking localStorage:', err);
    }
    
    // Update entities (delete old, insert new)
    await syncEntities(bundleId, bundle.typeId, bundle.entities);
    
    console.log('[DB] Bundle synced successfully:', bundleId);
    
    return true;
  } catch (error) {
    console.error('[DB] Error syncing bundle:', bundleId, error);
    throw error;
  }
}

/**
 * Sync entities for a bundle
 * Replaces all entities for the bundle
 */
async function syncEntities(
  bundleId: string,
  typeId: string,
  entities: BundleEntity[]
): Promise<void> {
  try {
    const db = getDatabase();
    console.log('[DB] syncEntities called:', bundleId, 'entities:', entities.length);
    
    // Delete existing entities for this bundle
    // TanStack DB: use Array.from(collection.values()).filter() instead of query()
    const allEntities = Array.from(db.collections.entities.values()) as EntityRow[];
    const existing = allEntities.filter((e: EntityRow) => e.bundleId === bundleId);
    const existingIds = new Set(existing.map((e: EntityRow) => e.id));
    const newIds = new Set(entities.map(e => e.id));
    
    console.log('[DB] Existing entities for bundle:', existingIds.size, 'New entities:', newIds.size);
    
    // Remove entities no longer in bundle
    let deletedCount = 0;
    for (const entityId of Array.from(existingIds)) {
      if (!newIds.has(entityId)) {
        const tx = db.collections.entities.delete(entityId);
        await tx.isPersisted.promise;
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log('[DB] Deleted', deletedCount, 'entities no longer in bundle');
    }
    
    // Upsert entities
    // TanStack DB: use insert() for new, update() for existing
    let insertedCount = 0;
    let updatedCount = 0;
    for (const entity of entities) {
      const entityData: EntityRow = {
        id: entity.id,
        bundleId,
        typeId,
        status: entity.status,
        name: entity.name,
        slug: entity.slug,
        data: entity.data,
        updatedAt: entity.updatedAt,
      };
      
      const existingEntity = db.collections.entities.get(entity.id);
      if (existingEntity) {
        const tx = db.collections.entities.update(entity.id, () => entityData);
        await tx.isPersisted.promise;
        updatedCount++;
      } else {
        const tx = db.collections.entities.insert(entityData);
        await tx.isPersisted.promise;
        insertedCount++;
      }
    }
    
    console.log('[DB] Synced', entities.length, 'entities for bundle:', bundleId, `(${insertedCount} inserted, ${updatedCount} updated)`);
    
    // Verify entities were stored
    const verifyEntities = Array.from(db.collections.entities.values()) as EntityRow[];
    const bundleEntities = verifyEntities.filter((e: EntityRow) => e.bundleId === bundleId);
    console.log('[DB] Verified entities in DB for bundle:', bundleId, 'count:', bundleEntities.length);
  } catch (error) {
    console.error('[DB] Error syncing entities for bundle:', bundleId, error);
    throw error;
  }
}

/**
 * Query functions for retrieving data from database
 */

/**
 * Get manifest by ID
 * TanStack DB: use get() instead of findById()
 */
export async function getManifest(manifestId: string): Promise<ManifestRow | null> {
  const db = getDatabase();
  return db.collections.manifests.get(manifestId) || null;
}

/**
 * Get entity type by ID or slug (searches all manifests)
 * TanStack DB: use get() and Array.from().filter() instead of findById() and query()
 */
export async function getEntityType(
  idOrSlug: string
): Promise<EntityTypeRow | null> {
  const db = getDatabase();
  
  // Search by ID first
  const byId = db.collections.entityTypes.get(idOrSlug);
  if (byId) return byId;
  
  // Search by slug
  const allTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  const bySlug = allTypes.find((t: EntityTypeRow) => t.slug === idOrSlug);
  return bySlug || null;
}

/**
 * Get bundle ETag by manifest ID and type ID
 * TanStack DB: use get() instead of findById()
 */
export async function getManifestEtag(
  manifestId: string
): Promise<string | null> {
  const db = getDatabase();
  
  const manifestRow = db.collections.manifests.get(manifestId);
  
  return manifestRow?.etag || null;
}

export async function getBundleEtag(
  manifestId: string,
  typeId: string
): Promise<string | null> {
  const db = getDatabase();
  
  const bundleId = `${manifestId}:${typeId}`;
  const bundleRow = db.collections.bundles.get(bundleId);
  
  return bundleRow?.etag || null;
}

/**
 * Get bundle by manifest ID and type ID
 * TanStack DB: use get() and Array.from().filter() instead of findById() and query()
 */
export async function getBundle(
  manifestId: string,
  typeId: string
): Promise<EntityBundle | null> {
  const db = getDatabase();
  
  const bundleId = `${manifestId}:${typeId}`;
  const bundleRow = db.collections.bundles.get(bundleId);
  
  if (!bundleRow) return null;
  
  // Fetch entities for this bundle
  const allEntities = Array.from(db.collections.entities.values()) as EntityRow[];
  const entityRows = allEntities.filter((e: EntityRow) => e.bundleId === bundleId);
  
  // Convert to EntityBundle format (bundles don't have versions anymore)
  const bundle: EntityBundle = {
    typeId: bundleRow.typeId,
    typeName: bundleRow.typeName,
    generatedAt: bundleRow.generatedAt,
    entityCount: bundleRow.entityCount,
    entities: entityRows.map(e => ({
      id: e.id,
      status: e.status as any,
      name: e.name,
      slug: e.slug,
      data: e.data,
      updatedAt: e.updatedAt,
    })),
  };
  
  return bundle;
}

/**
 * Get entity by ID
 * TanStack DB: use get() instead of findById()
 */
export async function getEntity(entityId: string): Promise<BundleEntity | null> {
  const db = getDatabase();
  
  const entityRow = db.collections.entities.get(entityId);
  if (!entityRow) return null;
  
  return {
    id: entityRow.id,
    status: entityRow.status as any,
    name: entityRow.name,
    slug: entityRow.slug,
    data: entityRow.data,
    updatedAt: entityRow.updatedAt,
  };
}

/**
 * Get entity with typeId from TanStack DB
 * Returns entity data with typeId for easier conversion to Entity format
 */
export async function getEntityWithTypeId(entityId: string): Promise<{ entity: BundleEntity; typeId: string } | null> {
  const db = getDatabase();
  
  const entityRow = db.collections.entities.get(entityId);
  if (!entityRow) return null;
  
  return {
    entity: {
      id: entityRow.id,
      status: entityRow.status as any,
      name: entityRow.name,
      slug: entityRow.slug,
      data: entityRow.data,
      updatedAt: entityRow.updatedAt,
    },
    typeId: entityRow.typeId,
  };
}

/**
 * Get entity by type ID and slug
 * TanStack DB: use Array.from().filter() instead of query()
 */
export async function getEntityBySlug(
  typeId: string,
  slug: string
): Promise<BundleEntity | null> {
  const db = getDatabase();
  
  const allEntities = Array.from(db.collections.entities.values()) as EntityRow[];
  const entityRow = allEntities.find((e: EntityRow) => e.typeId === typeId && e.slug === slug);
  
  if (!entityRow) return null;
  
  return {
    id: entityRow.id,
    status: entityRow.status as any,
    name: entityRow.name,
    slug: entityRow.slug,
    data: entityRow.data,
    updatedAt: entityRow.updatedAt,
  };
}

/**
 * Get all entity types for a manifest
 * TanStack DB: use Array.from().filter() instead of query()
 */
export async function getEntityTypesForManifest(
  manifestId: string
): Promise<ManifestEntityType[]> {
  const db = getDatabase();
  
  const allTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  console.log('[DB] getEntityTypesForManifest: Looking for manifestId:', manifestId);
  console.log('[DB] Total entity types in DB:', allTypes.length);
  console.log('[DB] Entity types by manifestId:', 
    allTypes.reduce((acc, t) => {
      acc[t.manifestId] = (acc[t.manifestId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  );
  
  const typeRows = allTypes.filter((t: EntityTypeRow) => t.manifestId === manifestId);
  console.log('[DB] Found', typeRows.length, 'entity types for manifestId:', manifestId);
  
  return typeRows.map(t => ({
    id: t.id,
    name: t.name,
    pluralName: t.pluralName,
    slug: t.slug,
    description: t.description,
    entityCount: t.entityCount,
    lastUpdated: t.lastUpdated,
  }));
}

/**
 * Debug function to check DB contents
 * Also checks localStorage directly to verify persistence
 */
export function debugDatabase() {
  const db = getDatabase();
  
  const manifests = Array.from(db.collections.manifests.values()) as ManifestRow[];
  const entityTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  const bundles = Array.from(db.collections.bundles.values()) as BundleRow[];
  const entities = Array.from(db.collections.entities.values()) as EntityRow[];
  
  // Also check localStorage directly
  const localStorageManifests = localStorage.getItem('1cc-portal-manifests');
  const localStorageEntityTypes = localStorage.getItem('1cc-portal-entity-types');
  const localStorageBundles = localStorage.getItem('1cc-portal-bundles');
  const localStorageEntities = localStorage.getItem('1cc-portal-entities');
  
  console.log('[DB] ===== Database Debug =====');
  console.log('[DB] In-Memory Collections:');
  console.log('  Manifests:', manifests.length, manifests.map(m => `${m.id} (v${m.version})`));
  console.log('  Entity Types:', entityTypes.length, entityTypes.map(t => `${t.id} (manifest: ${t.manifestId})`));
  console.log('  Bundles:', bundles.length, bundles.map(b => `${b.id} (${b.entityCount} entities)`));
  console.log('  Entities:', entities.length, entities.slice(0, 10).map(e => e.id), entities.length > 10 ? '...' : '');
  
  console.log('[DB] localStorage (raw):');
  try {
    if (localStorageManifests) {
      const parsed = JSON.parse(localStorageManifests);
      console.log('  Manifests:', Array.isArray(parsed) ? parsed.length + ' items' : 'not an array', parsed);
    } else {
      console.log('  Manifests: empty');
    }
  } catch (e) {
    console.error('  Manifests: parse error', e);
  }
  
  try {
    if (localStorageEntityTypes) {
      const parsed = JSON.parse(localStorageEntityTypes);
      console.log('  Entity Types:', Array.isArray(parsed) ? parsed.length + ' items' : 'not an array');
    } else {
      console.log('  Entity Types: empty');
    }
  } catch (e) {
    console.error('  Entity Types: parse error', e);
  }
  
  try {
    if (localStorageBundles) {
      const parsed = JSON.parse(localStorageBundles);
      console.log('  Bundles:', Array.isArray(parsed) ? parsed.length + ' items' : 'not an array');
    } else {
      console.log('  Bundles: empty');
    }
  } catch (e) {
    console.error('  Bundles: parse error', e);
  }
  
  try {
    if (localStorageEntities) {
      const parsed = JSON.parse(localStorageEntities);
      console.log('  Entities:', Array.isArray(parsed) ? parsed.length + ' items' : 'not an array');
    } else {
      console.log('  Entities: empty');
    }
  } catch (e) {
    console.error('  Entities: parse error', e);
  }
  
  if (manifests.length === 0 && localStorageManifests) {
    console.warn('[DB] WARNING: localStorage has data but collections are empty - hydration may have failed!');
  }
  
  return {
    manifests: manifests.length,
    entityTypes: entityTypes.length,
    bundles: bundles.length,
    entities: entities.length,
  };
}

/**
 * Clear all data (useful for testing or reset)
 * TanStack DB: use Array.from(collection.values()) instead of findAll()
 */
export async function clearDatabase(): Promise<void> {
  const db = getDatabase();
  
  // Clear all collections
  const manifests = Array.from(db.collections.manifests.values()) as ManifestRow[];
  for (const m of manifests) {
    const tx = db.collections.manifests.delete(m.id);
    await tx.isPersisted.promise;
  }
  
  const entityTypes = Array.from(db.collections.entityTypes.values()) as EntityTypeRow[];
  for (const et of entityTypes) {
    const tx = db.collections.entityTypes.delete(et.id);
    await tx.isPersisted.promise;
  }
  
  const bundles = Array.from(db.collections.bundles.values()) as BundleRow[];
  for (const b of bundles) {
    const tx = db.collections.bundles.delete(b.id);
    await tx.isPersisted.promise;
  }
  
  const entities = Array.from(db.collections.entities.values()) as EntityRow[];
  for (const e of entities) {
    const tx = db.collections.entities.delete(e.id);
    await tx.isPersisted.promise;
  }
  
  console.log('[DB] Database cleared');
}
