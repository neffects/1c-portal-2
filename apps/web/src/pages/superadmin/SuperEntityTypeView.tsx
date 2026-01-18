/**
 * Super Entity Type View Page
 * 
 * Superadmin page for viewing all entities of a specific type across organizations.
 * Supports multi-select with bulk delete (archive) functionality.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListResponse } from '../../stores/query-sync';
import { EntitiesTableCore, type EntitiesTableFilters } from '../../components/entities';
import { downloadCSV, downloadJSON } from '../../lib/csv';
import type { Entity, EntityListItem, EntityType, OrganizationListItem } from '@1cc/shared';

interface SuperEntityTypeViewProps {
  typeId?: string;
}

export function SuperEntityTypeView({ typeId }: SuperEntityTypeViewProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);
  const [loadingType, setLoadingType] = useState(true);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  
  // Entity list state
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [entityError, setEntityError] = useState<Error | undefined>(undefined);
  
  // Filters
  const [filters, setFilters] = useState<EntitiesTableFilters>({
    typeId: typeId || '',
    status: '',
    search: '',
    organizationId: undefined, // undefined = all orgs
  });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  
  // Bulk delete state
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [bulkHardDeleteLoading, setBulkHardDeleteLoading] = useState(false);
  
  // Export state
  const [exporting, setExporting] = useState(false);
  
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
  
  // Load entities when typeId, filters, or page changes
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
    
    setLoadingEntities(true);
    setEntityError(undefined);
    console.log('[SuperEntityTypeView] Loading entities with filters:', filters, 'page:', currentPage);
    
    try {
      const params = new URLSearchParams();
      params.set('typeId', typeId);
      params.set('page', currentPage.toString());
      params.set('pageSize', pageSize.toString());
      params.set('sortBy', 'updatedAt');
      params.set('sortDirection', 'desc');
      
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.organizationId !== undefined) {
        params.set('organizationId', filters.organizationId || '');
      }
      
      const response = await api.get(`/api/super/entities?${params.toString()}`) as {
        success: boolean;
        data?: EntityListResponse;
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        setEntities(response.data.items || []);
        
        // Calculate total pages
        if (response.data.pagination?.totalPages) {
          setTotalPages(response.data.pagination.totalPages);
        } else if (response.data.total && response.data.pageSize) {
          setTotalPages(Math.ceil(response.data.total / response.data.pageSize));
        } else {
          setTotalPages(1);
        }
        
        console.log('[SuperEntityTypeView] Loaded', response.data.items?.length || 0, 'entities');
      } else {
        const errorMsg = response.error?.message || 'Failed to load entities';
        setEntityError(new Error(errorMsg));
        console.error('[SuperEntityTypeView] Failed to load entities:', response.error);
        setEntities([]);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setEntityError(error);
      console.error('[SuperEntityTypeView] Error loading entities:', err);
      setEntities([]);
    } finally {
      setLoadingEntities(false);
    }
  }
  
  function handleFilterChange(newFilters: Partial<EntitiesTableFilters>) {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  }
  
  function handlePageChange(page: number) {
    setCurrentPage(page);
  }
  
  /**
   * Handle bulk delete (archive) for selected entities
   * Calls the transition endpoint for each entity with action 'archive'
   */
  async function handleBulkDelete(entityIds: string[]): Promise<void> {
    console.log('[SuperEntityTypeView] Starting bulk archive for', entityIds.length, 'entities');
    setBulkDeleteLoading(true);
    
    try {
      // Process each entity deletion - archive them via transition endpoint
      const results = await Promise.allSettled(
        entityIds.map(async (entityId) => {
          console.log('[SuperEntityTypeView] Archiving entity:', entityId);
          const response = await api.post(`/api/super/entities/${entityId}/transition`, {
            action: 'archive'
          });
          
          if (!response.success) {
            console.error('[SuperEntityTypeView] Failed to archive entity:', entityId, response.error);
            throw new Error(response.error?.message || `Failed to archive entity ${entityId}`);
          }
          
          return entityId;
        })
      );
      
      // Count successes and failures
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log('[SuperEntityTypeView] Bulk archive complete - succeeded:', succeeded, 'failed:', failed);
      
      if (failed > 0) {
        console.warn('[SuperEntityTypeView] Some entities failed to archive:', 
          results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason)
        );
      }
      
      // Refresh entities list to show updated data
      await loadEntities();
      
    } catch (err) {
      console.error('[SuperEntityTypeView] Bulk archive error:', err);
      throw err;
    } finally {
      setBulkDeleteLoading(false);
    }
  }
  
  /**
   * Handle export - download entities as CSV or JSON
   */
  async function handleExport(format: 'csv' | 'json') {
    if (!typeId || !entityType) return;
    
    setExporting(true);
    console.log('[SuperEntityTypeView] Exporting entities as', format);
    
    try {
      // Build query params matching current filters
      const params = new URLSearchParams();
      params.set('typeId', typeId);
      if (filters.status) params.set('status', filters.status);
      
      // Handle organization filter
      if (filters.organizationId === null) {
        // Global only
        params.set('organizationId', '');
      } else if (filters.organizationId) {
        // Specific org
        params.set('organizationId', filters.organizationId);
      }
      
      const response = await api.get(`/api/super/entities/export?${params.toString()}`) as {
        success: boolean;
        data?: { entityType: EntityType; entities: Entity[]; exportedAt: string };
        error?: { code?: string; message: string };
      };
      
      if (!response.success) {
        const errorMsg = response.error?.message || 'Unknown error';
        console.error('[SuperEntityTypeView] Export failed:', errorMsg);
        alert(`Export failed: ${errorMsg}`);
        return;
      }
      
      if (!response.data) {
        console.error('[SuperEntityTypeView] Export returned no data');
        alert('Export failed: No data returned from server');
        return;
      }
      
      const { entityType: exportEntityType, entities } = response.data;
      
      console.log('[SuperEntityTypeView] Export response received:', {
        entityCount: entities.length,
        entityIds: entities.map(e => e.id),
        entityNames: entities.map(e => e.name)
      });
      
      // Export endpoint returns full Entity objects, ready for CSV/JSON export
      if (format === 'csv') {
        downloadCSV(entities, exportEntityType);
      } else {
        downloadJSON(entities, exportEntityType);
      }
      
      console.log('[SuperEntityTypeView] Exported', entities.length, 'entities as', format.toUpperCase());
    } catch (err) {
      console.error('[SuperEntityTypeView] Export error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Export failed: ${errorMsg}`);
    } finally {
      setExporting(false);
    }
  }
  
  /**
   * Handle import - redirect to import/export page with typeId pre-filled
   */
  function handleImport() {
    if (!typeId) return;
    route(`/super/import-export?typeId=${typeId}&tab=import`);
  }
  
  /**
   * Handle bulk hard delete (superDelete) for selected entities
   * PERMANENTLY removes entities from storage - cannot be undone!
   */
  async function handleBulkHardDelete(entityIds: string[]): Promise<void> {
    console.log('[SuperEntityTypeView] Starting HARD DELETE for', entityIds.length, 'entities');
    setBulkHardDeleteLoading(true);
    
    try {
      // Process each entity hard deletion via superDelete action
      const results = await Promise.allSettled(
        entityIds.map(async (entityId) => {
          console.log('[SuperEntityTypeView] HARD DELETING entity:', entityId);
          const response = await api.post(`/api/super/entities/${entityId}/transition`, {
            action: 'superDelete'
          });
          
          if (!response.success) {
            console.error('[SuperEntityTypeView] Failed to hard delete entity:', entityId, response.error);
            throw new Error(response.error?.message || `Failed to permanently delete entity ${entityId}`);
          }
          
          return entityId;
        })
      );
      
      // Count successes and failures
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log('[SuperEntityTypeView] Bulk hard delete complete - succeeded:', succeeded, 'failed:', failed);
      
      if (failed > 0) {
        console.warn('[SuperEntityTypeView] Some entities failed to hard delete:', 
          results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason)
        );
      }
      
      // Refresh entities list to show updated data
      await loadEntities();
      
    } catch (err) {
      console.error('[SuperEntityTypeView] Bulk hard delete error:', err);
      throw err;
    } finally {
      setBulkHardDeleteLoading(false);
    }
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
    visibleTo: entityType.visibleTo,
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
          <button
            onClick={() => handleExport('csv')}
            disabled={exporting}
            class="btn-secondary"
            title="Export as CSV"
          >
            <span class="i-lucide-download"></span>
            Export CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={exporting}
            class="btn-secondary"
            title="Export as JSON"
          >
            <span class="i-lucide-download"></span>
            Export JSON
          </button>
          <button
            onClick={handleImport}
            class="btn-secondary"
            title="Bulk import entities"
          >
            <span class="i-lucide-upload"></span>
            Import
          </button>
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
        loading={loadingEntities}
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
        onBulkDelete={handleBulkDelete}
        bulkDeleteLoading={bulkDeleteLoading}
        onBulkHardDelete={handleBulkHardDelete}
        bulkHardDeleteLoading={bulkHardDeleteLoading}
      />
    </div>
  );
}
