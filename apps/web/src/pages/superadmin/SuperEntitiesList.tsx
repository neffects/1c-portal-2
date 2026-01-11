/**
 * Super Entities List Page
 * 
 * Superadmin page for selecting an entity type to manage.
 * Displays entity types as tiles with name, description, and entity count.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityTypeListItem } from '@1cc/shared';

export function SuperEntitiesList() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[SuperEntitiesList] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load entity types
  useEffect(() => {
    if (isSuperadmin.value) {
      loadEntityTypes();
    }
  }, [isSuperadmin.value]);
  
  async function loadEntityTypes() {
    setLoadingTypes(true);
    console.log('[SuperEntitiesList] Fetching entity types...');
    
    try {
      const response = await api.get('/api/entity-types') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] } 
      };
      
      if (response.success && response.data) {
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setEntityTypes(activeTypes);
        console.log('[SuperEntitiesList] Loaded', activeTypes.length, 'entity types');
      }
    } catch (err) {
      console.error('[SuperEntitiesList] Error loading entity types:', err);
    } finally {
      setLoadingTypes(false);
    }
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
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">Entities</span>
          </nav>
          <h1 class="heading-1 mb-2">Manage Entities</h1>
          <p class="body-text">
            Select an entity type to view and manage entities.
          </p>
        </div>
        <div class="flex gap-2">
          <a href="/super" class="btn-secondary">
            <span class="i-lucide-arrow-left"></span>
            Back to Dashboard
          </a>
          <a href="/super/entities/new" class="btn-primary">
            <span class="i-lucide-plus"></span>
            Create Entity
          </a>
        </div>
      </div>
      
      {/* Entity Type Tiles */}
      {entityTypes.length > 0 ? (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {entityTypes.map(type => (
            <a
              key={type.id}
              href={`/super/entity-types/${type.id}`}
              class="card-hover p-6 flex flex-col"
            >
              <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
                <span class="i-lucide-box text-2xl text-primary-600 dark:text-primary-400"></span>
              </div>
              <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">
                {type.pluralName}
              </h3>
              {type.description && (
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-3 line-clamp-2">
                  {type.description}
                </p>
              )}
              <div class="mt-auto pt-3 border-t border-surface-100 dark:border-surface-700">
                <span class="text-sm text-surface-500">
                  {type.entityCount} {type.entityCount === 1 ? 'entity' : 'entities'}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div class="card p-8 text-center">
          <span class="i-lucide-layers text-5xl text-surface-300 dark:text-surface-600 mb-4 block mx-auto"></span>
          <h3 class="heading-3 mb-2">No Entity Types Available</h3>
          <p class="body-text mb-4">
            Create an entity type first to start managing entities.
          </p>
          <a href="/super/types/new" class="btn-primary">
            Create Entity Type
          </a>
        </div>
      )}
    </div>
  );
}
