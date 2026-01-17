/**
 * Superadmin Dashboard
 * 
 * Main dashboard for superadmins with platform overview.
 * 
 * Note: Fetches entity types directly from API to show accurate count,
 * not from sync store which only includes types with published entities.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityTypeListItem } from '@1cc/shared';

export function SuperadminDashboard() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  const [types, setTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  // Bulk delete state
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ current: number; total: number; typeName: string } | null>(null);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState('');
  
  // Manifest regeneration state
  const [regeneratingManifests, setRegeneratingManifests] = useState(false);
  const [manifestRegenMessage, setManifestRegenMessage] = useState<string | null>(null);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[SuperadminDashboard] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load entity types from API (not sync store)
  useEffect(() => {
    if (isSuperadmin.value) {
      loadEntityTypes();
    }
  }, [isSuperadmin.value]);
  
  /**
   * Handle manual manifest regeneration
   */
  async function handleRegenerateManifests() {
    console.log('[SuperadminDashboard] Regenerating manifests');
    setRegeneratingManifests(true);
    setManifestRegenMessage(null);
    
    try {
      const response = await api.post('/api/super/config/manifests/regenerate') as {
        success: boolean;
        data?: { message: string; timestamp: string };
        error?: { code: string; message: string };
      };
      
      if (response.success) {
        console.log('[SuperadminDashboard] Manifests regenerated successfully');
        setManifestRegenMessage('Manifests regenerated successfully! Homepage will update after refresh.');
        
        // Clear message after 5 seconds
        setTimeout(() => {
          setManifestRegenMessage(null);
        }, 5000);
      } else {
        console.error('[SuperadminDashboard] Manifest regeneration failed:', response.error);
        setManifestRegenMessage(response.error?.message || 'Failed to regenerate manifests');
      }
    } catch (err) {
      console.error('[SuperadminDashboard] Error regenerating manifests:', err);
      setManifestRegenMessage(err instanceof Error ? err.message : 'Failed to regenerate manifests');
    } finally {
      setRegeneratingManifests(false);
    }
  }
  
  /**
   * Load entity types directly from API to get accurate count
   */
  async function loadEntityTypes() {
    console.log('[SuperadminDashboard] Loading entity types from API');
    setLoadingTypes(true);
    
    try {
      const response = await api.get('/api/entity-types?includeInactive=false') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] };
        error?: { code: string; message: string };
      };
      
      console.log('[SuperadminDashboard] API response:', response);
      
      if (response.success && response.data) {
        console.log('[SuperadminDashboard] Loaded', response.data.items.length, 'entity types');
        setTypes(response.data.items);
      } else {
        console.error('[SuperadminDashboard] API returned error:', response.error);
        // Still set loading to false even on error so UI doesn't hang
        setTypes([]);
      }
    } catch (error) {
      console.error('[SuperadminDashboard] Error loading entity types:', error);
      setTypes([]);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  /**
   * Get all entities for selected types and delete them
   */
  async function handleBulkDelete() {
    if (selectedTypeIds.size === 0) {
      setBulkDeleteError('Please select at least one entity type');
      return;
    }
    
    // Require typing "DELETE ALL" to confirm
    if (bulkDeleteConfirmText !== 'DELETE ALL') {
      setBulkDeleteError('Please type "DELETE ALL" to confirm');
      return;
    }
    
    console.log('[SuperadminDashboard] Starting bulk delete for types:', Array.from(selectedTypeIds));
    setBulkDeleting(true);
    setBulkDeleteError(null);
    
    try {
      // Get all entities for each selected type
      const allEntityIds: Array<{ entityId: string; typeId: string; typeName: string }> = [];
      
      for (const typeId of selectedTypeIds) {
        const type = types.find(t => t.id === typeId);
        if (!type) continue;
        
        console.log('[SuperadminDashboard] Fetching entities for type:', type.name);
        
        // Fetch all entities of this type (no pagination limit, get all)
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
          const params = new URLSearchParams();
          params.set('typeId', typeId);
          params.set('page', page.toString());
          params.set('pageSize', '100'); // Large page size to minimize requests
          
          // Use regular entities endpoint - it supports typeId and works for superadmins
          const response = await api.get(`/api/entities?${params.toString()}`) as {
            success: boolean;
            data?: {
              items: Array<{ id: string }>;
              hasMore?: boolean;
            };
          };
          
          if (response.success && response.data) {
            for (const entity of response.data.items) {
              allEntityIds.push({ entityId: entity.id, typeId, typeName: type.name });
            }
            hasMore = response.data.hasMore || false;
            page++;
          } else {
            hasMore = false;
          }
        }
      }
      
      console.log('[SuperadminDashboard] Found', allEntityIds.length, 'entities to delete');
      
      // Delete all entities using superDelete action (if any exist)
      let deletedCount = 0;
      let failedCount = 0;
      
      if (allEntityIds.length > 0) {
        for (let i = 0; i < allEntityIds.length; i++) {
          const { entityId, typeName } = allEntityIds[i];
          
          setBulkDeleteProgress({
            current: i + 1,
            total: allEntityIds.length,
            typeName: `Deleting entity: ${typeName}`
          });
          
          try {
            const response = await api.post(`/api/super/entities/${entityId}/transition`, {
              action: 'superDelete'
            });
            
            if (response.success) {
              deletedCount++;
              console.log('[SuperadminDashboard] Deleted entity:', entityId);
            } else {
              failedCount++;
              console.error('[SuperadminDashboard] Failed to delete entity:', entityId, response.error);
            }
          } catch (err) {
            failedCount++;
            console.error('[SuperadminDashboard] Error deleting entity:', entityId, err);
          }
        }
      }
      
      console.log('[SuperadminDashboard] Entity deletion complete - deleted:', deletedCount, 'failed:', failedCount);
      
      // Now delete the entity types themselves (hard delete)
      // First, verify that entities are actually gone by checking if any entities still exist
      let deletedTypeCount = 0;
      let failedTypeCount = 0;
      let skippedTypeCount = 0;
      const totalItems = allEntityIds.length + selectedTypeIds.size;
      let currentItem = allEntityIds.length; // Start counting from where entities left off
      
      for (const typeId of selectedTypeIds) {
        const type = types.find(t => t.id === typeId);
        if (!type) continue;
        
        currentItem++;
        setBulkDeleteProgress({
          current: currentItem,
          total: totalItems,
          typeName: `Verifying type: ${type.name}`
        });
        
        // Verify no entities remain by actually querying for entities of this type
        let stillHasEntities = false;
        try {
          const verifyParams = new URLSearchParams();
          verifyParams.set('typeId', typeId);
          verifyParams.set('page', '1');
          verifyParams.set('pageSize', '1'); // Just check if any exist
          
          const verifyResponse = await api.get(`/api/entities?${verifyParams.toString()}`) as {
            success: boolean;
            data?: {
              items: Array<{ id: string }>;
              total?: number;
            };
          };
          
          if (verifyResponse.success && verifyResponse.data) {
            if (verifyResponse.data.items.length > 0 || (verifyResponse.data.total && verifyResponse.data.total > 0)) {
              stillHasEntities = true;
              console.warn('[SuperadminDashboard] Type still has entities after deletion:', typeId, 'count:', verifyResponse.data.total || verifyResponse.data.items.length);
            }
          }
        } catch (err) {
          console.log('[SuperadminDashboard] Could not verify entities for type:', typeId, err);
          // Continue anyway - the delete endpoint will check
        }
        
        if (stillHasEntities) {
          console.warn('[SuperadminDashboard] Skipping type deletion - still has entities:', typeId);
          skippedTypeCount++;
          continue;
        }
        
        setBulkDeleteProgress({
          current: currentItem,
          total: totalItems,
          typeName: `Deleting type: ${type.name}`
        });
        
        try {
          const response = await api.delete(`/api/entity-types/${typeId}/hard`) as {
            success: boolean;
            error?: { code: string; message: string };
          };
          
          if (response.success) {
            deletedTypeCount++;
            console.log('[SuperadminDashboard] Deleted entity type:', typeId, type.name);
          } else {
            // Check if error is because entities still exist
            if (response.error?.code === 'VALIDATION_ERROR' && 
                response.error?.message?.includes('associated entity')) {
              console.warn('[SuperadminDashboard] Type still has entities (validation error), skipping:', typeId, response.error.message);
              skippedTypeCount++;
            } else {
              failedTypeCount++;
              console.error('[SuperadminDashboard] Failed to delete entity type:', typeId, response.error);
            }
          }
        } catch (err) {
          // Check if it's a validation error about entities
          if (err instanceof Error && err.message.includes('associated entity')) {
            console.warn('[SuperadminDashboard] Type still has entities (exception), skipping:', typeId);
            skippedTypeCount++;
          } else {
            failedTypeCount++;
            console.error('[SuperadminDashboard] Error deleting entity type:', typeId, err);
          }
        }
      }
      
      console.log('[SuperadminDashboard] Bulk delete complete - entities:', deletedCount, 'types:', deletedTypeCount, 'skipped:', skippedTypeCount);
      
      setBulkDeleteProgress(null);
      
      // Build success/error message
      const messages: string[] = [];
      if (deletedCount > 0) {
        messages.push(`${deletedCount} ${deletedCount === 1 ? 'entity' : 'entities'}`);
      }
      if (deletedTypeCount > 0) {
        messages.push(`${deletedTypeCount} ${deletedTypeCount === 1 ? 'entity type' : 'entity types'}`);
      }
      
      const warningParts: string[] = [];
      if (skippedTypeCount > 0) {
        warningParts.push(`${skippedTypeCount} ${skippedTypeCount === 1 ? 'type' : 'types'} skipped (still has entities)`);
      }
      
      if (failedCount > 0 || failedTypeCount > 0) {
        const errorParts: string[] = [];
        if (failedCount > 0) {
          errorParts.push(`${failedCount} ${failedCount === 1 ? 'entity' : 'entities'} failed`);
        }
        if (failedTypeCount > 0) {
          errorParts.push(`${failedTypeCount} ${failedTypeCount === 1 ? 'type' : 'types'} failed`);
        }
        let errorMsg = `Deleted ${messages.join(' and ')}`;
        if (warningParts.length > 0) {
          errorMsg += `. ${warningParts.join('. ')}`;
        }
        errorMsg += `. ${errorParts.join(' and ')}. Check console for details.`;
        setBulkDeleteError(errorMsg);
      } else if (skippedTypeCount > 0) {
        // Some types were skipped but no failures
        let warningMsg = `Deleted ${messages.join(' and ')}`;
        warningMsg += `. ${warningParts.join('. ')}. Some entity types still have entities and were not deleted.`;
        setBulkDeleteError(warningMsg);
      } else {
        // Success - reload types to update counts
        await loadEntityTypes();
        setShowBulkDeleteModal(false);
        setSelectedTypeIds(new Set());
        setBulkDeleteConfirmText('');
        // Show success message
        alert(`Successfully deleted ${messages.join(' and ')}`);
      }
    } catch (err) {
      console.error('[SuperadminDashboard] Bulk delete error:', err);
      setBulkDeleteError(err instanceof Error ? err.message : 'Failed to delete entities');
      setBulkDeleteProgress(null);
    } finally {
      setBulkDeleting(false);
    }
  }
  
  /**
   * Toggle selection of an entity type
   */
  function toggleTypeSelection(typeId: string) {
    const newSelection = new Set(selectedTypeIds);
    if (newSelection.has(typeId)) {
      newSelection.delete(typeId);
    } else {
      newSelection.add(typeId);
    }
    setSelectedTypeIds(newSelection);
  }
  
  /**
   * Get total entity count for selected types
   */
  function getTotalEntityCount(): number {
    return types
      .filter(t => selectedTypeIds.has(t.id))
      .reduce((sum, t) => sum + (t.entityCount || 0), 0);
  }
  
  if (authLoading.value || loadingTypes) {
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
        <h1 class="heading-1 mb-2">Superadmin Dashboard</h1>
        <p class="body-text">Platform administration and management.</p>
      </div>
      
      {/* Quick links */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        <a href="/super/entities" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-file-text text-2xl text-blue-600 dark:text-blue-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Entities</h3>
          <p class="text-sm text-surface-500">Manage all entities & global content</p>
        </a>
        
        <a href="/super/types" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-boxes text-2xl text-primary-600 dark:text-primary-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Entity Types</h3>
          <p class="text-sm text-surface-500">{types.length} {types.length === 1 ? 'type' : 'types'} defined</p>
        </a>
        
        <a href="/super/orgs" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-building-2 text-2xl text-accent-600 dark:text-accent-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Organizations</h3>
          <p class="text-sm text-surface-500">Manage tenants</p>
        </a>
        
        <a href="/super/approvals" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-check-square text-2xl text-amber-600 dark:text-amber-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Approval Queue</h3>
          <p class="text-sm text-surface-500">Review pending content</p>
        </a>
        
        <a href="/super/branding" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-palette text-2xl text-purple-600 dark:text-purple-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Branding</h3>
          <p class="text-sm text-surface-500">Configure platform branding</p>
        </a>
        
        <a href="/super/membership-keys" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-key text-2xl text-indigo-600 dark:text-indigo-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Membership Keys</h3>
          <p class="text-sm text-surface-500">Manage access levels & membership keys</p>
        </a>
        
        <a href="/super/import-export" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-arrow-left-right text-2xl text-teal-600 dark:text-teal-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Import / Export</h3>
          <p class="text-sm text-surface-500">Bulk data operations</p>
        </a>
        
        <a href="/super/bundles" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-package text-2xl text-orange-600 dark:text-orange-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Bundle Management</h3>
          <p class="text-sm text-surface-500">View and manage data bundles</p>
        </a>
      </div>
      
      {/* Platform Health */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <div class="card p-6">
          <div class="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-activity text-2xl text-green-600 dark:text-green-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Platform Health</h3>
          <p class="text-sm text-green-600">All systems operational</p>
        </div>
      </div>
      
      {/* Recent activity placeholder */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div class="card p-6">
          <h2 class="heading-4 mb-4">Recent Entity Types</h2>
          {types.length > 0 ? (
            <ul class="space-y-3">
              {types.slice(0, 5).map(type => (
                <li key={type.id} class="flex items-center justify-between py-2 border-b border-surface-100 dark:border-surface-700 last:border-0">
                  <div>
                    <p class="font-medium text-surface-900 dark:text-surface-100">{type.name}</p>
                    <p class="text-sm text-surface-500">{type.entityCount} entities</p>
                  </div>
                  <a href={`/super/types/${type.id}/edit`} class="text-primary-600 text-sm">
                    Edit
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p class="body-text py-4">No entity types yet.</p>
          )}
          
          <a href="/super/types" class="btn-secondary w-full mt-4">
            View All Types
          </a>
        </div>
        
        <div class="card p-6">
          <h2 class="heading-4 mb-4">Quick Actions</h2>
          <div class="space-y-3">
            <button
              onClick={handleRegenerateManifests}
              disabled={regeneratingManifests}
              class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {regeneratingManifests ? (
                <>
                  <span class="i-lucide-loader-2 animate-spin text-xl text-primary-500"></span>
                  <span class="text-surface-900 dark:text-surface-100">Regenerating Manifests...</span>
                </>
              ) : (
                <>
                  <span class="i-lucide-refresh-cw text-xl text-primary-500"></span>
                  <span class="text-surface-900 dark:text-surface-100">Regenerate Manifests</span>
                </>
              )}
            </button>
            {manifestRegenMessage && (
              <div class={`mt-2 p-3 rounded-lg text-sm ${
                manifestRegenMessage.includes('success') 
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                {manifestRegenMessage}
              </div>
            )}
            <a href="/super/entities/new" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
              <span class="i-lucide-plus-circle text-xl text-primary-500"></span>
              <span class="text-surface-900 dark:text-surface-100">Create Entity</span>
            </a>
            <a href="/super/types/new" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
              <span class="i-lucide-plus-circle text-xl text-primary-500"></span>
              <span class="text-surface-900 dark:text-surface-100">Create Entity Type</span>
            </a>
            <a href="/super/orgs" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
              <span class="i-lucide-plus-circle text-xl text-primary-500"></span>
              <span class="text-surface-900 dark:text-surface-100">Create Organization</span>
            </a>
            <a href="/super/approvals" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
              <span class="i-lucide-clipboard-check text-xl text-primary-500"></span>
              <span class="text-surface-900 dark:text-surface-100">Review Approvals</span>
            </a>
            <a href="/super/import-export" class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
              <span class="i-lucide-upload text-xl text-primary-500"></span>
              <span class="text-surface-900 dark:text-surface-100">Import / Export Data</span>
            </a>
          </div>
        </div>
      </div>
      
      {/* Bulk Content Deletion */}
      <div class="card p-6 border-2 border-red-200 dark:border-red-800">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="heading-4 mb-2 flex items-center gap-2">
              <span class="i-lucide-trash-2 text-red-600"></span>
              Bulk Content Deletion
            </h2>
            <p class="text-sm text-surface-600 dark:text-surface-400">
              Permanently delete all entities and entity types. This action cannot be undone!
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              console.log('[SuperadminDashboard] Opening bulk delete modal');
              setShowBulkDeleteModal(true);
              setSelectedTypeIds(new Set());
              setBulkDeleteConfirmText('');
              setBulkDeleteError(null);
            }}
            class="btn-danger"
          >
            <span class="i-lucide-trash-2 mr-2"></span>
            Delete All Content
          </button>
        </div>
      </div>
      
      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div 
          class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => {
            if (!bulkDeleting) {
              setShowBulkDeleteModal(false);
              setSelectedTypeIds(new Set());
              setBulkDeleteConfirmText('');
              setBulkDeleteError(null);
            }
          }}
        >
          <div 
            class="bg-white dark:bg-surface-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border-2 border-red-500 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div class="p-6 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                  <span class="i-lucide-trash-2 text-2xl text-red-600"></span>
                </div>
                <div>
                  <h2 class="text-xl font-bold text-red-700 dark:text-red-400">
                    Bulk Content Deletion
                  </h2>
                  <p class="text-sm text-red-600 dark:text-red-400">
                    This action cannot be undone!
                  </p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div class="p-6 space-y-4 overflow-y-auto flex-1">
              <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div class="flex items-start gap-2">
                  <span class="i-lucide-alert-triangle text-amber-600 mt-0.5"></span>
                  <div class="text-sm text-amber-700 dark:text-amber-400">
                    <p class="font-medium mb-1">Warning: This will permanently delete:</p>
                    <ul class="list-disc list-inside space-y-0.5">
                      <li>All entities of the selected types</li>
                      <li>All entity versions and history</li>
                      <li>All associated files and data</li>
                      <li>The selected entity types themselves</li>
                    </ul>
                    <p class="mt-2 font-medium">This action cannot be undone!</p>
                  </div>
                </div>
              </div>
              
              {/* Type Selection */}
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-3">
                  Select Entity Types to Delete:
                </label>
                <div class="space-y-2 max-h-64 overflow-y-auto border border-surface-200 dark:border-surface-700 rounded-lg p-3">
                  {types.length === 0 ? (
                    <p class="text-sm text-surface-500 py-4 text-center">No entity types available</p>
                  ) : (
                    types.map(type => (
                      <label
                        key={type.id}
                        class="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer border border-surface-200 dark:border-surface-700"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTypeIds.has(type.id)}
                          onChange={() => toggleTypeSelection(type.id)}
                          disabled={bulkDeleting}
                          class="w-4 h-4 rounded border-surface-300 text-red-600 focus:ring-red-500"
                        />
                        <div class="flex-1">
                          <div class="font-medium text-surface-900 dark:text-surface-100">
                            {type.name}
                          </div>
                          <div class="text-sm text-surface-500">
                            {type.entityCount || 0} {type.entityCount === 1 ? 'entity' : 'entities'}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
              
              {/* Summary */}
              {selectedTypeIds.size > 0 && (
                <div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-4">
                  <div class="text-sm space-y-1">
                    <p class="font-medium text-surface-900 dark:text-surface-100">
                      Selected: {selectedTypeIds.size} {selectedTypeIds.size === 1 ? 'entity type' : 'entity types'}
                    </p>
                    <p class="text-surface-600 dark:text-surface-400">
                      Entities to delete: <span class="font-bold text-red-600">{getTotalEntityCount()}</span>
                    </p>
                    <p class="text-surface-600 dark:text-surface-400">
                      Entity types to delete: <span class="font-bold text-red-600">{selectedTypeIds.size}</span>
                    </p>
                  </div>
                </div>
              )}
              
              {/* Confirmation Input */}
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Type <span class="font-bold text-red-600">"DELETE ALL"</span> to confirm:
                </label>
                <input
                  type="text"
                  value={bulkDeleteConfirmText}
                  onInput={(e) => setBulkDeleteConfirmText((e.target as HTMLInputElement).value)}
                  placeholder="DELETE ALL"
                  class="input w-full border-red-300 dark:border-red-700 focus:ring-red-500 focus:border-red-500"
                  autoComplete="off"
                  disabled={bulkDeleting}
                />
              </div>
              
              {/* Error Message */}
              {bulkDeleteError && (
                <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p class="text-sm text-red-700 dark:text-red-400">{bulkDeleteError}</p>
                </div>
              )}
              
              {/* Progress */}
              {bulkDeleteProgress && (
                <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="i-lucide-loader-2 animate-spin text-blue-600"></span>
                    <span class="text-sm font-medium text-blue-700 dark:text-blue-400">
                      Deleting entities... ({bulkDeleteProgress.current} / {bulkDeleteProgress.total})
                    </span>
                  </div>
                  <div class="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                    <div
                      class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={`width: ${(bulkDeleteProgress.current / bulkDeleteProgress.total) * 100}%`}
                    ></div>
                  </div>
                  <p class="text-xs text-blue-600 dark:text-blue-400 mt-2">
                    Currently deleting: {bulkDeleteProgress.typeName}
                  </p>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div class="p-6 border-t border-surface-200 dark:border-surface-700 flex justify-end gap-3 bg-surface-50 dark:bg-surface-900">
              <button
                type="button"
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setSelectedTypeIds(new Set());
                  setBulkDeleteConfirmText('');
                  setBulkDeleteError(null);
                }}
                class="btn-secondary"
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting || selectedTypeIds.size === 0 || bulkDeleteConfirmText !== 'DELETE ALL'}
                class="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:cursor-not-allowed"
              >
                {bulkDeleting ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin"></span>
                    Deleting...
                  </>
                ) : (
                  <>
                    <span class="i-lucide-trash-2"></span>
                    Delete All Selected
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
