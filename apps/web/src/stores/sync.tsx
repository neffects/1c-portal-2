/**
 * Data Sync Store
 * 
 * Manages data synchronization with the server.
 * Handles manifest and bundle fetching, caching, and offline support.
 * 
 * Hydration strategy by user type:
 * - Unauthenticated: bundles/public/* only
 * - Platform-org user: bundles/public/* + bundles/platform/* + bundles/org/{orgId}/member/*
 * - Full-member user: bundles/public/* + bundles/platform/* + bundles/member/* + bundles/org/{orgId}/member/*
 * - Org admin: Above + bundles/org/{orgId}/admin/* (for draft/deleted entities work queue)
 */

import { createContext } from 'preact';
import { useContext, useEffect, useRef } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import type { SiteManifest, EntityBundle, ManifestEntityType, BundleEntity } from '@1cc/shared';
import { api } from '../lib/api';
import { useAuth } from './auth';

// Sync state signals
const manifest = signal<SiteManifest | null>(null);
const orgManifest = signal<SiteManifest | null>(null); // Org-specific manifest (for admin work queue)
const bundles = signal<Map<string, EntityBundle>>(new Map());
const orgBundles = signal<Map<string, EntityBundle>>(new Map()); // Org-specific bundles (admin work queue)
const syncing = signal(false);
const lastSyncedAt = signal<Date | null>(null);
const syncError = signal<string | null>(null);

// Computed values
const entityTypes = computed(() => manifest.value?.entityTypes || []);
const orgEntityTypes = computed(() => orgManifest.value?.entityTypes || []);
const isOffline = signal(!navigator.onLine);

/**
 * Get entity type by ID or slug
 */
function getEntityType(idOrSlug: string): ManifestEntityType | undefined {
  return entityTypes.value.find(
    t => t.id === idOrSlug || t.slug === idOrSlug
  );
}

/**
 * Get bundle for entity type (platform bundle)
 */
function getBundle(typeId: string): EntityBundle | undefined {
  return bundles.value.get(typeId);
}

/**
 * Get org-specific bundle for entity type (admin work queue - draft/deleted entities)
 */
function getOrgBundle(typeId: string): EntityBundle | undefined {
  return orgBundles.value.get(typeId);
}

/**
 * Get entity by ID from bundles
 */
function getEntity(entityId: string): BundleEntity | undefined {
  for (const bundle of bundles.value.values()) {
    const entity = bundle.entities.find(e => e.id === entityId);
    if (entity) return entity;
  }
  return undefined;
}

/**
 * Get entity by slug from a specific type
 */
function getEntityBySlug(typeId: string, slug: string): BundleEntity | undefined {
  const bundle = bundles.value.get(typeId);
  return bundle?.entities.find(e => e.slug === slug);
}

/**
 * Sync manifest and bundles with server
 */
async function sync(force: boolean = false) {
  if (syncing.value && !force) {
    console.log('[Sync] Already syncing, skipping');
    return;
  }
  
  console.log('[Sync] Starting sync...');
  syncing.value = true;
  syncError.value = null;
  
  try {
    // Check auth state from localStorage (token presence indicates auth)
    const token = localStorage.getItem('auth_token');
    const isAuthenticated = !!token;
    
    // Determine which manifest to fetch based on auth state
    let manifestPath: string;
    let bundleBasePath: string;
    
    if (!isAuthenticated) {
      // Unauthenticated: use public routes
      manifestPath = '/public/manifests/site';
      bundleBasePath = '/public/bundles';
    } else {
      // Authenticated: use API routes (returns manifest for user's highest key)
      manifestPath = '/api/manifests/site';
      bundleBasePath = '/api/bundles';
    }
    
    // Fetch manifest
    const manifestResponse = await api.get(manifestPath) as { success: boolean; data: SiteManifest };
    
    if (!manifestResponse.success || !manifestResponse.data) {
      throw new Error('Failed to fetch manifest');
    }
    
    const newManifest = manifestResponse.data;
    console.log('[Sync] Manifest loaded:', newManifest.entityTypes.length, 'types');
    
    // Check which bundles need updating
    const currentBundles = bundles.value;
    const bundlesToFetch: string[] = [];
    
    // Collect type IDs that are in the new manifest
    const manifestTypeIds = new Set(newManifest.entityTypes.map(t => t.id));
    
    for (const type of newManifest.entityTypes) {
      const currentBundle = currentBundles.get(type.id);
      
      if (!currentBundle || currentBundle.version < type.bundleVersion || force) {
        bundlesToFetch.push(type.id);
      }
    }
    
    // Fetch updated bundles - only include bundles for types in the manifest
    // This removes bundles for deleted types
    const newBundles = new Map<string, EntityBundle>();
    
    for (const typeId of bundlesToFetch) {
      // Only fetch bundles for types that are in the manifest
      if (!manifestTypeIds.has(typeId)) {
        console.log('[Sync] Skipping bundle fetch for type not in manifest:', typeId);
        continue;
      }
      
      console.log('[Sync] Fetching bundle:', typeId);
      
      try {
        const bundleResponse = await api.get(`${bundleBasePath}/${typeId}`) as { success: boolean; data: EntityBundle };
        
        if (bundleResponse.success && bundleResponse.data) {
          newBundles.set(typeId, bundleResponse.data);
          console.log('[Sync] Bundle loaded:', typeId, bundleResponse.data.entityCount, 'entities');
        } else {
          // Bundle not found or error - this can happen if type was deleted
          console.warn('[Sync] Bundle not found or error for type:', typeId, 'This may indicate the type was deleted');
        }
      } catch (err) {
        // Handle 404 or other errors gracefully - bundle may have been deleted
        console.warn('[Sync] Error fetching bundle for type:', typeId, err instanceof Error ? err.message : err);
        // Don't add the bundle to newBundles, effectively removing it
      }
    }
    
    // Keep existing bundles for types that are still in the manifest and don't need updating
    // Only keep bundles for types that are actually in the new manifest (removes deleted types)
    for (const type of newManifest.entityTypes) {
      if (!bundlesToFetch.includes(type.id)) {
        const existingBundle = currentBundles.get(type.id);
        if (existingBundle) {
          // Double-check that this type is still in the manifest before keeping its bundle
          if (manifestTypeIds.has(type.id)) {
            newBundles.set(type.id, existingBundle);
          }
        }
      }
    }
    
    // Remove any bundles for types that are no longer in the manifest
    // This handles cases where the manifest is updated but bundles haven't been cleaned up yet
    console.log('[Sync] Final bundle map has', newBundles.size, 'bundles for', manifestTypeIds.size, 'types in manifest');
    
    // Update platform state
    manifest.value = newManifest;
    bundles.value = newBundles;
    
    // Fetch org-specific bundles for authenticated org members/admins
    // This provides the admin work queue (draft/deleted entities) and member view
    if (isAuthenticated) {
      const currentOrgIdStr = localStorage.getItem('currentOrgId');
      const userRole = localStorage.getItem('userRole'); // 'org_admin' | 'org_member' | 'superadmin'
      
      if (currentOrgIdStr) {
        console.log('[Sync] Fetching org-specific bundles for:', currentOrgIdStr);
        
        try {
          // Fetch org manifest (returns admin or member manifest based on user role)
          const orgManifestPath = `/api/orgs/${currentOrgIdStr}/manifests/site`;
          const orgManifestResponse = await api.get(orgManifestPath) as { success: boolean; data: SiteManifest };
          
          if (orgManifestResponse.success && orgManifestResponse.data) {
            const newOrgManifest = orgManifestResponse.data;
            console.log('[Sync] Org manifest loaded:', newOrgManifest.entityTypes.length, 'types');
            
            // Fetch org bundles for each type
            const currentOrgBundles = orgBundles.value;
            const newOrgBundles = new Map(currentOrgBundles);
            
            for (const type of newOrgManifest.entityTypes) {
              const currentOrgBundle = currentOrgBundles.get(type.id);
              
              // Fetch if missing, outdated, or forced
              if (!currentOrgBundle || currentOrgBundle.version < type.bundleVersion || force) {
                console.log('[Sync] Fetching org bundle:', type.id);
                
                const orgBundlePath = `/api/orgs/${currentOrgIdStr}/bundles/${type.id}`;
                const orgBundleResponse = await api.get(orgBundlePath) as { success: boolean; data: EntityBundle };
                
                if (orgBundleResponse.success && orgBundleResponse.data) {
                  newOrgBundles.set(type.id, orgBundleResponse.data);
                  console.log('[Sync] Org bundle loaded:', type.id, orgBundleResponse.data.entityCount, 'entities');
                }
              }
            }
            
            // Update org state
            orgManifest.value = newOrgManifest;
            orgBundles.value = newOrgBundles;
            
            // Cache org data
            try {
              localStorage.setItem('orgManifest', JSON.stringify(newOrgManifest));
              localStorage.setItem('orgBundles', JSON.stringify(Array.from(newOrgBundles.entries())));
              console.log('[Sync] Org data cached locally');
            } catch (err) {
              console.warn('[Sync] Failed to cache org data:', err);
            }
          }
        } catch (orgErr) {
          console.warn('[Sync] Failed to fetch org bundles:', orgErr);
          // Don't fail the entire sync if org bundles fail
        }
      }
    } else {
      // Clear org data when not authenticated
      orgManifest.value = null;
      orgBundles.value = new Map();
      localStorage.removeItem('orgManifest');
      localStorage.removeItem('orgBundles');
    }
    
    lastSyncedAt.value = new Date();
    
    // Cache in localStorage for offline support
    try {
      localStorage.setItem('manifest', JSON.stringify(newManifest));
      localStorage.setItem('bundles', JSON.stringify(Array.from(newBundles.entries())));
      localStorage.setItem('lastSyncedAt', new Date().toISOString());
      console.log('[Sync] Data cached locally');
    } catch (err) {
      console.warn('[Sync] Failed to cache data:', err);
    }
    
    console.log('[Sync] Sync complete');
    
  } catch (err) {
    console.error('[Sync] Sync error:', err);
    syncError.value = err instanceof Error ? err.message : 'Sync failed';
    
    // Try to load from cache
    loadFromCache();
  } finally {
    syncing.value = false;
  }
}

/**
 * Load data from localStorage cache
 */
function loadFromCache() {
  console.log('[Sync] Loading from cache...');
  
  try {
    const cachedManifest = localStorage.getItem('manifest');
    const cachedBundles = localStorage.getItem('bundles');
    const cachedOrgManifest = localStorage.getItem('orgManifest');
    const cachedOrgBundles = localStorage.getItem('orgBundles');
    const cachedSyncedAt = localStorage.getItem('lastSyncedAt');
    
    if (cachedManifest) {
      manifest.value = JSON.parse(cachedManifest);
      console.log('[Sync] Manifest loaded from cache');
    }
    
    if (cachedBundles) {
      const entries = JSON.parse(cachedBundles) as [string, EntityBundle][];
      bundles.value = new Map(entries);
      console.log('[Sync] Bundles loaded from cache:', entries.length);
    }
    
    if (cachedOrgManifest) {
      orgManifest.value = JSON.parse(cachedOrgManifest);
      console.log('[Sync] Org manifest loaded from cache');
    }
    
    if (cachedOrgBundles) {
      const entries = JSON.parse(cachedOrgBundles) as [string, EntityBundle][];
      orgBundles.value = new Map(entries);
      console.log('[Sync] Org bundles loaded from cache:', entries.length);
    }
    
    if (cachedSyncedAt) {
      lastSyncedAt.value = new Date(cachedSyncedAt);
    }
    
  } catch (err) {
    console.error('[Sync] Failed to load from cache:', err);
  }
}

/**
 * Clear all cached data
 */
function clearCache() {
  console.log('[Sync] Clearing cache...');
  
  manifest.value = null;
  bundles.value = new Map();
  orgManifest.value = null;
  orgBundles.value = new Map();
  lastSyncedAt.value = null;
  
  localStorage.removeItem('manifest');
  localStorage.removeItem('bundles');
  localStorage.removeItem('orgManifest');
  localStorage.removeItem('orgBundles');
  localStorage.removeItem('lastSyncedAt');
}

// Sync context value
const syncValue = {
  manifest,
  bundles,
  orgManifest,
  orgBundles,
  syncing,
  lastSyncedAt,
  syncError,
  entityTypes,
  orgEntityTypes,
  isOffline,
  getEntityType,
  getBundle,
  getOrgBundle,
  getEntity,
  getEntityBySlug,
  sync,
  loadFromCache,
  clearCache
};

// Create context
const SyncContext = createContext(syncValue);

/**
 * Sync Provider component
 */
export function SyncProvider({ children }: { children: preact.ComponentChildren }) {
  const { isAuthenticated } = useAuth();
  
  // Track if initial sync has been done to prevent duplicate calls
  const initialSyncDone = useRef(false);
  
  // Initial sync on mount
  useEffect(() => {
    // Load from cache first for fast initial render
    loadFromCache();
    
    // Then sync with server
    sync().then(() => {
      initialSyncDone.current = true;
      console.log('[Sync] Initial sync completed');
    });
  }, []);
  
  // Re-sync when auth state changes (but skip initial)
  useEffect(() => {
    // Only re-sync after initial sync is done and auth state actually changes
    if (initialSyncDone.current && isAuthenticated.value !== undefined) {
      console.log('[Sync] Auth state changed, re-syncing...');
      sync(true);
    }
  }, [isAuthenticated.value]);
  
  // Setup periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (!syncing.value && navigator.onLine) {
        sync();
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    return () => clearInterval(interval);
  }, []);
  
  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => {
      isOffline.value = false;
      console.log('[Sync] Back online, syncing...');
      sync();
    };
    
    const handleOffline = () => {
      isOffline.value = true;
      console.log('[Sync] Went offline');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  return (
    <SyncContext.Provider value={syncValue}>
      {children}
    </SyncContext.Provider>
  );
}

/**
 * Hook to access sync state
 */
export function useSync() {
  return useContext(SyncContext);
}
