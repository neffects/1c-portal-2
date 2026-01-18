/**
 * TanStack Query Sync Store
 * 
 * Uses TanStack Query for server state management with ETag-based conditional requests.
 * Integrates with TanStack DB for offline-first local persistence.
 * 
 * Note: Initial deeplink load does not include TanStack Query or TanStack DB.
 * This store is only used after client-side libraries have loaded.
 */

import { QueryClient } from '@tanstack/query-core';
import { useQuery$ } from '@preact-signals/query';
import type { SiteManifest, EntityBundle } from '@1cc/shared';
import { api, type ApiResponseWithHeaders } from '../lib/api';
import { syncManifest, syncBundle, getManifest, getBundle, getBundleEtag } from './db';

// Create query client singleton
let queryClientInstance: QueryClient | null = null;

/**
 * Get or create query client instance
 */
export function getQueryClient(): QueryClient {
  if (!queryClientInstance) {
    queryClientInstance = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000, // 1 minute (from sync config)
          gcTime: 24 * 60 * 60 * 1000, // 24 hours
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
          retry: 3,
          retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        },
      },
    });
  }
  return queryClientInstance;
}

/**
 * Hook for fetching manifest with automatic DB sync
 * Uses ETag-based conditional requests
 */
export function useManifest(manifestId: string) {
  return useQuery$(() => ({
    queryKey: ['manifest', manifestId],
    queryFn: async () => {
      // Check DB first (offline-first)
      const dbManifest = await getManifest(manifestId);
      
      // Fetch from API with manifest version check
      const response = await api.get<SiteManifest>(`/api/manifests/site`);
      
      // Handle 304 Not Modified (shouldn't happen for manifests, but handle it)
      if (response.notModified && dbManifest) {
        console.log('[QuerySync] Manifest 304 Not Modified, using DB data:', manifestId);
        return dbManifest;
      }
      
      if (!response.success || !response.data) {
        // Fallback to DB if API fails
        if (dbManifest) {
          console.log('[QuerySync] API failed, using DB manifest:', manifestId);
          return dbManifest;
        }
        throw new Error('Failed to fetch manifest');
      }
      
      const manifest = response.data;
      
      // Sync to DB
      await syncManifest(manifestId, manifest);
      
      return manifest;
    },
    // Use DB data as placeholder (offline-first)
    placeholderData: async () => {
      return await getManifest(manifestId);
    },
  }));
}

/**
 * Hook for fetching bundle with ETag-based conditional requests
 * Checks DB ETag before fetching, uses conditional requests
 */
export function useBundle(manifestId: string, typeId: string) {
  return useQuery$(() => ({
    queryKey: ['bundle', manifestId, typeId],
    queryFn: async () => {
      // Get stored ETag from DB
      const dbBundle = await getBundle(manifestId, typeId);
      const bundleId = `${manifestId}:${typeId}`;
      
      // Determine bundle path based on manifest type
      const bundlePath = manifestId.startsWith('org:') 
        ? `/api/orgs/${manifestId.split(':')[1]}/bundles/${typeId}`
        : manifestId === 'public'
        ? `/public/bundles/${typeId}`
        : `/api/bundles/${typeId}`;
      
      // Get ETag from DB bundle row
      const etag = await getBundleEtag(manifestId, typeId);
      
      // Fetch with conditional request
      const response = await api.get<EntityBundle>(bundlePath, etag) as ApiResponseWithHeaders<EntityBundle>;
      
      // 304 Not Modified - use cached data
      if (response.notModified && dbBundle) {
        console.log('[QuerySync] Bundle 304 Not Modified, using DB data:', bundleId);
        return dbBundle;
      }
      
      if (!response.success || !response.data) {
        // Fallback to DB if API fails
        if (dbBundle) {
          console.log('[QuerySync] API failed, using DB bundle:', bundleId);
          return dbBundle;
        }
        throw new Error('Failed to fetch bundle');
      }
      
      const bundle = response.data;
      const responseEtag = response.etag || null;
      
      // Sync to DB with ETag
      await syncBundle(bundleId, bundle, manifestId, responseEtag);
      
      return bundle;
    },
    // Use DB data as placeholder (offline-first)
    placeholderData: async () => {
      return await getBundle(manifestId, typeId);
    },
    // Don't auto-refetch based on time (use ETag check)
    staleTime: Infinity,
  }));
}

/**
 * Refresh all queries (manual refresh button)
 */
export function refreshAll() {
  const client = getQueryClient();
  client.invalidateQueries({ queryKey: ['manifest'] });
  client.invalidateQueries({ queryKey: ['bundle'] });
}
