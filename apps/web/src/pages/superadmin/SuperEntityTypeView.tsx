/**
 * Super Entity Type View Page
 * 
 * Superadmin page for viewing all entities of a specific type across organizations.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { EntitiesTableCore, type EntitiesTableFilters } from '../../components/entities';
import type { EntityListItem, EntityType, OrganizationListItem } from '@1cc/shared';

interface SuperEntityTypeViewProps {
  typeId?: string;
}

export function SuperEntityTypeView({ typeId }: SuperEntityTypeViewProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingType, setLoadingType] = useState(true);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  
  // Filters
  const [filters, setFilters] = useState<EntitiesTableFilters>({
    typeId: typeId || '',
    status: '',
    search: '',
    organizationId: undefined, // undefined = all orgs
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[SuperEntityTypeView] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load entity type definition and organizations
  useEffect(() => {
    if (isSuperadmin.value && typeId) {
      loadEntityType();
      loadOrganizations();
    }
  }, [isSuperadmin.value, typeId]);
  
  // Load entities when filters change
  useEffect(() => {
    if (isSuperadmin.value && typeId) {
      loadEntities();
    }
  }, [isSuperadmin.value, typeId, filters.status, filters.search, filters.organizationId, currentPage]);
  
  async function loadEntityType() {
    if (!typeId) return;
    
    setLoadingType(true);
    console.log('[SuperEntityTypeView] Fetching entity type:', typeId);
    
    try {
      const response = await api.get(`/api/entity-types/${typeId}`) as {
        success: boolean;
        data?: EntityType;
      };
      
      if (response.success && response.data) {
        setEntityType(response.data);
        console.log('[SuperEntityTypeView] Loaded entity type:', response.data.name);
      } else {
        console.error('[SuperEntityTypeView] Failed to load entity type:', response);
        route('/super');
      }
    } catch (err) {
      console.error('[SuperEntityTypeView] Error loading entity type:', err);
      route('/super');
    } finally {
      setLoadingType(false);
    }
  }
  
  async function loadOrganizations() {
    setLoadingOrgs(true);
    console.log('[SuperEntityTypeView] Fetching organizations...');
    
    try {
      const response = await api.get('/api/organizations') as {
        success: boolean;
        data?: { items: OrganizationListItem[] };
      };
      
      if (response.success && response.data) {
        setOrganizations(response.data.items);
        console.log('[SuperEntityTypeView] Loaded', response.data.items.length, 'organizations');
      }
    } catch (err) {
      console.error('[SuperEntityTypeView] Error loading organizations:', err);
    } finally {
      setLoadingOrgs(false);
    }
  }
  
  async function loadEntities() {
    if (!typeId) return;
    
    setLoading(true);
    console.log('[SuperEntityTypeView] Fetching entities for type:', typeId);
    
    try {
      const params = new URLSearchParams();
      params.set('typeId', typeId);
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      
      // Handle organization filter
      if (filters.organizationId === null) {
        // Global only
        params.set('organizationId', '');
      } else if (filters.organizationId) {
        // Specific org
        params.set('organizationId', filters.organizationId);
      }
      
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
        console.log('[SuperEntityTypeView] Loaded', response.data.items.length, 'entities');
      }
    } catch (err) {
      console.error('[SuperEntityTypeView] Error loading entities:', err);
    } finally {
      setLoading(false);
    }
  }
  
  function handleFilterChange(newFilters: Partial<EntitiesTableFilters>) {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  }
  
  function handlePageChange(page: number) {
    setCurrentPage(page);
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
  
  // Create a minimal entity type list item for the table component
  const entityTypeListItem = {
    id: entityType.id,
    name: entityType.name,
    pluralName: entityType.pluralName,
    slug: entityType.slug,
    description: entityType.description,
    defaultVisibility: entityType.defaultVisibility,
    entityCount: 0,
    fieldCount: entityType.fields.length,
    isActive: entityType.isActive,
  };
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <a href="/super/entities" class="hover:text-surface-700 dark:hover:text-surface-200">Entities</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">{entityType.pluralName}</span>
          </nav>
          <h1 class="heading-1 mb-2">{entityType.pluralName}</h1>
          <p class="body-text">
            {entityType.description || `Manage all ${entityType.pluralName.toLowerCase()} across organizations.`}
          </p>
        </div>
        <div class="flex gap-2">
          <a href="/super/entities" class="btn-secondary">
            <span class="i-lucide-arrow-left"></span>
            All Entities
          </a>
          <a href={`/super/entities/new/${typeId}`} class="btn-primary">
            <span class="i-lucide-plus"></span>
            New {entityType.name}
          </a>
        </div>
      </div>
      
      <EntitiesTableCore
        basePath="/super"
        entities={entities}
        entityTypes={[entityTypeListItem]}
        loading={loading}
        loadingTypes={false}
        filters={{ ...filters, typeId: typeId || '' }}
        pagination={{
          currentPage,
          totalPages,
          pageSize,
        }}
        onFilterChange={handleFilterChange}
        onPageChange={handlePageChange}
        showOrgFilter={true}
        organizations={organizations}
        loadingOrgs={loadingOrgs}
        selectedEntityType={entityTypeListItem}
      />
    </div>
  );
}
