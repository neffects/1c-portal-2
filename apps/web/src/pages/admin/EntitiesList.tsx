/**
 * Entities List Page
 * 
 * Displays all entities for the organization with filtering and pagination.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem, EntityTypeListItem } from '@1cc/shared';

interface EntitiesListProps {
  orgSlug?: string;
}

export function EntitiesList({ orgSlug }: EntitiesListProps) {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, currentOrganization } = useAuth();
  
  // Helper to get org identifier (slug or ID fallback)
  const getOrgIdentifier = (): string => {
    if (orgSlug) return orgSlug;
    const org = currentOrganization.value;
    return org?.slug || org?.id || '';
  };
  
  const effectiveOrgId = getOrgIdentifier();
  
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  // Filters
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      console.log('[EntitiesList] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Parse URL params on mount to initialize filters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const typeId = urlParams.get('typeId');
    if (typeId) {
      setSelectedTypeId(typeId);
      console.log('[EntitiesList] Initialized typeId from URL:', typeId);
    }
  }, []);
  
  // Load entity types
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadEntityTypes();
    }
  }, [isOrgAdmin.value]);
  
  // Load entities when filters change
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadEntities();
    }
  }, [isOrgAdmin.value, selectedTypeId, selectedStatus, searchQuery, currentPage]);
  
  async function loadEntityTypes() {
    setLoadingTypes(true);
    console.log('[EntitiesList] Fetching entity types...');
    
    try {
      const response = await api.get('/api/entity-types?permission=creatable') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] } 
      };
      
      if (response.success && response.data) {
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setEntityTypes(activeTypes);
        console.log('[EntitiesList] Loaded', activeTypes.length, 'entity types');
      }
    } catch (err) {
      console.error('[EntitiesList] Error loading entity types:', err);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  async function loadEntities() {
    setLoading(true);
    console.log('[EntitiesList] Fetching entities...');
    
    // Read URL params to sync with current URL (in case of navigation)
    const urlParams = new URLSearchParams(window.location.search);
    const urlTypeId = urlParams.get('typeId');
    
    // Sync selectedTypeId with URL if different
    if (urlTypeId && urlTypeId !== selectedTypeId) {
      setSelectedTypeId(urlTypeId);
      // Use URL value for this request
      const params = new URLSearchParams();
      params.set('typeId', urlTypeId);
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
          pagination?: {
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
          };
        } 
      };
      
      if (response.success && response.data) {
        setEntities(response.data.items);
        if (response.data.pagination) {
          setTotalPages(response.data.pagination.totalPages);
        }
        console.log('[EntitiesList] Loaded', response.data.items.length, 'entities');
      }
      setLoading(false);
      return;
    }
    
    try {
      const params = new URLSearchParams();
      if (selectedTypeId) params.set('typeId', selectedTypeId);
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
          pagination?: {
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
          };
        } 
      };
      
      if (response.success && response.data) {
        setEntities(response.data.items);
        if (response.data.pagination) {
          setTotalPages(response.data.pagination.totalPages);
        }
        console.log('[EntitiesList] Loaded', response.data.items.length, 'entities');
      }
    } catch (err) {
      console.error('[EntitiesList] Error loading entities:', err);
    } finally {
      setLoading(false);
    }
  }
  
  function handleFilterChange() {
    setCurrentPage(1); // Reset to first page when filters change
  }
  
  if (authLoading.value) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  // Get selected entity type name for display
  const selectedEntityType = entityTypes.find(t => t.id === selectedTypeId);
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/admin" class="hover:text-surface-700 dark:hover:text-surface-200">Admin</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">
              {selectedEntityType ? selectedEntityType.pluralName : 'Entities'}
            </span>
          </nav>
          <h1 class="heading-1 mb-2">
            {selectedEntityType ? selectedEntityType.pluralName : 'All Entities'}
          </h1>
          <p class="body-text">
            {selectedEntityType 
              ? `Manage and view all ${selectedEntityType.pluralName.toLowerCase()} for your organization.`
              : 'Manage and view all your organization\'s entities.'}
          </p>
        </div>
        <a href="/admin" class="btn-secondary">
          <span class="i-lucide-arrow-left"></span>
          Back to Dashboard
        </a>
      </div>
      
      {/* Filters */}
      <div class="card p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              value={selectedTypeId}
              onChange={(e) => {
                setSelectedTypeId((e.target as HTMLSelectElement).value);
                handleFilterChange();
              }}
              class="input w-full"
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
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Type</th>
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
                        const orgId = getOrgIdentifier();
                        if (orgId) {
                          route(`/admin/${orgId}/entities/${entity.id}`);
                        } else {
                          console.error('[EntitiesList] No organization identifier available');
                        }
                      }}
                    >
                      <td class="px-4 py-3">
                        <span class="font-medium text-surface-900 dark:text-surface-100">
                          {entity.name || entity.id}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-sm text-surface-500">
                        {entityType?.name || entity.entityTypeId}
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
          <p class="body-text mb-4">No entities found.</p>
          <a href="/admin" class="btn-primary">
            Create Your First Entity
          </a>
        </div>
      )}
    </div>
  );
}
