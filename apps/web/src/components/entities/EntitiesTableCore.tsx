/**
 * EntitiesTableCore Component
 * 
 * Shared component for displaying entities in a table with filtering and pagination.
 * Used by both admin and superadmin entity list pages.
 */

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
}: EntitiesTableCoreProps) {
  const { currentPage, totalPages } = pagination;
  
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
                  return (
                    <tr 
                      key={entity.id} 
                      class="hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
                      onClick={() => {
                        window.location.href = `${basePath}/entities/${entity.id}`;
                      }}
                    >
                      <td class="px-4 py-3">
                        <span class="font-medium text-surface-900 dark:text-surface-100">
                          {(entity.data.name as string) || entity.id}
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
