# TanStack Query Server Connection Strategy

## Overview

Best practices for keeping TanStack Query synchronized with server data, especially for manifests and bundles that change when entities are created/updated.

## Key Server Characteristics

### Bundle Update Frequency
- **Low frequency**: Bundles change only when entities are created/updated/deleted
- **Version-based**: Each bundle has a `version` number that increments on changes
- **Manifest versions**: Manifests increment when entity types change
- **Sync config**: Server suggests `bundleRefreshInterval: 300000` (5 minutes)

### Server Behavior
- Bundles are **regenerated synchronously** when entities change
- Manifest `version` field uses timestamp (`Date.now()`) for uniqueness
- Bundle `version` also uses timestamp for uniqueness
- Version comparison: client checks `bundle.version < manifest.bundleVersion` to detect updates

## Recommended TanStack Query Strategy

### 1. Stale-While-Revalidate (Primary Pattern)

**Best for**: Manifests and bundles (low-change frequency data)

```typescript
import { useQuery } from '@preact-signals/query';

// Manifest query
const { data: manifest } = useQuery({
  queryKey: ['manifest', manifestId],
  queryFn: () => fetchManifest(manifestId),
  
  // Data is fresh for 1 minute (from sync config)
  staleTime: 60 * 1000,
  
  // Keep in cache for 24 hours
  gcTime: 24 * 60 * 60 * 1000,
  
  // Refetch on window focus (user returns to tab)
  refetchOnWindowFocus: true,
  
  // Refetch on network reconnect
  refetchOnReconnect: true,
  
  // Refetch in background when stale
  refetchInterval: 5 * 60 * 1000, // 5 minutes (from sync config)
  
  // Write to TanStack DB on success
  onSuccess: (manifest) => {
    syncManifestToDB(manifestId, manifest);
  }
});

// Bundle query with version checking
const { data: bundle } = useQuery({
  queryKey: ['bundle', manifestId, typeId],
  queryFn: () => fetchBundle(manifestId, typeId),
  
  // Stale after 1 minute
  staleTime: 60 * 1000,
  
  // Refetch only if version changed (check DB first)
  enabled: async () => {
    const dbBundle = await getBundleFromDB(manifestId, typeId);
    const manifest = await getManifestFromDB(manifestId);
    if (!dbBundle || !manifest) return true;
    
    const typeEntry = manifest.entityTypes.find(t => t.id === typeId);
    // Only refetch if bundle version is outdated
    return !typeEntry || dbBundle.version < typeEntry.bundleVersion;
  },
  
  // Write to DB on success
  onSuccess: (bundle) => {
    syncBundleToDB(manifestId, typeId, bundle);
  }
});
```

### 2. Version-Based Refetching (Smart Strategy)

**Best for**: Avoiding unnecessary refetches when data hasn't changed

```typescript
// Custom hook for version-aware bundle fetching
function useVersionedBundle(manifestId: string, typeId: string) {
  const { data: manifest } = useQuery({
    queryKey: ['manifest', manifestId],
    queryFn: () => fetchManifest(manifestId),
    staleTime: 60 * 1000,
  });
  
  // Check DB first for current version
  const dbBundle = useMemo(async () => {
    return await getBundleFromDB(manifestId, typeId);
  }, [manifestId, typeId]);
  
  // Determine if refetch is needed
  const needsRefetch = useMemo(() => {
    if (!manifest || !dbBundle) return true;
    const typeEntry = manifest.entityTypes.find(t => t.id === typeId);
    return !typeEntry || dbBundle.version < typeEntry.bundleVersion;
  }, [manifest, dbBundle, typeId]);
  
  const { data: bundle, refetch } = useQuery({
    queryKey: ['bundle', manifestId, typeId],
    queryFn: () => fetchBundle(manifestId, typeId),
    enabled: needsRefetch, // Only fetch if version changed
    staleTime: Infinity, // Don't auto-refetch (use version check)
    
    onSuccess: (bundle) => {
      syncBundleToDB(manifestId, typeId, bundle);
    }
  });
  
  // Return DB bundle if query not enabled (offline-first)
  return needsRefetch ? bundle : dbBundle;
}
```

### 3. Background Refetching (Keep Data Fresh)

**Best for**: Long-lived tabs, keeping data current without user action

```typescript
const queryClient = useQueryClient();

// Global refetch configuration
const queryClientConfig = {
  defaultOptions: {
    queries: {
      // Refetch in background when data becomes stale
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      
      // Background refetch interval (only when tab is active)
      refetchInterval: (query) => {
        // Only refetch manifests/bundles, not individual entities
        const queryKey = query.queryKey;
        if (queryKey[0] === 'manifest' || queryKey[0] === 'bundle') {
          return 5 * 60 * 1000; // 5 minutes
        }
        return false; // No auto-refetch for other queries
      },
      
      // Pause refetching when tab is inactive (save bandwidth)
      refetchIntervalInBackground: false,
    }
  }
};
```

### 4. Optimistic Updates & Cache Invalidation (On Mutations)

**Best for**: Immediate UI updates when user creates/updates entities

```typescript
import { useMutation, useQueryClient } from '@preact-signals/query';

function useCreateEntity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (entity: CreateEntityRequest) => createEntity(entity),
    
    // Invalidate related queries after successful mutation
    onSuccess: (entity, variables) => {
      // Invalidate manifest (entity type count changed)
      queryClient.invalidateQueries({ 
        queryKey: ['manifest'] 
      });
      
      // Invalidate bundle for this type (version will change)
      queryClient.invalidateQueries({ 
        queryKey: ['bundle', variables.organizationId, variables.entityTypeId] 
      });
      
      // Refetch bundle to get latest version
      queryClient.refetchQueries({ 
        queryKey: ['bundle'] 
      });
    },
    
    // Optimistic update: update UI before server confirms
    onMutate: async (newEntity) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['bundle'] });
      
      // Snapshot previous value
      const previousBundle = queryClient.getQueryData(['bundle', ...]);
      
      // Optimistically update cache
      queryClient.setQueryData(['bundle', ...], (old) => {
        // Add new entity to bundle optimistically
        return {
          ...old,
          entities: [...old.entities, newEntity],
          entityCount: old.entityCount + 1,
        };
      });
      
      return { previousBundle };
    },
    
    // Rollback on error
    onError: (err, variables, context) => {
      queryClient.setQueryData(['bundle', ...], context.previousBundle);
    }
  });
}
```

### 5. Offline-First with Query + DB Integration

**Best for**: Offline support, fast initial loads

```typescript
// Custom query function that checks DB first
async function fetchBundleWithDBFallback(
  manifestId: string, 
  typeId: string
): Promise<EntityBundle> {
  // 1. Try DB first (offline-first)
  const dbBundle = await getBundleFromDB(manifestId, typeId);
  if (dbBundle && isFresh(dbBundle)) {
    return dbBundle;
  }
  
  // 2. Fetch from API
  const apiBundle = await fetchBundle(manifestId, typeId);
  
  // 3. Write to DB
  await syncBundleToDB(manifestId, typeId, apiBundle);
  
  return apiBundle;
}

// Query configuration
const { data: bundle } = useQuery({
  queryKey: ['bundle', manifestId, typeId],
  queryFn: () => fetchBundleWithDBFallback(manifestId, typeId),
  
  // Always return DB data immediately (offline-first)
  placeholderData: async () => {
    return await getBundleFromDB(manifestId, typeId);
  },
  
  // Long stale time (we check versions manually)
  staleTime: 60 * 1000,
  
  // Network mode: always use cache if available
  networkMode: 'offlineFirst',
});
```

## Recommended Configuration

### Query Client Setup

```typescript
import { QueryClient } from '@tanstack/query-core';
import { createQueryClient } from '@preact-signals/query';

export const queryClient = createQueryClient({
  defaultOptions: {
    queries: {
      // Stale time: 1 minute (from sync config)
      staleTime: 60 * 1000,
      
      // Cache time: 24 hours
      gcTime: 24 * 60 * 60 * 1000,
      
      // Refetch on window focus (user returns to tab)
      refetchOnWindowFocus: true,
      
      // Refetch on network reconnect
      refetchOnReconnect: true,
      
      // Retry failed requests
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      // Network mode: prefer cache, fetch if needed
      networkMode: 'online',
    },
  },
});
```

### Manifest Query Configuration

```typescript
// Manifest queries: Check periodically, refetch on focus/reconnect
const manifestQueryConfig = {
  staleTime: 60 * 1000, // 1 minute
  refetchInterval: 5 * 60 * 1000, // 5 minutes (background)
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
};
```

### Bundle Query Configuration

```typescript
// Bundle queries: Version-based, less frequent refetching
const bundleQueryConfig = {
  staleTime: 60 * 1000, // 1 minute
  refetchInterval: false, // Don't auto-refetch (use version check)
  refetchOnWindowFocus: true, // But refetch when user returns
  refetchOnReconnect: true, // And when network reconnects
};
```

## Strategy Comparison

| Strategy | Best For | Pros | Cons |
|----------|----------|------|------|
| **Stale-While-Revalidate** | All queries | Simple, always fresh | More network requests |
| **Version-Based** | Manifests/Bundles | Efficient, smart refetching | More complex logic |
| **Background Refetch** | Long-lived tabs | Keeps data fresh | Uses bandwidth in background |
| **Optimistic Updates** | Mutations | Instant UI feedback | Complex rollback logic |
| **Offline-First** | Offline support | Works offline, fast | Requires DB integration |

## Recommended Combined Strategy

For this application, use a **hybrid approach**:

1. **Manifests**: Stale-while-revalidate with 5-minute background refetch
   - Frequently accessed (needs to stay fresh)
   - Low change frequency (efficient)

2. **Bundles**: Version-based with offline-first
   - Check DB first for current version
   - Only refetch if `bundle.version < manifest.bundleVersion`
   - Background refetch when tab active (5 minutes)

3. **Mutations**: Optimistic updates + cache invalidation
   - Immediate UI feedback
   - Invalidate related queries
   - Write to DB on success

4. **Network States**: Refetch on reconnect/focus
   - Always sync when user returns
   - Sync when network reconnects

## Implementation Example

```typescript
// apps/web/src/stores/query-sync.ts
import { useQuery, useQueryClient } from '@preact-signals/query';
import { syncManifest, syncBundle, getManifest, getBundle } from './db';

/**
 * Hook for fetching manifest with automatic DB sync
 */
export function useManifest(manifestId: string) {
  return useQuery({
    queryKey: ['manifest', manifestId],
    queryFn: async () => {
      const response = await api.get(`/api/manifests/site`);
      if (response.success && response.data) {
        await syncManifest(manifestId, response.data);
        return response.data;
      }
      throw new Error('Failed to fetch manifest');
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: () => getManifest(manifestId), // Offline-first
  });
}

/**
 * Hook for fetching bundle with version-based refetching
 */
export function useBundle(manifestId: string, typeId: string) {
  const { data: manifest } = useManifest(manifestId);
  
  // Check if bundle needs updating
  const needsUpdate = useMemo(() => {
    if (!manifest) return true;
    const dbBundle = getBundle(manifestId, typeId);
    const typeEntry = manifest.entityTypes.find(t => t.id === typeId);
    return !dbBundle || !typeEntry || dbBundle.version < typeEntry.bundleVersion;
  }, [manifest, manifestId, typeId]);
  
  return useQuery({
    queryKey: ['bundle', manifestId, typeId],
    queryFn: async () => {
      const response = await api.get(`/api/bundles/${typeId}`);
      if (response.success && response.data) {
        await syncBundle(`${manifestId}:${typeId}`, response.data, manifestId);
        return response.data;
      }
      throw new Error('Failed to fetch bundle');
    },
    enabled: needsUpdate,
    staleTime: Infinity, // Don't auto-refetch (use version check)
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: () => getBundle(manifestId, typeId), // Offline-first
  });
}
```

## Summary

**Best Strategy for This Application**:

1. ✅ **Stale-while-revalidate** for manifests (5-min background refetch)
2. ✅ **Version-based refetching** for bundles (check DB version first)
3. ✅ **Offline-first** with DB fallback (query DB, then API)
4. ✅ **Optimistic updates** on mutations (immediate UI feedback)
5. ✅ **Refetch on focus/reconnect** (sync when user returns)

This balances freshness, efficiency, and offline support.
