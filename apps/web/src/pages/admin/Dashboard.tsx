/**
 * Admin Dashboard
 * 
 * Main admin page for org admins to manage entities.
 * 
 * Note: Entity types are fetched from the API (which respects org permissions)
 * instead of the sync store manifest (which only has public content).
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem, EntityTypeListItem } from '@1cc/shared';

export function AdminDashboard() {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, organizationId } = useAuth();
  
  // Fetch entity types from API (respects org permissions) instead of sync store
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [recentEntities, setRecentEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      console.log('[AdminDashboard] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Fetch entity types from API (filtered by org permissions)
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadEntityTypes();
    }
  }, [isOrgAdmin.value]);
  
  // Load recent entities
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadRecentEntities();
    }
  }, [isOrgAdmin.value]);
  
  // Fetch entity types that this org can create
  async function loadEntityTypes() {
    setLoadingTypes(true);
    console.log('[AdminDashboard] Fetching entity types from API...');
    
    try {
      const response = await api.get('/api/entity-types') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] } 
      };
      
      if (response.success && response.data) {
        // Only show active entity types
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setEntityTypes(activeTypes);
        console.log('[AdminDashboard] Loaded', activeTypes.length, 'entity types for org');
      } else {
        console.error('[AdminDashboard] Failed to load entity types:', response);
      }
    } catch (err) {
      console.error('[AdminDashboard] Error loading entity types:', err);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  async function loadRecentEntities() {
    setLoading(true);
    const response = await api.get('/api/entities?pageSize=5') as { success: boolean; data?: { items: EntityListItem[] } };
    
    if (response.success && response.data) {
      setRecentEntities(response.data.items);
    }
    setLoading(false);
  }
  
  if (authLoading.value) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  // Use the fetched entity types (filtered by org permissions)
  const types = entityTypes;
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <h1 class="heading-1 mb-2">Admin Dashboard</h1>
          <p class="body-text">Manage your organization's content.</p>
        </div>
      </div>
      
      {/* Quick actions */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <a href="/admin/users" class="card-hover p-6 flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
            <span class="i-lucide-users text-2xl text-primary-600 dark:text-primary-400"></span>
          </div>
          <div>
            <h3 class="font-semibold text-surface-900 dark:text-surface-100">Manage Users</h3>
            <p class="text-sm text-surface-500">Invite and manage team members</p>
          </div>
        </a>
        
        <div class="card p-6 flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
            <span class="i-lucide-file-text text-2xl text-accent-600 dark:text-accent-400"></span>
          </div>
          <div>
            <h3 class="font-semibold text-surface-900 dark:text-surface-100">Your Entities</h3>
            <p class="text-sm text-surface-500">{recentEntities.length} total</p>
          </div>
        </div>
        
        <div class="card p-6 flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <span class="i-lucide-check-circle text-2xl text-green-600 dark:text-green-400"></span>
          </div>
          <div>
            <h3 class="font-semibold text-surface-900 dark:text-surface-100">Published</h3>
            <p class="text-sm text-surface-500">{recentEntities.filter(e => e.status === 'published').length} live</p>
          </div>
        </div>
      </div>
      
      {/* Create new entity */}
      <div class="mb-12">
        <h2 class="heading-3 mb-4">Create New Entity</h2>
        
        {types.length > 0 ? (
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {types.map(type => (
              <a
                key={type.id}
                href={`/admin/entities/new/${type.id}`}
                class="card-hover p-4 flex items-center gap-3"
              >
                <span class="i-lucide-plus-circle text-xl text-primary-500"></span>
                <span class="font-medium text-surface-900 dark:text-surface-100">
                  New {type.name}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div class="card p-6 text-center">
            <p class="body-text">No entity types available. Contact your administrator.</p>
          </div>
        )}
      </div>
      
      {/* Recent entities */}
      <div>
        <h2 class="heading-3 mb-4">Recent Entities</h2>
        
        {loading ? (
          <div class="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} class="card p-4">
                <div class="skeleton h-5 w-1/2 mb-2"></div>
                <div class="skeleton h-4 w-1/4"></div>
              </div>
            ))}
          </div>
        ) : recentEntities.length > 0 ? (
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
                {recentEntities.map(entity => (
                  <tr key={entity.id} class="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td class="px-4 py-3">
                      <span class="font-medium text-surface-900 dark:text-surface-100">
                        {(entity.data.name as string) || entity.id}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <span class={`badge-${entity.status}`}>{entity.status}</span>
                    </td>
                    <td class="px-4 py-3 text-sm text-surface-500">
                      {new Date(entity.updatedAt).toLocaleDateString()}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <a 
                        href={`/admin/entities/${entity.id}/edit`}
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
        ) : (
          <div class="card p-8 text-center">
            <p class="body-text">No entities yet. Create your first one above!</p>
          </div>
        )}
      </div>
    </div>
  );
}
