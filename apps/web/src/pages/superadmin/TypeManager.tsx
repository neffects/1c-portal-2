/**
 * Type Manager Page
 * 
 * Create and manage entity types (schema builder).
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityType, EntityTypeListItem } from '@1cc/shared';

interface TypeManagerProps {
  id?: string;
}

export function TypeManager({ id }: TypeManagerProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [types, setTypes] = useState<EntityTypeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<EntityType | null>(null);
  
  const isNew = id === 'new' || window.location.pathname.endsWith('/new');
  const isEditing = !!id && !isNew;
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load types
  useEffect(() => {
    if (isSuperadmin.value) {
      loadTypes();
    }
  }, [isSuperadmin.value]);
  
  // Load selected type
  useEffect(() => {
    if (isEditing && id) {
      loadType(id);
    }
  }, [isEditing, id]);
  
  async function loadTypes() {
    setLoading(true);
    const response = await api.get('/api/entity-types?includeInactive=true') as { success: boolean; data?: { items: EntityTypeListItem[] } };
    
    if (response.success && response.data) {
      setTypes(response.data.items);
    }
    setLoading(false);
  }
  
  async function loadType(typeId: string) {
    const response = await api.get(`/api/entity-types/${typeId}`) as { success: boolean; data?: EntityType };
    
    if (response.success && response.data) {
      setSelectedType(response.data);
    }
  }
  
  if (authLoading.value) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  // Show type list if not editing
  if (!isNew && !isEditing) {
    return (
      <div class="container-default py-12">
        {/* Header */}
        <div class="flex items-start justify-between mb-8">
          <div>
            <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
              <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
              <span class="i-lucide-chevron-right"></span>
              <span class="text-surface-900 dark:text-surface-100">Entity Types</span>
            </nav>
            <h1 class="heading-1">Entity Types</h1>
          </div>
          
          <a href="/super/types/new" class="btn-primary">
            <span class="i-lucide-plus mr-2"></span>
            New Type
          </a>
        </div>
        
        {/* Type list */}
        {loading ? (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} class="card p-6">
                <div class="skeleton h-6 w-1/2 mb-2"></div>
                <div class="skeleton h-4 w-3/4 mb-4"></div>
                <div class="skeleton h-4 w-1/4"></div>
              </div>
            ))}
          </div>
        ) : types.length > 0 ? (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {types.map(type => (
              <div key={type.id} class={`card p-6 ${!type.isActive ? 'opacity-60' : ''}`}>
                <div class="flex items-start justify-between mb-2">
                  <h3 class="font-semibold text-surface-900 dark:text-surface-100">{type.name}</h3>
                  {!type.isActive && (
                    <span class="badge-archived">Archived</span>
                  )}
                </div>
                
                {type.description && (
                  <p class="text-sm text-surface-600 dark:text-surface-400 mb-4 line-clamp-2">
                    {type.description}
                  </p>
                )}
                
                <div class="flex items-center justify-between text-sm">
                  <span class="text-surface-500">
                    {type.fieldCount} fields · {type.entityCount} entities
                  </span>
                  
                  <a href={`/super/types/${type.id}/edit`} class="text-primary-600 hover:text-primary-700">
                    Edit
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="card p-8 text-center">
            <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
              <span class="i-lucide-boxes text-3xl text-surface-400"></span>
            </div>
            <h3 class="heading-4 mb-2">No entity types yet</h3>
            <p class="body-text mb-6">
              Entity types define the structure of your content.
            </p>
            <a href="/super/types/new" class="btn-primary">
              Create First Type
            </a>
          </div>
        )}
      </div>
    );
  }
  
  // Show type editor for new/edit
  return (
    <div class="container-narrow py-12">
      <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
        <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
        <span class="i-lucide-chevron-right"></span>
        <a href="/super/types" class="hover:text-surface-700 dark:hover:text-surface-200">Entity Types</a>
        <span class="i-lucide-chevron-right"></span>
        <span class="text-surface-900 dark:text-surface-100">{isNew ? 'New' : 'Edit'}</span>
      </nav>
      
      <h1 class="heading-1 mb-8">
        {isNew ? 'Create Entity Type' : `Edit ${selectedType?.name || 'Type'}`}
      </h1>
      
      <div class="card p-6 mb-6">
        <p class="body-text text-center py-8">
          Type builder interface coming soon. This will include:
        </p>
        <ul class="list-disc list-inside text-surface-600 dark:text-surface-400 space-y-2 max-w-md mx-auto">
          <li>Visual field configuration</li>
          <li>Drag-and-drop section ordering</li>
          <li>Field constraint settings</li>
          <li>Preview mode</li>
        </ul>
      </div>
      
      <div class="flex justify-between">
        <a href="/super/types" class="btn-ghost">Cancel</a>
        <button class="btn-primary" disabled>Save Type</button>
      </div>
    </div>
  );
}
