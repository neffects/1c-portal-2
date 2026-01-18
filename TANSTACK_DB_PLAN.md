# TanStack DB Integration Plan

## Overview

Replace the current localStorage-based caching system with TanStack DB for proper offline-first data storage and querying. This enables true offline functionality with indexed queries, reactive updates, and better performance.

## Current State Analysis

### Current Architecture (`apps/web/src/stores/sync.tsx`)
- **Storage**: localStorage (JSON strings)
  - `manifest` - SiteManifest JSON
  - `bundles` - Array of [typeId, EntityBundle] tuples
  - `orgManifest` - Org-specific SiteManifest
  - `orgBundles` - Array of [typeId, EntityBundle] tuples
- **State Management**: Preact signals for reactivity
- **Sync Strategy**: 
  - Fetch manifests with version numbers
  - Compare bundle versions to detect updates
  - Store entire bundles/entities in memory (Map structures)
  - Cache JSON in localStorage for offline access

### Data Flow (Current)
1. **Initial Load**: Load from localStorage cache → Fetch from API → Update signals → Cache to localStorage
2. **Sync Triggers**: 
   - Page load
   - Auth state changes
   - Periodic (5 minutes)
   - Online/offline transitions
3. **Update Detection**: Compare manifest `version` and bundle `version` numbers

### Data Flow (With TanStack DB)
1. **Initial Load**: Load from DB → Fetch from API (if stale) → Write to DB → Update signals
2. **Sync Triggers**: Same as current (manual sync function)
3. **Update Detection**: DB checks version numbers before fetching from API
4. **Components**: Query DB directly (offline-first) instead of Map lookups

**Note**: We're NOT using TanStack Query. The existing `sync()` function handles API fetching. TanStack DB replaces localStorage and Map storage only.

### Bundle Update Triggers (Server-side)
Manifests and bundles are regenerated when:
- Entity created/updated/deleted → Bundle version increments
- Entity status changes (publish/unpublish) → Bundle version increments  
- Entity type metadata changes → Manifest version increments
- Entity type `visibleTo` changes → Bundle regeneration + manifest update
- Organization permissions change → Org manifest + bundle regeneration

## TanStack DB + Query Architecture

### Two-Layer Approach

**TanStack Query** (Server State Layer):
- Fetches manifests and bundles from API
- Maintains connection/cache of server responses
- Handles refetching, revalidation, background updates
- Writes data to TanStack DB after successful fetches

**TanStack DB** (Local Storage Layer):
- Stores all manifest/bundle/entity data locally
- Components query DB directly (offline-first)
- Indexed queries for fast lookups
- Persists data across page reloads

### Installation

```bash
npm install @tanstack/db                    # Local database (already installed)
npm install @tanstack/query-core            # Query core (server state management)
npm install @preact-signals/query           # Preact adapter for TanStack Query
```

**Current Status**:
- ✅ `@tanstack/db` installed (version 0.5.20)
- ❌ TanStack Query not installed (using custom `api` utility)

### Architecture Decision: Use TanStack Query + TanStack DB

**Recommended Approach**: Use TanStack Query for API fetching + TanStack DB for local storage

**Benefits of TanStack Query**:
- ✅ Automatic request caching and deduplication
- ✅ Background refetching and stale-while-revalidate
- ✅ Built-in error handling and retry logic
- ✅ DevTools for debugging
- ✅ Handles request cancellation automatically
- ✅ Works with `@preact-signals/query` (Preact adapter)

**Data Flow with Query + DB**:
1. TanStack Query fetches bundles from API (with caching)
2. On success: Write to TanStack DB (persist locally)
3. Components query TanStack DB directly (offline-first)
4. Query handles background refetching automatically
5. DB updates trigger signal updates for UI reactivity

**Alternative (DB Only)**:
- Current `sync()` function (works but more manual)
- Less caching/refetching logic
- More error handling code needed

### Schema Design

```typescript
// Database schema for TanStack DB (or IndexedDB)

interface DatabaseSchema {
  manifests: {
    id: string; // 'platform' | 'public' | 'org:${orgId}:member' | 'org:${orgId}:admin'
    version: number;
    generatedAt: string;
    entityTypes: ManifestEntityType[];
    config: AppConfig | null;
    syncedAt: string; // Last sync timestamp
  };
  
  entityTypes: {
    id: string; // Entity type ID
    manifestId: string; // FK to manifests.id
    name: string;
    pluralName: string;
    slug: string;
    description?: string;
    entityCount: number;
    bundleVersion: number;
    lastUpdated: string;
  };
  
  bundles: {
    id: string; // `${manifestId}:${typeId}` - composite key
    manifestId: string; // FK to manifests.id
    typeId: string;
    typeName: string;
    version: number;
    generatedAt: string;
    entityCount: number;
    syncedAt: string;
  };
  
  entities: {
    id: string; // Entity ID
    bundleId: string; // FK to bundles.id
    typeId: string; // Denormalized for faster queries
    status: EntityStatus;
    name: string;
    slug: string;
    data: Record<string, unknown>; // Dynamic fields
    updatedAt: string;
    // Indexes: typeId, status, slug, bundleId
  };
}
```

### Store Structure

**File**: `apps/web/src/stores/db.ts` (new file)

```typescript
/**
 * TanStack DB / IndexedDB Store
 * 
 * Manages offline-first data storage with indexing and queries.
 * Automatically syncs with server manifests and bundles.
 */

import { createDatabase, createTable } from '@tanstack/react-table'; // or custom IndexedDB wrapper
import type { 
  SiteManifest, 
  EntityBundle, 
  BundleEntity, 
  ManifestEntityType 
} from '@1cc/shared';

// Database initialization
const db = createDatabase({
  name: '1cc-portal',
  version: 1,
  tables: [
    // Manifests table
    createTable<ManifestRow>({
      name: 'manifests',
      primaryKey: 'id',
      indexes: ['version', 'syncedAt']
    }),
    
    // Entity types table (indexed by manifest)
    createTable<EntityTypeRow>({
      name: 'entityTypes',
      primaryKey: 'id',
      indexes: ['manifestId', 'slug', 'typeId']
    }),
    
    // Bundles table
    createTable<BundleRow>({
      name: 'bundles',
      primaryKey: 'id',
      indexes: ['manifestId', 'typeId', 'version']
    }),
    
    // Entities table (from bundles)
    createTable<EntityRow>({
      name: 'entities',
      primaryKey: 'id',
      indexes: ['bundleId', 'typeId', 'status', 'slug']
    })
  ]
});

// Sync functions
async function syncManifest(manifestId: string, manifest: SiteManifest) {
  // 1. Check if manifest version changed
  const existing = await db.manifests.get(manifestId);
  const versionChanged = !existing || existing.version < manifest.version;
  
  if (versionChanged) {
    // 2. Store manifest
    await db.manifests.set(manifestId, {
      id: manifestId,
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      entityTypes: manifest.entityTypes,
      config: manifest.config || null,
      syncedAt: new Date().toISOString()
    });
    
    // 3. Update entity types
    await syncEntityTypes(manifestId, manifest.entityTypes);
    
    // 4. Trigger bundle sync for changed types
    await syncBundlesForManifest(manifestId, manifest.entityTypes);
  }
}

async function syncBundle(bundleId: string, bundle: EntityBundle, manifestId: string) {
  // 1. Check bundle version
  const existing = await db.bundles.get(bundleId);
  const versionChanged = !existing || existing.version < bundle.version;
  
  if (versionChanged) {
    // 2. Store bundle metadata
    await db.bundles.set(bundleId, {
      id: bundleId,
      manifestId,
      typeId: bundle.typeId,
      typeName: bundle.typeName,
      version: bundle.version,
      generatedAt: bundle.generatedAt,
      entityCount: bundle.entityCount,
      syncedAt: new Date().toISOString()
    });
    
    // 3. Update entities (delete old, insert new)
    await syncEntities(bundleId, bundle.typeId, bundle.entities);
  }
}

async function syncEntities(bundleId: string, typeId: string, entities: BundleEntity[]) {
  // Delete existing entities for this bundle
  const existing = await db.entities.query({ bundleId });
  const existingIds = new Set(existing.map(e => e.id));
  const newIds = new Set(entities.map(e => e.id));
  
  // Remove entities no longer in bundle
  for (const entityId of existingIds) {
    if (!newIds.has(entityId)) {
      await db.entities.delete(entityId);
    }
  }
  
  // Upsert entities
  for (const entity of entities) {
    await db.entities.set({
      id: entity.id,
      bundleId,
      typeId,
      status: entity.status,
      name: entity.name,
      slug: entity.slug,
      data: entity.data,
      updatedAt: entity.updatedAt
    });
  }
}
```

## Implementation Plan

### Phase 1: Database Setup & Migration

**1.1 Install Dependencies**
- Install `@tanstack/react-table` (or IndexedDB wrapper like `idb`)
- If TanStack DB not ready, use `idb` + TanStack Query

**1.2 Create Database Schema** (`apps/web/src/stores/db.ts`)
- Define database schema with tables: manifests, entityTypes, bundles, entities
- Set up indexes for common queries (typeId, status, slug, bundleId)
- Migration logic for schema versioning

**1.3 Migration from localStorage**
- Read existing localStorage data on first load
- Migrate to indexed database
- Keep localStorage as fallback during migration period

### Phase 2: Replace Sync Store

**2.1 Update Sync Logic** (`apps/web/src/stores/sync.tsx`)
- Replace localStorage writes with DB writes
- Replace Map-based in-memory storage with DB queries
- Keep Preact signals for reactivity (query DB when signals update)

**2.2 Query Functions**
```typescript
// Replace getBundle(typeId) with DB query
async function getBundle(typeId: string): Promise<EntityBundle | undefined> {
  const bundle = await db.bundles.query({ typeId }).first();
  if (!bundle) return undefined;
  
  const entities = await db.entities.query({ bundleId: bundle.id });
  return {
    ...bundle,
    entities: entities.map(e => ({
      id: e.id,
      status: e.status,
      name: e.name,
      slug: e.slug,
      data: e.data,
      updatedAt: e.updatedAt
    }))
  };
}

// Replace getEntity(entityId) with DB query
async function getEntity(entityId: string): Promise<BundleEntity | undefined> {
  return await db.entities.get(entityId);
}

// Replace getEntityBySlug(typeId, slug) with indexed query
async function getEntityBySlug(typeId: string, slug: string): Promise<BundleEntity | undefined> {
  return await db.entities.query({ typeId, slug }).first();
}
```

**2.3 Sync Trigger Integration**
- On manifest fetch: Call `syncManifest()` → checks version → updates if changed
- On bundle fetch: Call `syncBundle()` → checks version → updates entities if changed
- Maintain existing sync triggers (auth change, periodic, online/offline)

### Phase 3: Reactive Updates

**3.1 Signal Integration**
- Keep Preact signals for UI reactivity
- Update signals when DB queries return new data
- Use DB change listeners to update signals automatically

**3.2 Manifest Version Monitoring**
- Check manifest version on sync
- When version increments: identify changed entity types
- Trigger bundle sync for changed types automatically

**3.3 Bundle Version Monitoring**
- Check bundle version on sync
- When version increments: replace entities in that bundle
- Update entity indexes automatically

### Phase 4: Query Optimization

**4.1 Indexed Queries**
- Use DB indexes for common queries (by typeId, status, slug)
- Replace in-memory Map lookups with indexed DB queries
- Cache frequently accessed queries in memory (optional)

**4.2 Pagination Support**
- Query entities with limit/offset for large bundles
- Lazy-load entities as needed (virtual scrolling support)

### Phase 5: Offline Support

**5.1 Offline-First Queries**
- All queries hit DB first (no network call unless sync needed)
- Background sync updates DB asynchronously
- UI always shows latest DB state (may be slightly stale)

**5.2 Sync Status**
- Track sync state per manifest/bundle
- Show "Last synced" timestamps
- Indicate stale data with visual indicators

## File Structure

```
apps/web/src/
├── stores/
│   ├── db.ts              # NEW: Database schema, initialization, sync functions
│   ├── sync.tsx           # UPDATED: Use DB instead of localStorage + Maps
│   └── auth.tsx           # No changes
├── lib/
│   └── db/                # NEW: Database utilities
│       ├── migrations.ts  # Schema migrations
│       ├── queries.ts     # Reusable query functions
│       └── indexes.ts     # Index definitions
└── ...
```

## API Integration Points

### Current Sync Flow
1. `sync()` function in `sync.tsx` calls API endpoints:
   - `GET /api/manifests/site` → `syncManifest('platform', manifest)`
   - `GET /api/bundles/:typeId` → `syncBundle(bundleId, bundle, 'platform')`
   - `GET /api/orgs/:orgId/manifests/site` → `syncManifest(orgManifestId, manifest)`
   - `GET /api/orgs/:orgId/bundles/:typeId` → `syncBundle(orgBundleId, bundle, orgManifestId)`

### Updated Sync Flow
- Same API endpoints
- Response handling: Check version → Update DB if changed → Update signals
- All queries from components hit DB directly (no API calls)

## Benefits

### TanStack DB Benefits
1. **True Offline Support**: Indexed queries work offline, no localStorage size limits
2. **Better Performance**: Indexed queries faster than Map lookups for large datasets
3. **Query Flexibility**: Can query by any indexed field (status, slug, typeId)
4. **Automatic Updates**: DB change listeners update UI automatically
5. **Scalability**: Handles large entity sets better than in-memory Maps
6. **Data Integrity**: ACID transactions, structured schema

### TanStack Query Benefits (if added)
1. **Automatic Caching**: Request deduplication, smart cache invalidation
2. **Background Refetching**: Stale-while-revalidate pattern
3. **Error Handling**: Built-in retry logic, error states
4. **Request Cancellation**: Automatic cleanup on unmount
5. **DevTools**: Query DevTools for debugging
6. **Optimistic Updates**: Update UI before server confirms

### Combined Benefits (Query + DB)
- **Best of Both**: Query handles server state, DB handles local persistence
- **Offline-First**: Components query DB, Query syncs in background
- **Resilient**: Works offline, syncs when online
- **Performant**: Query cache + DB indexes = fast queries

## Migration Strategy

### Step 1: Dual Mode (Weeks 1-2)
- Keep localStorage sync working
- Add DB sync in parallel
- Compare results for validation

### Step 2: DB Primary (Week 3)
- Switch to DB as primary storage
- Keep localStorage as backup/fallback
- Monitor for issues

### Step 3: Remove localStorage (Week 4)
- Remove localStorage sync code
- Remove localStorage read/write paths
- Clean up old cache data

## Testing Considerations

1. **Database Tests**: Test schema creation, migrations, indexes
2. **Sync Tests**: Test manifest/bundle version detection
3. **Query Tests**: Test indexed queries return correct results
4. **Migration Tests**: Test localStorage → DB migration
5. **Offline Tests**: Test queries work offline
6. **Performance Tests**: Compare DB queries vs Map lookups

## Dependencies

### Recommended: TanStack Query + TanStack DB
```json
{
  "@tanstack/db": "^0.5.20",              // Already installed
  "@tanstack/query-core": "^5.x",         // Core query functionality
  "@preact-signals/query": "^1.x"         // Preact adapter (uses Preact signals)
}
```

### Alternative: IndexedDB + TanStack Query (if DB not stable)
```json
{
  "idb": "^8.x",                          // IndexedDB wrapper
  "@tanstack/query-core": "^5.x",
  "@preact-signals/query": "^1.x"
}
```

**Note**: We're using Preact, so `@preact-signals/query` provides Query hooks compatible with Preact signals.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| TanStack DB not production-ready | Use `idb` library with custom sync layer |
| Migration data loss | Dual-mode operation during migration |
| Performance regression | Benchmark before/after, optimize queries |
| Browser compatibility | Use IndexedDB polyfill if needed |
| Storage quota limits | Monitor usage, implement cleanup/GC |

## Success Criteria

- ✅ All entity queries work offline
- ✅ Manifest/bundle updates sync automatically
- ✅ Query performance equal or better than Map lookups
- ✅ No data loss during migration
- ✅ Existing UI components work without changes
- ✅ Offline indicator shows accurate sync status

## Timeline

- **Week 1**: Database setup, schema design, basic CRUD operations
- **Week 2**: Sync functions, manifest/bundle version detection
- **Week 3**: Replace sync store, dual-mode operation
- **Week 4**: Remove localStorage, testing, optimization

## Next Steps

1. **Decide on library**: TanStack DB vs `idb` + TanStack Query
2. **Create database schema file**: `apps/web/src/stores/db.ts`
3. **Implement basic CRUD**: Create/read/update/delete for manifests and bundles
4. **Update sync store**: Replace localStorage with DB calls
5. **Test offline functionality**: Verify queries work without network
6. **Monitor performance**: Compare DB queries vs current Map lookups
