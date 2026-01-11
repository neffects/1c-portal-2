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
   * Load entity types directly from API to get accurate count
   */
  async function loadEntityTypes() {
    console.log('[SuperadminDashboard] Loading entity types from API');
    setLoadingTypes(true);
    
    try {
      const response = await api.get('/api/entity-types?includeInactive=false') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] } 
      };
      
      if (response.success && response.data) {
        console.log('[SuperadminDashboard] Loaded', response.data.items.length, 'entity types');
        setTypes(response.data.items);
      }
    } catch (error) {
      console.error('[SuperadminDashboard] Error loading entity types:', error);
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
      <div class="mb-8">
        <h1 class="heading-1 mb-2">Superadmin Dashboard</h1>
        <p class="body-text">Platform administration and management.</p>
      </div>
      
      {/* Quick links */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-12">
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
        
        <a href="/super/import-export" class="card-hover p-6">
          <div class="w-12 h-12 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
            <span class="i-lucide-arrow-left-right text-2xl text-teal-600 dark:text-teal-400"></span>
          </div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 mb-1">Import / Export</h3>
          <p class="text-sm text-surface-500">Bulk data operations</p>
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
    </div>
  );
}
