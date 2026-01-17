/**
 * Entity Type View Page
 * 
 * Displays all entities of a specific type for the organization.
 * Each entity type has its own dedicated route.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem, EntityTypeListItem, EntityType } from '@1cc/shared';

interface EntityTypeViewProps {
  orgSlug?: string;
  typeId?: string;
}

export function EntityTypeView({ orgSlug, typeId }: EntityTypeViewProps) {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, currentOrganization } = useAuth();
  
  // Helper to get org identifier (slug or ID fallback)
  const getOrgIdentifier = (): string => {
    if (orgSlug) return orgSlug;
    const org = currentOrganization.value;
    return org?.slug || org?.id || '';
  };
  
  const effectiveOrgId = getOrgIdentifier();
  
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingType, setLoadingType] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const pageSize = 20;
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      console.log('[EntityTypeView] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load entity type definition
  useEffect(() => {
    if (isOrgAdmin.value && typeId) {
      loadEntityType();
    }
  }, [isOrgAdmin.value, typeId]);
  
  // Load entities when filters change
  useEffect(() => {
    if (isOrgAdmin.value && typeId) {
      loadEntities();
    }
  }, [isOrgAdmin.value, typeId, selectedStatus, searchQuery, currentPage]);
  
  async function loadEntityType() {
    if (!typeId) return;
    
    setLoadingType(true);
    console.log('[EntityTypeView] Fetching entity type:', typeId);
    
    try {
      const response = await api.get(`/api/entity-types/${typeId}`) as {
        success: boolean;
        data?: EntityType;
      };
      
      if (response.success && response.data) {
        setEntityType(response.data);
        console.log('[EntityTypeView] Loaded entity type:', response.data.name);
      } else {
        console.error('[EntityTypeView] Failed to load entity type:', response);
        route('/admin');
      }
    } catch (err) {
      console.error('[EntityTypeView] Error loading entity type:', err);
      route('/admin');
    } finally {
      setLoadingType(false);
    }
  }
  
  async function loadEntities() {
    if (!typeId) return;
    
    setLoading(true);
    console.log('[EntityTypeView] Fetching entities for type:', typeId);
    
    try {
      const params = new URLSearchParams();
      params.set('typeId', typeId);
      if (selectedStatus) params.set('status', selectedStatus);
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', currentPage.toString());
      params.set('pageSize', pageSize.toString());
      params.set('sortBy', 'updatedAt');
      params.set('sortDirection', 'desc');
      
      const response = await api.get(`/api/entities?${params.toString()}`) as {
        success: boolean;
        data?: {
          items: EntityListItem[];
          total?: number;
          page?: number;
          pageSize?: number;
          hasMore?: boolean;
        };
      };
      
      if (response.success && response.data) {
        setEntities(response.data.items);
        if (response.data.total && response.data.pageSize) {
          setTotalPages(Math.ceil(response.data.total / response.data.pageSize));
        }
        console.log('[EntityTypeView] Loaded', response.data.items.length, 'entities');
      }
    } catch (err) {
      console.error('[EntityTypeView] Error loading entities:', err);
    } finally {
      setLoading(false);
    }
  }
  
  function handleFilterChange() {
    setCurrentPage(1); // Reset to first page when filters change
  }
  
  if (authLoading.value || loadingType) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  if (!entityType) {
    return null;
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/admin" class="hover:text-surface-700 dark:hover:text-surface-200">Admin</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">{entityType.pluralName}</span>
          </nav>
          <h1 class="heading-1 mb-2">{entityType.pluralName}</h1>
          <p class="body-text">
            {entityType.description || `Manage and view all ${entityType.pluralName.toLowerCase()} for your organization.`}
          </p>
        </div>
        <div class="flex gap-2">
          <a href="/admin" class="btn-secondary">
            <span class="i-lucide-arrow-left"></span>
            Back to Dashboard
          </a>
          <a href={`/admin/${effectiveOrgId}/entities/new/${typeId}`} class="btn-primary">
            <span class="i-lucide-plus"></span>
            New {entityType.name}
          </a>
        </div>
      </div>
      
      {/* Filters */}
      <div class="card p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Search
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 i-lucide-search text-surface-400"></span>
              <input
                type="text"
                value={searchQuery}
                onInput={(e) => {
                  setSearchQuery((e.target as HTMLInputElement).value);
                  handleFilterChange();
                }}
                placeholder={`Search ${entityType.pluralName.toLowerCase()}...`}
                class="input pl-10 w-full"
              />
            </div>
          </div>
          
          {/* Status filter */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus((e.target as HTMLSelectElement).value);
                handleFilterChange();
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
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Status</th>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Updated</th>
                  <th class="text-right px-4 py-3 text-sm font-medium text-surface-500">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-200 dark:divide-surface-700">
                {entities.map(entity => (
                  <tr 
                    key={entity.id} 
                    class="hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
                    onClick={() => {
                      const orgId = getOrgIdentifier();
                      if (orgId) {
                        route(`/admin/${orgId}/entities/${entity.id}`);
                      } else {
                        console.error('[EntityTypeView] No organization identifier available');
                      }
                    }}
                  >
                    <td class="px-4 py-3">
                      <span class="font-medium text-surface-900 dark:text-surface-100">
                        {entity.name || entity.id}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <span class={`badge-${entity.status}`}>{entity.status}</span>
                    </td>
                    <td class="px-4 py-3 text-sm text-surface-500">
                      {new Date(entity.updatedAt).toLocaleDateString()}
                    </td>
                    <td class="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <a 
                        href={`/admin/${effectiveOrgId}/entities/${entity.id}/edit`}
                        class="text-primary-600 hover:text-primary-700 text-sm font-medium"
                      >
                        Edit
                      </a>
                    </td>
                  </tr>
                ))}
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
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  class="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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
          <p class="body-text mb-4">No {entityType.pluralName.toLowerCase()} found.</p>
          <a href={`/admin/${effectiveOrgId}/entities/new/${typeId}`} class="btn-primary">
            Create Your First {entityType.name}
          </a>
        </div>
      )}
    </div>
  );
}
