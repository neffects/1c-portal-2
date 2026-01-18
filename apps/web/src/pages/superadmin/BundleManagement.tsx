/**
 * Bundle Management Page
 * 
 * View and manage all bundles stored in R2.
 * Shows bundle metadata including size, generation time, and client load status.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { useBundle, useManifestId } from '../../hooks/useDB';
import { api } from '../../lib/api';
import { formatDateTime, formatRelativeTime } from '../../lib/utils';

interface BundleInfo {
  path: string;
  type: 'global' | 'org-member' | 'org-admin';
  keyId?: string;
  orgId?: string;
  typeId: string;
  typeName?: string;
  keyName?: string;
  orgName?: string;
  friendlyName: string;
  generatedAt?: string;
  size: number;
  version?: number;
  entityCount?: number;
  exists: boolean;
}

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
 * Get bundle type display name
 */
function getBundleTypeName(type: BundleInfo['type'], keyId?: string): string {
  switch (type) {
    case 'global':
      return `Global (${keyId || 'unknown'})`;
    case 'org-member':
      return 'Org Member';
    case 'org-admin':
      return 'Org Admin';
    default:
      return type;
  }
}

export function BundleManagement() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  const manifestId = useManifestId();
  
  const [bundleList, setBundleList] = useState<BundleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[BundleManagement] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load bundles
  useEffect(() => {
    if (isSuperadmin.value) {
      loadBundles();
    }
  }, [isSuperadmin.value]);
  
  async function loadBundles() {
    console.log('[BundleManagement] Loading bundles');
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get('/api/super/bundles') as {
        success: boolean;
        data?: { bundles: BundleInfo[] };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        console.log('[BundleManagement] Loaded', response.data.bundles.length, 'bundles');
        setBundleList(response.data.bundles);
      } else {
        setError(response.error?.message || 'Failed to load bundles');
      }
    } catch (err) {
      console.error('[BundleManagement] Error loading bundles:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bundles');
    } finally {
      setLoading(false);
    }
  }
  
  /**
   * Check if bundle is loaded on client
   * Note: Bundles no longer have versions - they use ETags instead
   * This function now just checks if bundle exists in DB
   */
  function isBundleLoaded(bundle: BundleInfo): {
    loaded: boolean;
    isLatest: boolean;
    clientVersion?: number;
  } {
    // If bundle doesn't exist, it can't be loaded
    if (!bundle.exists) {
      return { loaded: false, isLatest: false };
    }
    
    // Determine manifest ID based on bundle type
    let checkManifestId: string;
    if (bundle.type === 'global') {
      checkManifestId = bundle.keyId || 'platform';
    } else if (bundle.type === 'org-member' || bundle.type === 'org-admin') {
      const role = bundle.type === 'org-admin' ? 'admin' : 'member';
      checkManifestId = `org:${bundle.orgId}:${role}`;
    } else {
      return { loaded: false, isLatest: false };
    }
    
    // Check if bundle exists in DB (synchronous check via getDatabase)
    // Note: This is a simplified check - for async, would need to use useBundle hook
    // For now, we'll assume bundle is loaded if it exists on server
    // TODO: Implement async bundle check if needed
    return { loaded: bundle.exists, isLatest: true };
  }
  
  /**
   * Regenerate all bundles
   */
  async function handleRegenerateAll() {
    const addDefaultVisibleTo = confirm(
      'Regenerate all bundles?\n\n' +
      'Some entity types may be missing visibleTo configuration.\n\n' +
      'Click OK to automatically add default visibleTo to entity types missing it.\n' +
      'Click Cancel to regenerate without modifying entity types.'
    );
    
    setRegeneratingAll(true);
    setError(null);
    
    try {
      console.log('[BundleManagement] Regenerating all bundles, addDefaultVisibleTo:', addDefaultVisibleTo);
      
      const response = await api.post('/api/super/bundles/regenerate-all', {
        addDefaultVisibleTo: addDefaultVisibleTo
      }) as {
        success: boolean;
        data?: { 
          message: string; 
          successCount: number; 
          errorCount: number; 
          entityTypesUpdated?: number;
          entityTypesSkipped?: number;
          entityTypeIssues?: Array<{
            typeId: string;
            typeName: string;
            issue: string;
            visibleTo?: unknown;
            invalidKeys?: string[];
            validKeys?: string[];
          }>;
          availableKeys?: string[];
          errors?: string[] 
        };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        console.log('[BundleManagement] All bundles regenerated:', response.data.message);
        console.log('[BundleManagement] Details:', {
          successCount: response.data.successCount,
          errorCount: response.data.errorCount,
          entityTypesProcessed: response.data.entityTypesProcessed,
          organizationsProcessed: response.data.organizationsProcessed
        });
        
        // Reload bundles to show updated data
        await loadBundles();
        
        // Show success/error message
        if (response.data.successCount === 0) {
          const skipped = response.data.entityTypesSkipped || 0;
          const updated = response.data.entityTypesUpdated || 0;
          const availableKeys = response.data.availableKeys || [];
          const issues = response.data.entityTypeIssues || [];
          
          let errorMsg = `No bundles were regenerated. ` +
            `Found ${response.data.entityTypesProcessed || 0} entity types (${skipped} skipped`;
          if (updated > 0) {
            errorMsg += `, ${updated} updated with default visibleTo`;
          }
          errorMsg += `) and ${response.data.organizationsProcessed || 0} organizations. ` +
            `Available membership keys: ${availableKeys.join(', ') || 'none'}.`;
          
          if (issues.length > 0) {
            errorMsg += '\n\nEntity type issues:';
            issues.forEach((issue: any) => {
              if (issue.invalidKeys) {
                errorMsg += `\n- ${issue.typeName} (${issue.typeId}): Invalid keys: ${issue.invalidKeys.join(', ')}. Valid keys in visibleTo: ${issue.validKeys.join(', ') || 'none'}`;
              } else {
                errorMsg += `\n- ${issue.typeName} (${issue.typeId}): ${issue.issue}`;
              }
            });
          }
          
          if (updated > 0) {
            errorMsg += `\n\nNote: ${updated} entity type(s) were automatically updated with default visibleTo. Try regenerating again.`;
          } else if (skipped > 0) {
            errorMsg += `\n\nTip: Click "Regenerate All" and confirm to automatically add default visibleTo to entity types missing it.`;
          }
          
          setError(errorMsg);
        } else {
          // Success - show message if any were updated
          if (response.data.entityTypesUpdated && response.data.entityTypesUpdated > 0) {
            setError(null);
            // Could show a success message here if needed
          }
          
          if (response.data.errorCount > 0) {
            const errorDetails = response.data.errors?.join('; ') || '';
            setError(`${response.data.message}. Errors: ${errorDetails}`);
          } else {
            // Clear error if successful
            setError(null);
          }
        }
      } else {
        setError(response.error?.message || 'Failed to regenerate all bundles');
      }
    } catch (err) {
      console.error('[BundleManagement] Error regenerating all bundles:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate all bundles');
    } finally {
      setRegeneratingAll(false);
    }
  }
  
  /**
   * Regenerate a specific bundle
   */
  async function handleRegenerate(bundle: BundleInfo) {
    const bundleKey = bundle.path;
    setRegenerating(prev => new Set(prev).add(bundleKey));
    
    try {
      console.log('[BundleManagement] Regenerating bundle:', bundle.path);
      
      const response = await api.post('/api/super/bundles/regenerate', {
        typeId: bundle.typeId,
        orgId: bundle.orgId || null,
        type: bundle.type
      }) as {
        success: boolean;
        error?: { message: string };
      };
      
      if (response.success) {
        console.log('[BundleManagement] Bundle regenerated successfully');
        // Reload bundles to show updated data
        await loadBundles();
      } else {
        setError(response.error?.message || 'Failed to regenerate bundle');
      }
    } catch (err) {
      console.error('[BundleManagement] Error regenerating bundle:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate bundle');
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(bundleKey);
        return next;
      });
    }
  }
  
  if (authLoading.value) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="mb-8">
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
          <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">Bundle Management</span>
        </nav>
        <div class="flex items-center justify-between">
          <div>
            <h1 class="heading-1 mb-2">Bundle Management</h1>
            <p class="body-text text-surface-500">
              View and manage all data bundles stored in R2
            </p>
          </div>
          <div class="flex items-center gap-3">
            <button
              onClick={handleRegenerateAll}
              disabled={loading || regeneratingAll}
              class="btn-primary"
            >
              {regeneratingAll ? (
                <>
                  <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                  Regenerating All...
                </>
              ) : (
                <>
                  <span class="i-lucide-refresh-cw mr-2"></span>
                  Regenerate All
                </>
              )}
            </button>
            <button
              onClick={loadBundles}
              disabled={loading}
              class="btn-secondary"
            >
              <span class={`i-lucide-refresh-cw mr-2 ${loading ? 'animate-spin' : ''}`}></span>
              Refresh
            </button>
          </div>
        </div>
      </div>
      
      {/* Error state */}
      {error && (
        <div class="card p-4 mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <div class="flex items-start gap-2 text-red-600 dark:text-red-400">
            <span class="i-lucide-alert-circle mt-0.5"></span>
            <div class="flex-1">
              <div class="font-medium mb-1">Error</div>
              <div class="text-sm whitespace-pre-wrap">{error}</div>
            </div>
            <button
              onClick={() => setError(null)}
              class="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
            >
              <span class="i-lucide-x"></span>
            </button>
          </div>
        </div>
      )}
      
      {/* Bundle table */}
      {loading ? (
        <div class="card p-6">
          <div class="flex items-center justify-center py-16">
            <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
          </div>
        </div>
      ) : bundleList.length === 0 ? (
        <div class="card p-12 text-center">
          <span class="i-lucide-package text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
          <h3 class="heading-3 mb-2">No Bundles Found</h3>
          <p class="body-text text-surface-500">
            No bundles have been generated yet.
          </p>
        </div>
      ) : (
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Bundle Name
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Path
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Type
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Entity Type
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Last Generated
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Size
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Entities
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Version
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Client Status
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-200 dark:divide-surface-700">
                {bundleList.map(bundle => {
                  const clientStatus = isBundleLoaded(bundle);
                  
                  return (
                    <tr key={bundle.path} class={`hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors ${!bundle.exists ? 'opacity-60' : ''}`}>
                      <td class="px-6 py-4">
                        <div class="font-medium text-surface-900 dark:text-surface-100">
                          {bundle.friendlyName}
                        </div>
                        {bundle.typeName && (
                          <div class="text-xs text-surface-500 mt-1">
                            {bundle.typeName}
                          </div>
                        )}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <code class="text-xs text-surface-600 dark:text-surface-400 font-mono">
                          {bundle.path}
                        </code>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
                          {getBundleTypeName(bundle.type, bundle.keyId)}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class="text-sm text-surface-900 dark:text-surface-100">
                          {bundle.typeId}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        {bundle.exists && bundle.generatedAt ? (
                          <>
                            <div class="text-sm text-surface-900 dark:text-surface-100">
                              {formatDateTime(bundle.generatedAt)}
                            </div>
                            <div class="text-xs text-surface-500">
                              {formatRelativeTime(bundle.generatedAt)}
                            </div>
                          </>
                        ) : (
                          <span class="text-sm text-surface-400 italic">Not generated</span>
                        )}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`text-sm ${bundle.exists ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400'}`}>
                          {bundle.exists ? formatBytes(bundle.size) : '-'}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`text-sm ${bundle.exists ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400'}`}>
                          {bundle.exists && bundle.entityCount !== undefined ? bundle.entityCount.toLocaleString() : '-'}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class={`text-sm ${bundle.exists ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400'}`}>
                          {bundle.exists && bundle.version !== undefined ? bundle.version : '-'}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        {!bundle.exists ? (
                          <div class="flex items-center gap-2" title="Bundle file doesn't exist in R2. Click 'Regenerate' to create it. Empty bundles are still created, so this means the bundle was never generated.">
                            <span class="i-lucide-alert-circle text-amber-500"></span>
                            <span class="text-sm text-amber-600 dark:text-amber-400">Not generated</span>
                          </div>
                        ) : clientStatus.loaded ? (
                          <div class="flex items-center gap-2">
                            <span class="i-lucide-check-circle text-green-500"></span>
                            <div class="text-sm">
                              <div class="text-green-600 dark:text-green-400 font-medium">
                                Loaded
                              </div>
                              {!clientStatus.isLatest && clientStatus.clientVersion !== undefined && (
                                <div class="text-xs text-amber-600 dark:text-amber-400">
                                  v{clientStatus.clientVersion} (outdated)
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div class="flex items-center gap-2">
                            <span class="i-lucide-x-circle text-surface-400"></span>
                            <span class="text-sm text-surface-500">Not loaded</span>
                          </div>
                        )}
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleRegenerate(bundle)}
                          disabled={regenerating.has(bundle.path)}
                          class="btn-secondary text-xs px-3 py-1"
                          title="Regenerate this bundle"
                        >
                          {regenerating.has(bundle.path) ? (
                            <>
                              <span class="i-lucide-loader-2 animate-spin mr-1"></span>
                              Regenerating...
                            </>
                          ) : (
                            <>
                              <span class="i-lucide-refresh-cw mr-1"></span>
                              Regenerate
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Summary */}
          <div class="px-6 py-4 bg-surface-50 dark:bg-surface-800 border-t border-surface-200 dark:border-surface-700">
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-4">
                <span class="text-surface-600 dark:text-surface-400">
                  Total: {bundleList.length} bundles
                </span>
                <span class="text-surface-600 dark:text-surface-400">
                  Existing: {bundleList.filter(b => b.exists).length}
                </span>
                <span class="text-amber-600 dark:text-amber-400">
                  Missing: {bundleList.filter(b => !b.exists).length}
                </span>
              </div>
              <span class="text-surface-600 dark:text-surface-400">
                Total size: {formatBytes(bundleList.filter(b => b.exists).reduce((sum, b) => sum + b.size, 0))}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
