/**
 * EntitiesTableCore Component
 * 
 * Shared component for displaying entities in a table with filtering and pagination.
 * Used by both admin and superadmin entity list pages.
 * Supports multi-select with bulk actions (delete) when onBulkDelete is provided.
 */

import { useState, useEffect } from 'preact/hooks';
import type { EntityListItem, EntityTypeListItem, OrganizationListItem } from '@1cc/shared';

export interface EntitiesTableFilters {
  typeId: string;
  status: string;
  search: string;
  organizationId?: string | null; // null = global, undefined = all, string = specific org
}

export interface EntitiesTablePagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
}

interface EntitiesTableCoreProps {
  /** Base path for navigation links (/admin or /super) */
  basePath: string;
  /** List of entities to display */
  entities: EntityListItem[];
  /** Available entity types for filtering */
  entityTypes: EntityTypeListItem[];
  /** Whether entities are loading */
  loading: boolean;
  /** Whether entity types are loading */
  loadingTypes: boolean;
  /** Current filter values */
  filters: EntitiesTableFilters;
  /** Pagination state */
  pagination: EntitiesTablePagination;
  /** Callback when filters change */
  onFilterChange: (filters: Partial<EntitiesTableFilters>) => void;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Whether to show organization filter (superadmin only) */
  showOrgFilter?: boolean;
  /** Available organizations for filtering (when showOrgFilter is true) */
  organizations?: OrganizationListItem[];
  /** Whether organizations are loading */
  loadingOrgs?: boolean;
  /** Selected entity type for header display */
  selectedEntityType?: EntityTypeListItem | null;
  /** Callback for bulk delete action - enables multi-select when provided */
  onBulkDelete?: (entityIds: string[]) => Promise<void>;
  /** Whether bulk delete is in progress */
  bulkDeleteLoading?: boolean;
  /** Callback for bulk hard delete action (superadmin only - permanent) */
  onBulkHardDelete?: (entityIds: string[]) => Promise<void>;
  /** Whether bulk hard delete is in progress */
  bulkHardDeleteLoading?: boolean;
}

export function EntitiesTableCore({
  basePath,
  entities,
  entityTypes,
  loading,
  loadingTypes,
  filters,
  pagination,
  onFilterChange,
  onPageChange,
  showOrgFilter = false,
  organizations = [],
  loadingOrgs = false,
  selectedEntityType,
  onBulkDelete,
  bulkDeleteLoading = false,
  onBulkHardDelete,
  bulkHardDeleteLoading = false,
}: EntitiesTableCoreProps) {
  const { currentPage, totalPages } = pagination;
  
  // Multi-select state - only used when onBulkDelete or onBulkHardDelete is provided
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState(false);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('');
  
  // Clear selection when entities change (e.g., page change, filter change)
  useEffect(() => {
    console.log('[EntitiesTableCore] Entities changed, clearing selection');
    setSelectedIds(new Set());
  }, [entities]);
  
  // Check if all current entities are selected
  const allSelected = entities.length > 0 && entities.every(e => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;
  
  /**
   * Toggle selection for a single entity
   */
  function toggleSelect(entityId: string) {
    console.log('[EntitiesTableCore] Toggling selection for:', entityId);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  }
  
  /**
   * Toggle select all for current page
   */
  function toggleSelectAll() {
    console.log('[EntitiesTableCore] Toggle select all, current state:', allSelected);
    if (allSelected) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all on current page
      setSelectedIds(new Set(entities.map(e => e.id)));
    }
  }
  
  /**
   * Handle bulk delete action
   */
  async function handleBulkDelete() {
    if (!onBulkDelete || selectedIds.size === 0) return;
    
    console.log('[EntitiesTableCore] Executing bulk delete for', selectedIds.size, 'entities');
    try {
      await onBulkDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error('[EntitiesTableCore] Bulk delete error:', err);
    }
  }
  
  /**
   * Handle bulk hard delete action (permanent deletion)
   */
  async function handleBulkHardDelete() {
    if (!onBulkHardDelete || selectedIds.size === 0) return;
    
    // Require typing "DELETE" to confirm
    if (hardDeleteConfirmText !== 'DELETE') {
      return;
    }
    
    console.log('[EntitiesTableCore] Executing bulk HARD DELETE for', selectedIds.size, 'entities');
    try {
      await onBulkHardDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowHardDeleteConfirm(false);
      setHardDeleteConfirmText('');
    } catch (err) {
      console.error('[EntitiesTableCore] Bulk hard delete error:', err);
    }
  }
  
  // Check if multi-select is enabled
  const multiSelectEnabled = !!onBulkDelete || !!onBulkHardDelete;
  
  return (
    <>
      {/* Filters */}
      <div class="card p-6 mb-6">
        <div class={`grid grid-cols-1 gap-4 ${showOrgFilter ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
          {/* Search */}
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Search
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 i-lucide-search text-surface-400"></span>
              <input
                type="text"
                value={filters.search}
                onInput={(e) => {
                  onFilterChange({ search: (e.target as HTMLInputElement).value });
                }}
                placeholder="Search entities..."
                class="input pl-10 w-full"
              />
            </div>
          </div>
          
          {/* Type filter */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Type
            </label>
            <select
              value={filters.typeId}
              onChange={(e) => {
                onFilterChange({ typeId: (e.target as HTMLSelectElement).value });
              }}
              class="input w-full"
              disabled={loadingTypes}
            >
              <option value="">All Types</option>
              {entityTypes.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>
          
          {/* Status filter */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => {
                onFilterChange({ status: (e.target as HTMLSelectElement).value });
              }}
              class="input w-full"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          
          {/* Organization filter (superadmin only) */}
          {showOrgFilter && (
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Organization
              </label>
              <select
                value={filters.organizationId === null ? 'global' : (filters.organizationId || '')}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value === '') {
                    onFilterChange({ organizationId: undefined }); // All orgs
                  } else if (value === 'global') {
                    onFilterChange({ organizationId: null }); // Global only
                  } else {
                    onFilterChange({ organizationId: value }); // Specific org
                  }
                }}
                class="input w-full"
                disabled={loadingOrgs}
              >
                <option value="">All Organizations</option>
                <option value="global">Global (No Organization)</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      
      {/* Bulk Actions Toolbar - shown when items are selected */}
      {multiSelectEnabled && someSelected && (
        <div class="card p-4 mb-6 bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="i-lucide-check-square text-primary-600 dark:text-primary-400"></span>
              <span class="font-medium text-primary-900 dark:text-primary-100">
                {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'} selected
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                class="btn-secondary text-sm"
                disabled={bulkDeleteLoading || bulkHardDeleteLoading}
              >
                Clear Selection
              </button>
              {onBulkDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  class="btn-danger text-sm"
                  disabled={bulkDeleteLoading || bulkHardDeleteLoading}
                >
                  {bulkDeleteLoading ? (
                    <>
                      <span class="i-lucide-loader-2 animate-spin"></span>
                      Archiving...
                    </>
                  ) : (
                    <>
                      <span class="i-lucide-archive"></span>
                      Archive Selected
                    </>
                  )}
                </button>
              )}
              {onBulkHardDelete && (
                <button
                  onClick={() => setShowHardDeleteConfirm(true)}
                  class="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center gap-1.5 border-2 border-red-800"
                  disabled={bulkDeleteLoading || bulkHardDeleteLoading}
                  title="Permanently delete selected entities - cannot be undone!"
                >
                  {bulkHardDeleteLoading ? (
                    <>
                      <span class="i-lucide-loader-2 animate-spin"></span>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <span class="i-lucide-skull"></span>
                      Hard Delete
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div class="card p-6 max-w-md w-full mx-4">
            <div class="flex items-center gap-3 mb-4">
              <span class="i-lucide-alert-triangle text-2xl text-danger-500"></span>
              <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-100">
                Confirm Archive
              </h3>
            </div>
            <p class="body-text mb-6">
              Are you sure you want to archive {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'}? 
              This action will move them to archived status.
            </p>
            <div class="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                class="btn-secondary"
                disabled={bulkDeleteLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                class="btn-danger"
                disabled={bulkDeleteLoading}
              >
                {bulkDeleteLoading ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin"></span>
                    Archiving...
                  </>
                ) : (
                  <>
                    <span class="i-lucide-archive"></span>
                    Archive {selectedIds.size} {selectedIds.size === 1 ? 'Entity' : 'Entities'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Hard Delete Confirmation Modal */}
      {showHardDeleteConfirm && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div class="card p-6 max-w-md w-full mx-4 border-2 border-red-500">
            <div class="flex items-center gap-3 mb-4">
              <span class="i-lucide-skull text-2xl text-red-500"></span>
              <h3 class="text-lg font-semibold text-red-600 dark:text-red-400">
                ⚠️ PERMANENT DELETION ⚠️
              </h3>
            </div>
            <div class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p class="text-red-700 dark:text-red-300 font-medium mb-2">
                You are about to PERMANENTLY DELETE {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'}.
              </p>
              <ul class="text-sm text-red-600 dark:text-red-400 list-disc list-inside space-y-1">
                <li>All data will be removed from storage</li>
                <li>All versions will be deleted</li>
                <li>This action CANNOT be undone</li>
              </ul>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Type <span class="font-mono font-bold text-red-600">DELETE</span> to confirm:
              </label>
              <input
                type="text"
                value={hardDeleteConfirmText}
                onInput={(e) => setHardDeleteConfirmText((e.target as HTMLInputElement).value)}
                placeholder="Type DELETE"
                class="input w-full border-red-300 dark:border-red-700 focus:ring-red-500"
                autoComplete="off"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowHardDeleteConfirm(false);
                  setHardDeleteConfirmText('');
                }}
                class="btn-secondary"
                disabled={bulkHardDeleteLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkHardDelete}
                class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium flex items-center gap-2"
                disabled={bulkHardDeleteLoading || hardDeleteConfirmText !== 'DELETE'}
              >
                {bulkHardDeleteLoading ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin"></span>
                    Permanently Deleting...
                  </>
                ) : (
                  <>
                    <span class="i-lucide-skull"></span>
                    Permanently Delete {selectedIds.size} {selectedIds.size === 1 ? 'Entity' : 'Entities'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Entities table */}
      {loading ? (
        <div class="card p-8">
          <div class="flex items-center justify-center">
            <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
          </div>
        </div>
      ) : entities.length > 0 ? (
        <>
          <div class="card overflow-hidden">
            <table class="w-full">
              <thead class="bg-surface-50 dark:bg-surface-800">
                <tr>
                  {/* Checkbox column for multi-select */}
                  {multiSelectEnabled && (
                    <th class="w-12 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        class="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500"
                        title={allSelected ? 'Deselect all' : 'Select all'}
                      />
                    </th>
                  )}
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Name</th>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Type</th>
                  {showOrgFilter && (
                    <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Organization</th>
                  )}
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Status</th>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Updated</th>
                  <th class="text-right px-4 py-3 text-sm font-medium text-surface-500">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-200 dark:divide-surface-700">
                {entities.map(entity => {
                  const entityType = entityTypes.find(t => t.id === entity.entityTypeId);
                  const isSelected = selectedIds.has(entity.id);
                  return (
                    <tr 
                      key={entity.id} 
                      class={`hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer ${isSelected ? 'bg-primary-50/50 dark:bg-primary-900/20' : ''}`}
                      onClick={() => {
                        window.location.href = `${basePath}/entities/${entity.id}`;
                      }}
                    >
                      {/* Checkbox cell for multi-select */}
                      {multiSelectEnabled && (
                        <td 
                          class="w-12 px-4 py-3" 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(entity.id);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(entity.id)}
                            class="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                      )}
                      <td class="px-4 py-3">
                        <span class="font-medium text-surface-900 dark:text-surface-100">
                          {entity.name || entity.id}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-sm text-surface-500">
                        {entityType?.name || entity.entityTypeId}
                      </td>
                      {showOrgFilter && (
                        <td class="px-4 py-3 text-sm text-surface-500">
                          {entity.organizationId === null ? (
                            <span class="text-primary-600 dark:text-primary-400 font-medium">Global</span>
                          ) : (
                            organizations.find(o => o.id === entity.organizationId)?.name || entity.organizationId
                          )}
                        </td>
                      )}
                      <td class="px-4 py-3">
                        <span class={`badge-${entity.status}`}>{entity.status}</span>
                      </td>
                      <td class="px-4 py-3 text-sm text-surface-500">
                        {new Date(entity.updatedAt).toLocaleDateString()}
                      </td>
                      <td class="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <a 
                          href={`${basePath}/entities/${entity.id}/edit`}
                          class="text-primary-600 hover:text-primary-700 text-sm font-medium"
                        >
                          Edit
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div class="flex items-center justify-between mt-6">
              <div class="text-sm text-surface-500">
                Page {currentPage} of {totalPages}
              </div>
              <div class="flex gap-2">
                <button
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  class="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  class="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div class="card p-8 text-center">
          <span class="i-lucide-inbox text-3xl text-surface-400 mb-3 block"></span>
          <p class="body-text mb-4">No entities found.</p>
          {selectedEntityType ? (
            <a href={`${basePath}/entities/new/${selectedEntityType.id}`} class="btn-primary">
              Create Your First {selectedEntityType.name}
            </a>
          ) : (
            <a href={basePath} class="btn-primary">
              Back to Dashboard
            </a>
          )}
        </div>
      )}
    </>
  );
}
