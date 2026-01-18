/**
 * Debug Panel Component
 * 
 * Hidden debug UI that shows the status of bundles, manifests, and app config.
 * Toggle with Ctrl+Shift+D (or Cmd+Shift+D on Mac).
 * 
 * Displays:
 * - Auth state (user, org, role)
 * - Platform manifest and bundles
 * - Org manifest and bundles
 * - Branding/app config
 * - Sync status
 */

import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { useAuth } from '../stores/auth';
import { useSync } from '../stores/sync';
import { useBranding } from '../stores/branding';
import { refreshAll as refreshQueryQueries, getQueryClient } from '../stores/query-sync';
import { getDatabase } from '../stores/db';
import type { SiteManifest, EntityBundle } from '@1cc/shared';

// Debug panel visibility signal (persists across renders)
const isDebugPanelOpen = signal(false);

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format date to relative time
 */
function formatRelativeTime(date: Date | string | null): string {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Collapsible section component
 */
function Section({ 
  title, 
  count, 
  status, 
  children, 
  defaultOpen = false 
}: { 
  title: string;
  count?: number;
  status?: 'ok' | 'warning' | 'error' | 'loading';
  children: preact.ComponentChildren;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  // Status indicator colors
  const statusColors = {
    ok: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    loading: 'bg-blue-500 animate-pulse'
  };
  
  return (
    <div class="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        class="w-full flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class={`i-lucide-chevron-right transition-transform ${isOpen ? 'rotate-90' : ''}`}></span>
          <span class="font-medium text-surface-900 dark:text-surface-100">{title}</span>
          {count !== undefined && (
            <span class="text-xs px-1.5 py-0.5 bg-surface-200 dark:bg-surface-600 rounded text-surface-600 dark:text-surface-300">
              {count}
            </span>
          )}
        </div>
        {status && (
          <span class={`w-2 h-2 rounded-full ${statusColors[status]}`}></span>
        )}
      </button>
      {isOpen && (
        <div class="p-3 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Key-value display row
 */
function Row({ label, value, mono = false }: { label: string; value: string | number | boolean | null | undefined; mono?: boolean }) {
  const displayValue = value === null || value === undefined ? 'null' : String(value);
  return (
    <div class="flex items-start justify-between py-1 text-sm">
      <span class="text-surface-500 dark:text-surface-400">{label}</span>
      <span class={`text-surface-900 dark:text-surface-100 text-right ${mono ? 'font-mono text-xs' : ''}`}>
        {displayValue}
      </span>
    </div>
  );
}

/**
 * Bundle info display
 */
function BundleInfo({ typeId, bundle }: { typeId: string; bundle: EntityBundle }) {
  return (
    <div class="border border-surface-200 dark:border-surface-700 rounded p-2 text-xs">
      <div class="font-medium text-surface-900 dark:text-surface-100 mb-1">{typeId}</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-surface-600 dark:text-surface-400">
        <span>Version:</span>
        <span class="text-surface-900 dark:text-surface-100">{bundle.version}</span>
        <span>Entities:</span>
        <span class="text-surface-900 dark:text-surface-100">{bundle.entityCount}</span>
        <span>Generated:</span>
        <span class="text-surface-900 dark:text-surface-100">{formatRelativeTime(bundle.generatedAt)}</span>
      </div>
    </div>
  );
}

/**
 * Manifest info display
 */
function ManifestInfo({ manifest, label }: { manifest: SiteManifest | null; label: string }) {
  if (!manifest) {
    return (
      <div class="text-sm text-surface-500 dark:text-surface-400 italic">
        {label} not loaded
      </div>
    );
  }
  
  return (
    <div class="space-y-2">
      <Row label="Version" value={manifest.version} />
      <Row label="Generated" value={formatRelativeTime(manifest.generatedAt)} />
      <Row label="Entity Types" value={manifest.entityTypes.length} />
      {manifest.entityTypes.length > 0 && (
        <div class="mt-2">
          <div class="text-xs text-surface-500 dark:text-surface-400 mb-1">Types:</div>
          <div class="flex flex-wrap gap-1">
            {manifest.entityTypes.map(t => (
              <span 
                key={t.id} 
                class="text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded"
                title={`v${t.bundleVersion}, ${t.entityCount} entities`}
              >
                {t.slug} ({t.entityCount})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main Debug Panel component
 */
export function DebugPanel() {
  const { 
    isAuthenticated, 
    user, 
    userRole, 
    organizationId, 
    isSuperadmin, 
    currentOrganization,
    organizations,
    session
  } = useAuth();
  
  const { 
    manifest, 
    bundles, 
    orgManifest, 
    orgBundles, 
    syncing, 
    lastSyncedAt, 
    syncError, 
    isOffline,
    sync,
    clearCache
  } = useSync();
  
  const { 
    branding, 
    loading: brandingLoading, 
    error: brandingError,
    loadBranding
  } = useBranding();
  
  const [localStorageStats, setLocalStorageStats] = useState<{ manifest: boolean; bundles: number; orgManifest: boolean; orgBundles: number }>({
    manifest: false,
    bundles: 0,
    orgManifest: false,
    orgBundles: 0
  });
  
  const [dbStats, setDbStats] = useState<{
    initialized: boolean;
    manifestCount: number;
    entityTypeCount: number;
    bundleCount: number;
    entityCount: number;
    latestBundleSync: Date | null;
  }>({
    initialized: false,
    manifestCount: 0,
    entityTypeCount: 0,
    bundleCount: 0,
    entityCount: 0,
    latestBundleSync: null,
  });
  
  // Keyboard shortcut to toggle debug panel (Ctrl+Shift+D or Cmd+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        isDebugPanelOpen.value = !isDebugPanelOpen.value;
        console.log('[DebugPanel] Toggled:', isDebugPanelOpen.value);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Check localStorage stats and DB stats when panel opens
  useEffect(() => {
    if (isDebugPanelOpen.value) {
      updateLocalStorageStats();
      updateDbStats();
    }
  }, [isDebugPanelOpen.value]);
  
  // Update localStorage stats
  function updateLocalStorageStats() {
    const cachedManifest = localStorage.getItem('manifest');
    const cachedBundles = localStorage.getItem('bundles');
    const cachedOrgManifest = localStorage.getItem('orgManifest');
    const cachedOrgBundles = localStorage.getItem('orgBundles');
    
    let bundleCount = 0;
    let orgBundleCount = 0;
    
    try {
      if (cachedBundles) {
        const entries = JSON.parse(cachedBundles) as [string, EntityBundle][];
        bundleCount = entries.length;
      }
    } catch (e) {
      console.error('[DebugPanel] Error parsing cached bundles:', e);
    }
    
    try {
      if (cachedOrgBundles) {
        const entries = JSON.parse(cachedOrgBundles) as [string, EntityBundle][];
        orgBundleCount = entries.length;
      }
    } catch (e) {
      console.error('[DebugPanel] Error parsing cached org bundles:', e);
    }
    
    setLocalStorageStats({
      manifest: !!cachedManifest,
      bundles: bundleCount,
      orgManifest: !!cachedOrgManifest,
      orgBundles: orgBundleCount
    });
  }
  
  // Update TanStack DB stats
  function updateDbStats() {
    try {
      console.log('[DebugPanel] Checking TanStack DB status...');
      const db = getDatabase();
      
      // Count items in each collection
      const manifests = Array.from(db.collections.manifests.values());
      const entityTypes = Array.from(db.collections.entityTypes.values());
      const bundles = Array.from(db.collections.bundles.values());
      const entities = Array.from(db.collections.entities.values());
      
      // Find latest bundle sync timestamp
      let latestBundleSync: Date | null = null;
      for (const bundle of bundles) {
        if (bundle.syncedAt) {
          const syncDate = new Date(bundle.syncedAt);
          if (!latestBundleSync || syncDate > latestBundleSync) {
            latestBundleSync = syncDate;
          }
        }
      }
      
      setDbStats({
        initialized: true,
        manifestCount: manifests.length,
        entityTypeCount: entityTypes.length,
        bundleCount: bundles.length,
        entityCount: entities.length,
        latestBundleSync,
      });
      
      console.log('[DebugPanel] TanStack DB stats updated:', {
        manifests: manifests.length,
        entityTypes: entityTypes.length,
        bundles: bundles.length,
        entities: entities.length,
        latestBundleSync: latestBundleSync?.toISOString(),
      });
    } catch (err) {
      console.error('[DebugPanel] Error checking DB status:', err);
      setDbStats({
        initialized: false,
        manifestCount: 0,
        entityTypeCount: 0,
        bundleCount: 0,
        entityCount: 0,
        latestBundleSync: null,
      });
    }
  }
  
  // Handle force sync / refresh
  async function handleForceSync() {
    console.log('[DebugPanel] Force sync/refresh triggered');
    
    // If TanStack Query is available, invalidate queries
    try {
      const queryClient = getQueryClient();
      refreshQueryQueries();
      console.log('[DebugPanel] Query queries invalidated');
    } catch (err) {
      // Query might not be initialized yet - fall back to sync store
      console.log('[DebugPanel] Query not available, using sync store');
    }
    
    // Also trigger sync store refresh (for backward compatibility)
    await sync(true);
    updateLocalStorageStats();
    // Refresh DB stats after sync to show updated bundle fetch times
    updateDbStats();
  }
  
  // Handle clear cache
  function handleClearCache() {
    console.log('[DebugPanel] Clear cache triggered');
    clearCache();
    updateLocalStorageStats();
  }
  
  // Handle reload branding
  async function handleReloadBranding() {
    console.log('[DebugPanel] Reload branding triggered');
    await loadBranding();
  }
  
  // Don't render if panel is closed
  if (!isDebugPanelOpen.value) {
    return null;
  }
  
  // Convert bundles Map to array for display
  const bundlesArray = Array.from(bundles.value.entries());
  const orgBundlesArray = Array.from(orgBundles.value.entries());
  
  // Determine overall status
  const hasManifest = !!manifest.value;
  const hasBundles = bundlesArray.length > 0;
  const syncStatus = syncing.value ? 'loading' : syncError.value ? 'error' : (hasManifest && hasBundles) ? 'ok' : 'warning';
  
  return (
    <div class="fixed inset-0 z-[9999] pointer-events-none">
      {/* Backdrop */}
      <div 
        class="absolute inset-0 bg-black/20 dark:bg-black/40 pointer-events-auto"
        onClick={() => { isDebugPanelOpen.value = false; }}
      ></div>
      
      {/* Panel */}
      <div class="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-surface-900 shadow-2xl pointer-events-auto overflow-hidden flex flex-col">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
          <div class="flex items-center gap-2">
            <span class="i-lucide-bug text-primary-500"></span>
            <h2 class="font-semibold text-surface-900 dark:text-surface-100">Debug Panel</h2>
            <span class="text-xs text-surface-500">Ctrl+Shift+D</span>
          </div>
          <button
            onClick={() => { isDebugPanelOpen.value = false; }}
            class="p-1 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
          >
            <span class="i-lucide-x text-xl"></span>
          </button>
        </div>
        
        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Quick Actions */}
          <div class="flex flex-wrap gap-2 pb-3 border-b border-surface-200 dark:border-surface-700">
            <button
              onClick={handleForceSync}
              disabled={syncing.value}
              class="btn-primary text-xs px-3 py-1.5"
            >
              {syncing.value ? (
                <>
                  <span class="i-lucide-loader-2 animate-spin mr-1"></span>
                  Syncing...
                </>
              ) : (
                <>
                  <span class="i-lucide-refresh-cw mr-1"></span>
                  Force Sync
                </>
              )}
            </button>
            <button
              onClick={handleClearCache}
              class="btn-secondary text-xs px-3 py-1.5"
            >
              <span class="i-lucide-trash-2 mr-1"></span>
              Clear Cache
            </button>
            <button
              onClick={handleReloadBranding}
              class="btn-secondary text-xs px-3 py-1.5"
            >
              <span class="i-lucide-palette mr-1"></span>
              Reload Branding
            </button>
          </div>
          
          {/* Sync Status Summary */}
          <div class={`p-3 rounded-lg ${
            syncStatus === 'ok' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' :
            syncStatus === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' :
            syncStatus === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
            'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          }`}>
            <div class="flex items-center gap-2 mb-2">
              <span class={`w-2 h-2 rounded-full ${
                syncStatus === 'ok' ? 'bg-green-500' :
                syncStatus === 'warning' ? 'bg-amber-500' :
                syncStatus === 'error' ? 'bg-red-500' :
                'bg-blue-500 animate-pulse'
              }`}></span>
              <span class="font-medium text-sm text-surface-900 dark:text-surface-100">
                {syncStatus === 'ok' ? 'Data Loaded' :
                 syncStatus === 'warning' ? 'Partially Loaded' :
                 syncStatus === 'error' ? 'Sync Error' :
                 'Syncing...'}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="flex items-center gap-1">
                <span class={manifest.value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                  {manifest.value ? '✓' : '✗'}
                </span>
                <span class="text-surface-600 dark:text-surface-400">Platform Manifest</span>
              </div>
              <div class="flex items-center gap-1">
                <span class={bundlesArray.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                  {bundlesArray.length > 0 ? '✓' : '✗'}
                </span>
                <span class="text-surface-600 dark:text-surface-400">Platform Bundles ({bundlesArray.length})</span>
              </div>
              <div class="flex items-center gap-1">
                <span class={orgManifest.value ? 'text-green-600 dark:text-green-400' : 'text-surface-400'}>
                  {orgManifest.value ? '✓' : '-'}
                </span>
                <span class="text-surface-600 dark:text-surface-400">Org Manifest</span>
              </div>
              <div class="flex items-center gap-1">
                <span class={orgBundlesArray.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-surface-400'}>
                  {orgBundlesArray.length > 0 ? '✓' : '-'}
                </span>
                <span class="text-surface-600 dark:text-surface-400">Org Bundles ({orgBundlesArray.length})</span>
              </div>
            </div>
            {syncError.value && (
              <div class="mt-2 text-xs text-red-600 dark:text-red-400">
                Error: {syncError.value}
              </div>
            )}
            <div class="mt-2 text-xs text-surface-500 dark:text-surface-400">
              Last synced: {formatRelativeTime(lastSyncedAt.value)}
              {isOffline.value && ' (Offline)'}
            </div>
            {dbStats.latestBundleSync && (
              <div class="mt-1 text-xs text-surface-500 dark:text-surface-400">
                Latest bundle fetch: {formatRelativeTime(dbStats.latestBundleSync)}
              </div>
            )}
          </div>
          
          {/* TanStack DB Status */}
          <Section 
            title="TanStack DB" 
            status={dbStats.initialized ? (dbStats.bundleCount > 0 ? 'ok' : 'warning') : 'error'}
            defaultOpen={false}
          >
            <Row label="Initialized" value={dbStats.initialized} />
            <Row label="Manifests" value={dbStats.manifestCount} />
            <Row label="Entity Types" value={dbStats.entityTypeCount} />
            <Row label="Bundles" value={dbStats.bundleCount} />
            <Row label="Entities" value={dbStats.entityCount} />
            {dbStats.latestBundleSync && (
              <Row 
                label="Latest Bundle Sync" 
                value={formatRelativeTime(dbStats.latestBundleSync)} 
              />
            )}
            {!dbStats.initialized && (
              <div class="mt-2 text-xs text-amber-600 dark:text-amber-400">
                TanStack DB not initialized or not in use
              </div>
            )}
          </Section>
          
          {/* Auth State */}
          <Section 
            title="Auth State" 
            status={isAuthenticated.value ? 'ok' : 'warning'}
            defaultOpen={false}
          >
            <Row label="Authenticated" value={isAuthenticated.value} />
            <Row label="User ID" value={user.value?.id} mono />
            <Row label="Email" value={user.value?.email} />
            <Row label="Is Superadmin" value={isSuperadmin.value} />
            <Row label="Current Role" value={userRole.value} />
            <Row label="Current Org ID" value={organizationId.value} mono />
            <Row label="Current Org Name" value={currentOrganization.value?.name} />
            <Row label="Total Orgs" value={organizations.value.length} />
            <Row label="Session Expires" value={session.value?.expiresAt ? formatRelativeTime(session.value.expiresAt) : null} />
          </Section>
          
          {/* Platform Manifest */}
          <Section 
            title="Platform Manifest" 
            status={manifest.value ? 'ok' : 'warning'}
            count={manifest.value?.entityTypes.length}
            defaultOpen={false}
          >
            <ManifestInfo manifest={manifest.value} label="Platform manifest" />
          </Section>
          
          {/* Platform Bundles */}
          <Section 
            title="Platform Bundles" 
            status={bundlesArray.length > 0 ? 'ok' : 'warning'}
            count={bundlesArray.length}
            defaultOpen={true}
          >
            {bundlesArray.length === 0 ? (
              <div class="text-sm text-surface-500 dark:text-surface-400 italic">
                No platform bundles loaded
              </div>
            ) : (
              <div class="space-y-2">
                {bundlesArray.map(([typeId, bundle]) => (
                  <BundleInfo key={typeId} typeId={typeId} bundle={bundle} />
                ))}
              </div>
            )}
          </Section>
          
          {/* Org Manifest (only if authenticated) */}
          {isAuthenticated.value && (
            <Section 
              title="Org Manifest" 
              status={orgManifest.value ? 'ok' : 'warning'}
              count={orgManifest.value?.entityTypes.length}
              defaultOpen={false}
            >
              <ManifestInfo manifest={orgManifest.value} label="Org manifest" />
            </Section>
          )}
          
          {/* Org Bundles (only if authenticated) */}
          {isAuthenticated.value && (
            <Section 
              title="Org Bundles" 
              status={orgBundlesArray.length > 0 ? 'ok' : 'warning'}
              count={orgBundlesArray.length}
              defaultOpen={false}
            >
              {orgBundlesArray.length === 0 ? (
                <div class="text-sm text-surface-500 dark:text-surface-400 italic">
                  No org bundles loaded
                </div>
              ) : (
                <div class="space-y-2">
                  {orgBundlesArray.map(([typeId, bundle]) => (
                    <BundleInfo key={typeId} typeId={typeId} bundle={bundle} />
                  ))}
                </div>
              )}
            </Section>
          )}
          
          {/* Branding / App Config */}
          <Section 
            title="Branding Config" 
            status={brandingLoading.value ? 'loading' : brandingError.value ? 'error' : branding.value ? 'ok' : 'warning'}
            defaultOpen={false}
          >
            {brandingError.value && (
              <div class="text-xs text-red-600 dark:text-red-400 mb-2">
                Error: {brandingError.value}
              </div>
            )}
            {branding.value ? (
              <>
                <Row label="Root Org ID" value={branding.value.rootOrgId} mono />
                <Row label="Site Name" value={branding.value.siteName} />
                <Row label="Default Theme" value={branding.value.defaultTheme} />
                <Row label="Logo URL" value={branding.value.logoUrl} />
                <Row label="Logo Dark URL" value={branding.value.logoDarkUrl} />
                <Row label="Favicon URL" value={branding.value.faviconUrl} />
                <Row label="Primary Color" value={branding.value.primaryColor} />
                <Row label="Accent Color" value={branding.value.accentColor} />
                <Row label="Privacy Policy" value={branding.value.privacyPolicyUrl} />
              </>
            ) : (
              <div class="text-sm text-surface-500 dark:text-surface-400 italic">
                Branding not loaded
              </div>
            )}
          </Section>
          
          {/* LocalStorage Cache */}
          <Section 
            title="LocalStorage Cache" 
            status={localStorageStats.manifest ? 'ok' : 'warning'}
            defaultOpen={false}
          >
            <Row label="Manifest Cached" value={localStorageStats.manifest} />
            <Row label="Bundles Cached" value={localStorageStats.bundles} />
            <Row label="Org Manifest Cached" value={localStorageStats.orgManifest} />
            <Row label="Org Bundles Cached" value={localStorageStats.orgBundles} />
            <div class="mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
              <div class="text-xs text-surface-500 dark:text-surface-400">
                Other stored values:
              </div>
              <div class="mt-1 text-xs font-mono text-surface-600 dark:text-surface-400 space-y-0.5">
                <div>• session: {localStorage.getItem('session') ? 'present' : 'missing'}</div>
                <div>• currentOrgId: {localStorage.getItem('currentOrgId') || 'null'}</div>
                <div>• userRole: {localStorage.getItem('userRole') || 'null'}</div>
                <div>• auth_token: {localStorage.getItem('auth_token') ? 'present' : 'missing'}</div>
                <div>• theme: {localStorage.getItem('theme') || 'null'}</div>
                <div>• lastSyncedAt: {localStorage.getItem('lastSyncedAt') || 'null'}</div>
              </div>
            </div>
          </Section>
          
          {/* Environment Info */}
          <Section title="Environment" defaultOpen={false}>
            <Row label="URL" value={window.location.href} />
            <Row label="Online" value={navigator.onLine} />
            <Row label="User Agent" value={navigator.userAgent.substring(0, 50) + '...'} />
            <Row label="Timestamp" value={new Date().toISOString()} mono />
          </Section>
        </div>
        
        {/* Footer */}
        <div class="p-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-xs text-surface-500 dark:text-surface-400">
          Press <kbd class="px-1 py-0.5 bg-surface-200 dark:bg-surface-600 rounded">Ctrl+Shift+D</kbd> to close
        </div>
      </div>
    </div>
  );
}

/**
 * Export the visibility signal for external control
 */
export { isDebugPanelOpen };
