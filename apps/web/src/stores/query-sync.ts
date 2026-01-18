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
import type { SiteManifest, EntityBundle, EntityListItem } from '@1cc/shared';
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
 * Hook for fetching entity list from /api/entities
 * Used by admin listing pages for entities with filtering and pagination
 */
export interface EntityListParams {
  typeId?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  organizationId?: string;
}

export interface EntityListResponse {
  items: EntityListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function useEntityList(params: EntityListParams, endpoint: '/api/entities' | '/api/super/entities' = '/api/entities') {
  return useQuery$(() => {
    // Build query params inside the callback so values are captured reactively
    const queryParams = new URLSearchParams();
    if (params.typeId) queryParams.set('typeId', params.typeId);
    if (params.status) queryParams.set('status', params.status);
    if (params.search) queryParams.set('search', params.search);
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.pageSize) queryParams.set('pageSize', params.pageSize.toString());
    if (params.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params.sortDirection) queryParams.set('sortDirection', params.sortDirection);
    if (params.organizationId !== undefined) {
      queryParams.set('organizationId', params.organizationId || '');
    }
    
    const paramString = queryParams.toString();
    const queryKey = ['entities', endpoint, paramString || 'all'];
    
    // For super/entities endpoint, typeId is required - skip query if missing
    if (endpoint === '/api/super/entities' && !params.typeId) {
      // Return empty result without executing query
      return {
        queryKey: ['entities', endpoint, 'disabled'],
        queryFn: async () => ({ items: [] } as EntityListResponse),
      };
    }
    
    console.log('[useEntityList] Query options computed:', {
      endpoint,
      typeId: params.typeId,
      queryKey: JSON.stringify(queryKey),
      paramString
    });
    
    return {
      queryKey,
      staleTime: 0, // Force immediate fetch (no cache)
      suspense: false, // Disable suspense to ensure queryFn runs
      // placeholderData: undefined, // No placeholder for entity lists (not in DB)
      queryFn: async () => {
        const url = `${endpoint}?${paramString}`;
        console.log('[useEntityList] Executing queryFn for:', url);
        
        const response = await api.get(url) as {
          success: boolean;
          data?: EntityListResponse;
        };
        
        console.log('[useEntityList] Response:', {
          success: response.success,
          hasData: !!response.data,
          itemsCount: response.data?.items?.length || 0,
          error: response.error
        });
        
        if (!response.success || !response.data) {
          const errorMsg = response.error?.message || 'Failed to fetch entity list';
          console.error('[useEntityList] Query failed:', errorMsg, response);
          throw new Error(errorMsg);
        }
        
        return response.data;
      },
    };
  });
}

/**
 * Hook for fetching entity list from /api/super/entities (superadmin)
 */
export function useSuperEntityList(params: EntityListParams) {
  return useEntityList(params, '/api/super/entities');
}

/**
 * Refresh all queries (manual refresh button)
 */
export function refreshAll() {
  const client = getQueryClient();
  client.invalidateQueries({ queryKey: ['manifest'] });
  client.invalidateQueries({ queryKey: ['bundle'] });
}

/**
 * Invalidate entity list queries (call after entity transitions)
 */
export function invalidateEntityLists() {
  const client = getQueryClient();
  client.invalidateQueries({ queryKey: ['entities'] });
}
