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
import { api, type ApiResponseWithHeaders } from '../lib/api';
import { useAuth, getAuthToken } from './auth';
import { syncManifest, syncBundle, getBundleEtag, getManifestEtag, getManifest } from './db';

// Sync state signals
const manifest = signal<SiteManifest | null>(null);
const orgManifest = signal<SiteManifest | null>(null); // Org-specific manifest (for admin work queue)
const bundles = signal<Map<string, EntityBundle>>(new Map());
const orgBundles = signal<Map<string, EntityBundle>>(new Map()); // Org-specific bundles (admin work queue)
const syncing = signal(false);
const lastSyncedAt = signal<Date | null>(null);
const syncError = signal<string | null>(null);

// Computed values
/**
 * @deprecated Use useEntityTypes hook from hooks/useDB.ts instead
 * This computed value is kept for backward compatibility but will be removed in a future version.
 */
const entityTypes = computed(() => manifest.value?.entityTypes || []);
/**
 * @deprecated Use useEntityTypes hook from hooks/useDB.ts with org manifest ID instead
 * This computed value is kept for backward compatibility but will be removed in a future version.
 */
const orgEntityTypes = computed(() => orgManifest.value?.entityTypes || []);
const config = computed(() => manifest.value?.config || null);
const isOffline = signal(!navigator.onLine);

/**
 * Get entity type by ID or slug
 * @deprecated Use useEntityType hook from hooks/useDB.ts instead
 * This function will be removed in a future version.
 */
function getEntityType(idOrSlug: string): ManifestEntityType | undefined {
  console.warn('[Sync] getEntityType() is deprecated. Use useEntityType() hook from hooks/useDB.ts instead.');
  return entityTypes.value.find(
    t => t.id === idOrSlug || t.slug === idOrSlug
  );
}

/**
 * Get bundle for entity type (platform bundle)
 * @deprecated Use useBundle hook from hooks/useDB.ts instead
 * This function will be removed in a future version.
 */
function getBundle(typeId: string): EntityBundle | undefined {
  console.warn('[Sync] getBundle() is deprecated. Use useBundle() hook from hooks/useDB.ts instead.');
  return bundles.value.get(typeId);
}

/**
 * Get org-specific bundle for entity type (admin work queue - draft/deleted entities)
 * @deprecated Use useBundle hook from hooks/useDB.ts with org manifest ID instead
 * This function will be removed in a future version.
 */
function getOrgBundle(typeId: string): EntityBundle | undefined {
  console.warn('[Sync] getOrgBundle() is deprecated. Use useBundle() hook from hooks/useDB.ts with org manifest ID instead.');
  return orgBundles.value.get(typeId);
}

/**
 * Get entity by ID from bundles
 * @deprecated Use useEntity hook from hooks/useDB.ts instead
 * This function will be removed in a future version.
 */
function getEntity(entityId: string): BundleEntity | undefined {
  console.warn('[Sync] getEntity() is deprecated. Use useEntity() hook from hooks/useDB.ts instead.');
  for (const bundle of bundles.value.values()) {
    const entity = bundle.entities.find(e => e.id === entityId);
    if (entity) return entity;
  }
  return undefined;
}

/**
 * Get entity by slug from a specific type
 * @deprecated Use useEntityBySlug hook from hooks/useDB.ts instead
 * This function will be removed in a future version.
 */
function getEntityBySlug(typeId: string, slug: string): BundleEntity | undefined {
  console.warn('[Sync] getEntityBySlug() is deprecated. Use useEntityBySlug() hook from hooks/useDB.ts instead.');
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
    // Check auth state using auth store's getAuthToken (more reliable than localStorage check)
    const token = getAuthToken();
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
    
    // Determine manifest ID for DB storage
    // For unauthenticated: 'public', for authenticated: 'platform' (user's highest key)
    const manifestId = isAuthenticated ? 'platform' : 'public';
    
    // Get stored ETag from TanStack DB for conditional request
    let storedManifestEtag: string | null = null;
    try {
      storedManifestEtag = await getManifestEtag(manifestId);
    } catch (e) {
      // DB might not have the manifest yet, that's okay
      console.log('[Sync] No ETag found in DB for manifest:', manifestId);
    }
    
    // Fetch manifest with ETag (API client handles conditional requests)
    const manifestResponse = await api.get(manifestPath, storedManifestEtag) as ApiResponseWithHeaders<SiteManifest>;
    
    // Handle 304 Not Modified (use existing manifest from DB)
    let newManifest: SiteManifest;
    let manifestEtag: string | null = null;
    
    if (manifestResponse.notModified) {
      console.log('[Sync] Manifest 304 Not Modified, loading from DB:', manifestId);
      // Load from DB
      try {
        const existingManifest = await getManifest(manifestId);
        if (existingManifest) {
          // Convert ManifestRow to SiteManifest format
          newManifest = {
            version: existingManifest.version,
            generatedAt: existingManifest.generatedAt,
            entityTypes: existingManifest.entityTypes,
            config: existingManifest.config || undefined,
          };
          manifestEtag = existingManifest.etag; // Use stored ETag
          console.log('[Sync] Using manifest from DB:', manifestId, 'version:', newManifest.version, 'ETag:', manifestEtag);
        } else {
          // If not in DB and we got 304, we have a problem - can't fetch without making another request
          // This shouldn't happen, but if it does, we need to make a new request without ETag
          console.warn('[Sync] Manifest 304 but not in DB, making new request without ETag');
          const fallbackResponse = await api.get(manifestPath) as ApiResponseWithHeaders<SiteManifest>;
          if (!fallbackResponse.success || !fallbackResponse.data) {
            throw new Error('Failed to fetch manifest');
          }
          newManifest = fallbackResponse.data;
          manifestEtag = fallbackResponse.etag || null;
        }
      } catch (dbErr) {
        console.error('[Sync] Error loading manifest from DB:', dbErr);
        // Fallback: make new request without ETag
        console.warn('[Sync] Making fallback request without ETag');
        const fallbackResponse = await api.get(manifestPath) as ApiResponseWithHeaders<SiteManifest>;
        if (!fallbackResponse.success || !fallbackResponse.data) {
          throw new Error('Failed to fetch manifest');
        }
        newManifest = fallbackResponse.data;
        manifestEtag = fallbackResponse.etag || null;
      }
    } else {
      if (!manifestResponse.success || !manifestResponse.data) {
        throw new Error('Failed to fetch manifest');
      }
      newManifest = manifestResponse.data;
      manifestEtag = manifestResponse.etag || null;
    }
    console.log('[Sync] Manifest loaded:', newManifest.entityTypes.length, 'types', manifestEtag ? `(ETag: ${manifestEtag})` : '');
    
    // Sync manifest to TanStack DB (even if 304, we still sync entity types to ensure they're correct)
    // Initialize DB early to ensure collections are ready
    try {
      // Import getDatabase to ensure DB is initialized
      const { getDatabase } = await import('./db');
      getDatabase(); // Initialize DB if not already done
      
      await syncManifest(manifestId, newManifest, manifestEtag);
      console.log('[Sync] Manifest synced to DB:', manifestId);
    } catch (dbErr) {
      console.error('[Sync] Failed to sync manifest to DB:', dbErr);
      console.error('[Sync] DB error details:', dbErr instanceof Error ? dbErr.stack : dbErr);
      // Continue even if DB sync fails
    }
    
    // For authenticated users, also sync public manifest (needed for home page)
    // Public manifest contains entity types visible to everyone
    if (isAuthenticated) {
      try {
        console.log('[Sync] Also syncing public manifest for authenticated user...');
        
        // Get stored ETag for public manifest
        let storedPublicEtag: string | null = null;
        try {
          storedPublicEtag = await getManifestEtag('public');
        } catch (e) {
          console.log('[Sync] No ETag found in DB for public manifest');
        }
        
        const publicManifestResponse = await api.get('/public/manifests/site', storedPublicEtag) as ApiResponseWithHeaders<SiteManifest>;
        
        // Handle 304 Not Modified
        let publicManifest: SiteManifest | null = null;
        let publicManifestEtag: string | null = null;
        
        if (publicManifestResponse.notModified) {
          console.log('[Sync] Public manifest 304 Not Modified, loading from DB');
          // Load from DB
          const existingPublicManifest = await getManifest('public');
          if (existingPublicManifest) {
            publicManifest = {
              version: existingPublicManifest.version,
              generatedAt: existingPublicManifest.generatedAt,
              entityTypes: existingPublicManifest.entityTypes,
              config: existingPublicManifest.config || undefined,
            };
            publicManifestEtag = existingPublicManifest.etag;
            console.log('[Sync] Using public manifest from DB');
          } else {
            console.warn('[Sync] Public manifest 304 but not in DB, skipping');
          }
        } else if (publicManifestResponse.success && publicManifestResponse.data) {
          publicManifest = publicManifestResponse.data;
          publicManifestEtag = publicManifestResponse.etag || null;
        }
        
        if (publicManifest) {
          // Sync public manifest to TanStack DB (even if 304, we still sync entity types)
          await syncManifest('public', publicManifest, publicManifestEtag);
          console.log('[Sync] Public manifest synced to DB');
        }
      } catch (publicErr) {
        console.warn('[Sync] Failed to sync public manifest (non-critical):', publicErr);
        // Non-critical - continue even if this fails
      }
    }
    
    // Bundles don't have versions - use ETag-based conditional requests
    // Always fetch bundles, but API client will handle conditional requests via ETags
    const bundlesToFetch: string[] = [];
    
    // Collect type IDs that are in the new manifest
    const manifestTypeIds = new Set(newManifest.entityTypes.map(t => t.id));
    
    // Fetch all bundles in manifest (ETag checks happen in API client)
    // If force is false, API client will send If-None-Match headers for conditional requests
    for (const type of newManifest.entityTypes) {
      // Always fetch - API client handles 304 Not Modified responses
      bundlesToFetch.push(type.id);
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
        // Get stored ETag from TanStack DB for conditional request
        let storedEtag: string | null = null;
        try {
          storedEtag = await getBundleEtag(manifestId, typeId);
        } catch (e) {
          // DB might not have the bundle yet, that's okay
          console.log('[Sync] No ETag found in DB for bundle:', typeId);
        }
        
        // Fetch with ETag (API client handles conditional requests)
        const bundleResponse = await api.get(`${bundleBasePath}/${typeId}`, storedEtag) as ApiResponseWithHeaders<EntityBundle>;
        
        // Handle 304 Not Modified (use existing bundle)
        if (bundleResponse.notModified) {
          const currentBundle = bundles.value.get(typeId);
          if (currentBundle) {
            newBundles.set(typeId, currentBundle);
            console.log('[Sync] Bundle 304 Not Modified, using cached:', typeId);
            continue;
          }
        }
        
        if (bundleResponse.success && bundleResponse.data) {
          const bundle = bundleResponse.data;
          newBundles.set(typeId, bundle);
          console.log('[Sync] Bundle loaded:', typeId, bundle.entityCount, 'entities', bundleResponse.etag ? `(ETag: ${bundleResponse.etag})` : '');
          
          // Sync bundle to TanStack DB
          try {
            const bundleId = `${manifestId}:${typeId}`;
            await syncBundle(bundleId, bundle, manifestId, bundleResponse.etag || null);
            console.log('[Sync] Bundle synced to DB:', bundleId);
          } catch (dbErr) {
            console.warn('[Sync] Failed to sync bundle to DB:', typeId, dbErr);
            // Continue even if DB sync fails
          }
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
    const currentBundles = bundles.value;
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
          // Determine org manifest ID for DB storage
          // Format: 'org:${orgId}:${role}' where role is 'member' or 'admin'
          const orgRole = userRole === 'org_admin' ? 'admin' : 'member';
          const orgManifestId = `org:${currentOrgIdStr}:${orgRole}`;
          
          // Get stored ETag for org manifest
          let storedOrgEtag: string | null = null;
          try {
            storedOrgEtag = await getManifestEtag(orgManifestId);
          } catch (e) {
            console.log('[Sync] No ETag found in DB for org manifest:', orgManifestId);
          }
          
          // Fetch org manifest (returns admin or member manifest based on user role)
          const orgManifestPath = `/api/orgs/${currentOrgIdStr}/manifests/site`;
          const orgManifestResponse = await api.get(orgManifestPath, storedOrgEtag) as ApiResponseWithHeaders<SiteManifest>;
          
          // Handle 304 Not Modified
          let newOrgManifest: SiteManifest | null = null;
          let orgManifestEtag: string | null = null;
          
          if (orgManifestResponse.notModified) {
            console.log('[Sync] Org manifest 304 Not Modified, loading from DB:', orgManifestId);
            // Load from DB
            const existingOrgManifest = await getManifest(orgManifestId);
            if (existingOrgManifest) {
              newOrgManifest = {
                version: existingOrgManifest.version,
                generatedAt: existingOrgManifest.generatedAt,
                entityTypes: existingOrgManifest.entityTypes,
                config: existingOrgManifest.config || undefined,
              };
              orgManifestEtag = existingOrgManifest.etag;
              console.log('[Sync] Using org manifest from DB:', orgManifestId);
            } else {
              console.warn('[Sync] Org manifest 304 but not in DB, skipping');
            }
          } else if (orgManifestResponse.success && orgManifestResponse.data) {
            newOrgManifest = orgManifestResponse.data;
            orgManifestEtag = orgManifestResponse.etag || null;
            console.log('[Sync] Org manifest loaded:', newOrgManifest.entityTypes.length, 'types', orgManifestEtag ? `(ETag: ${orgManifestEtag})` : '');
          }
          
          if (newOrgManifest) {
            // Sync org manifest to TanStack DB (even if 304, we still sync entity types)
            try {
              await syncManifest(orgManifestId, newOrgManifest, orgManifestEtag);
              console.log('[Sync] Org manifest synced to DB:', orgManifestId);
            } catch (dbErr) {
              console.warn('[Sync] Failed to sync org manifest to DB:', dbErr);
              // Continue even if DB sync fails
            }
          }
            
            // Fetch org bundles for each type
            const currentOrgBundles = orgBundles.value;
            const newOrgBundles = new Map(currentOrgBundles);
            
            for (const type of newOrgManifest.entityTypes) {
              // Bundles don't have versions - always fetch (API client handles ETag conditional requests)
              console.log('[Sync] Fetching org bundle:', type.id);
              
              const orgBundlePath = `/api/orgs/${currentOrgIdStr}/bundles/${type.id}`;
              
              // Get stored ETag from TanStack DB
              let storedEtag: string | null = null;
              try {
                storedEtag = await getBundleEtag(orgManifestId, type.id);
              } catch (e) {
                // DB might not have the bundle yet, that's okay
                console.log('[Sync] No ETag found in DB for org bundle:', type.id);
              }
              
              // Fetch with ETag (API client handles conditional requests)
              const orgBundleResponse = await api.get(orgBundlePath, storedEtag) as ApiResponseWithHeaders<EntityBundle>;
              
              // Handle 304 Not Modified (use existing bundle)
              if (orgBundleResponse.notModified) {
                const currentOrgBundle = currentOrgBundles.get(type.id);
                if (currentOrgBundle) {
                  newOrgBundles.set(type.id, currentOrgBundle);
                  console.log('[Sync] Org bundle 304 Not Modified, using cached:', type.id);
                  continue;
                }
              }
              
              if (orgBundleResponse.success && orgBundleResponse.data) {
                const orgBundle = orgBundleResponse.data;
                newOrgBundles.set(type.id, orgBundle);
                console.log('[Sync] Org bundle loaded:', type.id, orgBundle.entityCount, 'entities', orgBundleResponse.etag ? `(ETag: ${orgBundleResponse.etag})` : '');
                
                // Sync org bundle to TanStack DB
                try {
                  const orgBundleId = `${orgManifestId}:${type.id}`;
                  await syncBundle(orgBundleId, orgBundle, orgManifestId, orgBundleResponse.etag || null);
                  console.log('[Sync] Org bundle synced to DB:', orgBundleId);
                } catch (dbErr) {
                  console.warn('[Sync] Failed to sync org bundle to DB:', type.id, dbErr);
                  // Continue even if DB sync fails
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
// Note: Data access functions (getEntityType, getBundle, etc.) and computed values (entityTypes, bundles)
// are deprecated. Use DB hooks from hooks/useDB.ts instead.
// Only sync status/actions should be used from this store.
const syncValue = {
  // Sync status (keep these)
  syncing,
  lastSyncedAt,
  syncError,
  isOffline,
  config, // Config is OK to keep as it's not entity data
  
  // Sync actions (keep these)
  sync,
  loadFromCache,
  clearCache,
  
  // Deprecated data access - kept for backward compatibility only
  /** @deprecated Use useEntityTypes hook from hooks/useDB.ts instead */
  entityTypes,
  /** @deprecated Use useEntityTypes hook from hooks/useDB.ts with org manifest ID instead */
  orgEntityTypes,
  /** @deprecated Use useEntityType hook from hooks/useDB.ts instead */
  getEntityType,
  /** @deprecated Use useBundle hook from hooks/useDB.ts instead */
  getBundle,
  /** @deprecated Use useBundle hook from hooks/useDB.ts with org manifest ID instead */
  getOrgBundle,
  /** @deprecated Use useEntity hook from hooks/useDB.ts instead */
  getEntity,
  /** @deprecated Use useEntityBySlug hook from hooks/useDB.ts instead */
  getEntityBySlug,
  
  // Internal signals (kept for sync store internal use, but deprecated for external access)
  /** @deprecated Internal use only - do not access directly */
  manifest,
  /** @deprecated Internal use only - do not access directly. Use useBundle hook from hooks/useDB.ts instead */
  bundles,
  /** @deprecated Internal use only - do not access directly */
  orgManifest,
  /** @deprecated Internal use only - do not access directly. Use useBundle hook from hooks/useDB.ts instead */
  orgBundles,
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
    // Initialize DB early to ensure collections are hydrated
    import('./db').then(({ getDatabase, hydrateDatabase }) => {
      getDatabase(); // Initialize DB
      // Try manual hydration if auto-hydration didn't work
      setTimeout(() => {
        hydrateDatabase();
      }, 100);
    });
    
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
