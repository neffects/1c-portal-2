# TanStack DB Migration Status

## Overview

This document tracks which UI components are using the sync store (signals/Maps) vs TanStack DB for data access. Components should be migrated to use TanStack DB for offline-first functionality.

## Current State

### ✅ Using TanStack DB
- `apps/web/src/stores/db.ts` - Database implementation with LocalStorageCollection
- `apps/web/src/stores/sync.tsx` - Syncs bundles to DB when loaded
- `apps/web/src/stores/query-sync.ts` - TanStack Query hooks (optional, not widely used)

### ❌ NOT Using TanStack DB (Using Sync Store Instead)

All these components use `useSync()` hook which provides data from signals/Maps instead of querying TanStack DB:

#### Public Pages
1. **`apps/web/src/pages/Home.tsx`**
   - Uses: `entityTypes.value` (computed signal)
   - Should use: `getEntityTypesForManifest()` from DB

2. **`apps/web/src/pages/Browse.tsx`**
   - Uses: `getEntityType()`, `getBundle()` from sync store
   - Should use: `getEntityType()`, `getBundle()` from DB

3. **`apps/web/src/pages/EntityDetail.tsx`**
   - Uses: `getEntityType()`, `getEntityBySlug()` from sync store
   - Should use: `getEntityType()`, `getEntityBySlug()` from DB

4. **`apps/web/src/pages/Search.tsx`**
   - Uses: `entityTypes.value` (computed signal)
   - Should use: `getEntityTypesForManifest()` from DB
   - Note: Search results come from API, but entity types should come from DB

#### Admin Pages
5. **`apps/web/src/pages/admin/EntityEditor.tsx`**
   - Uses: `useSync()` hook (likely for entity types)
   - Should use: DB queries for entity types

6. **`apps/web/src/pages/admin/EntityView.tsx`**
   - Uses: `useSync()` hook
   - Should use: DB queries

#### Superadmin Pages
7. **`apps/web/src/pages/superadmin/SuperEntityEditor.tsx`**
   - Uses: `useSync()` hook
   - Should use: DB queries

8. **`apps/web/src/pages/superadmin/SuperEntityView.tsx`**
   - Uses: `useSync()` hook
   - Should use: DB queries

9. **`apps/web/src/pages/superadmin/BundleManagement.tsx`**
   - Uses: `bundles.value.get()` (Map access)
   - Should use: `getBundle()` from DB

10. **`apps/web/src/pages/superadmin/TypeManager.tsx`**
    - Uses: `useSync()` hook
    - Should use: DB queries

#### Components
11. **`apps/web/src/components/fields/LinkField.tsx`**
    - Uses: `entityTypes.value.find()` (signal access)
    - Should use: `getEntityType()` from DB
    - Also makes API calls for entity search - could use DB for local entities

12. **`apps/web/src/components/Layout.tsx`**
    - Uses: `isOffline`, `syncing` from sync store (status only, OK to keep)

13. **`apps/web/src/pages/Alerts.tsx`**
    - Uses: `getEntity()`, `getEntityType()` from sync store
    - Should use: `getEntity()`, `getEntityType()` from DB

#### Debug Panel
14. **`apps/web/src/components/DebugPanel.tsx`**
    - Uses: Both sync store AND DB (for debugging)
    - Status: OK - debug panel can show both

## Migration Strategy

### Phase 1: Create DB Query Hooks
Create React hooks that wrap DB queries for easier component usage:

```typescript
// apps/web/src/hooks/useDB.ts
import { useEffect, useState } from 'preact/hooks';
import { getEntityType, getBundle, getEntityBySlug, getEntityTypesForManifest } from '../stores/db';

export function useEntityType(idOrSlug: string) {
  const [entityType, setEntityType] = useState(null);
  useEffect(() => {
    getEntityType(idOrSlug).then(setEntityType);
  }, [idOrSlug]);
  return entityType;
}

export function useBundle(manifestId: string, typeId: string) {
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    getBundle(manifestId, typeId).then(setBundle);
  }, [manifestId, typeId]);
  return bundle;
}

// etc...
```

### Phase 2: Migrate Components
Replace `useSync()` data access with DB hooks:

**Before:**
```typescript
const { getEntityType, getBundle } = useSync();
const entityType = getEntityType(typeSlug);
const bundle = getBundle(entityType?.id);
```

**After:**
```typescript
import { useEntityType, useBundle } from '../hooks/useDB';
const entityType = useEntityType(typeSlug);
const bundle = useBundle('platform', entityType?.id);
```

### Phase 3: Update Sync Store
Keep sync store for:
- Sync status (`syncing`, `lastSyncedAt`, `syncError`)
- Sync actions (`sync()`, `loadFromCache()`, `clearCache()`)
- Remove data access functions (move to DB hooks)

## Benefits of Migration

1. **Offline-First**: Components work offline with cached DB data
2. **Persistence**: Data survives page reloads (LocalStorageCollection)
3. **Cross-Tab Sync**: Changes sync across browser tabs automatically
4. **Better Performance**: Indexed queries faster than Map lookups
5. **Consistency**: Single source of truth (DB) instead of signals + Maps

## Priority Order

1. **High Priority** (User-facing pages):
   - `Browse.tsx` - Main content browsing
   - `EntityDetail.tsx` - Entity detail pages
   - `Home.tsx` - Landing page with entity types

2. **Medium Priority** (Admin features):
   - `EntityEditor.tsx` - Entity editing
   - `LinkField.tsx` - Entity linking in forms

3. **Low Priority** (Internal/admin):
   - `BundleManagement.tsx` - Debug/admin tool
   - `Alerts.tsx` - User alerts (can work with sync store for now)

## Notes

- Search page (`Search.tsx`) makes API calls for search results - this is correct, but entity types should come from DB
- LinkField makes API calls for entity search - could be enhanced to search local DB first, then API
- Sync store still needed for sync status and actions, just not for data access
