/**
 * Data Sync Store
 * 
 * Manages data synchronization with the server.
 * Handles manifest and bundle fetching, caching, and offline support.
 */

import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import type { SiteManifest, EntityBundle, ManifestEntityType, BundleEntity } from '@1cc/shared';
import { api } from '../lib/api';
import { useAuth } from './auth';

// Sync state signals
const manifest = signal<SiteManifest | null>(null);
const bundles = signal<Map<string, EntityBundle>>(new Map());
const syncing = signal(false);
const lastSyncedAt = signal<Date | null>(null);
const syncError = signal<string | null>(null);

// Computed values
const entityTypes = computed(() => manifest.value?.entityTypes || []);
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
 * Get bundle for entity type
 */
function getBundle(typeId: string): EntityBundle | undefined {
  return bundles.value.get(typeId);
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
    // Determine which manifest to fetch based on auth state
    const manifestPath = '/manifests/public'; // Will be enhanced with auth
    
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
    
    for (const type of newManifest.entityTypes) {
      const currentBundle = currentBundles.get(type.id);
      
      if (!currentBundle || currentBundle.version < type.bundleVersion || force) {
        bundlesToFetch.push(type.id);
      }
    }
    
    // Fetch updated bundles
    const newBundles = new Map(currentBundles);
    
    for (const typeId of bundlesToFetch) {
      console.log('[Sync] Fetching bundle:', typeId);
      
      const bundleResponse = await api.get(`/manifests/bundles/public/${typeId}`) as { success: boolean; data: EntityBundle };
      
      if (bundleResponse.success && bundleResponse.data) {
        newBundles.set(typeId, bundleResponse.data);
        console.log('[Sync] Bundle loaded:', typeId, bundleResponse.data.entityCount, 'entities');
      }
    }
    
    // Update state
    manifest.value = newManifest;
    bundles.value = newBundles;
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
  lastSyncedAt.value = null;
  
  localStorage.removeItem('manifest');
  localStorage.removeItem('bundles');
  localStorage.removeItem('lastSyncedAt');
}

// Sync context value
const syncValue = {
  manifest,
  bundles,
  syncing,
  lastSyncedAt,
  syncError,
  entityTypes,
  isOffline,
  getEntityType,
  getBundle,
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
  
  // Initial sync on mount
  useEffect(() => {
    // Load from cache first for fast initial render
    loadFromCache();
    
    // Then sync with server
    sync();
  }, []);
  
  // Re-sync when auth state changes
  useEffect(() => {
    if (isAuthenticated.value !== undefined) {
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
