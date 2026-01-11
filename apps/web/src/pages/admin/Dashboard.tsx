/**
 * Admin Dashboard
 * 
 * Main admin page for org admins to manage entities.
 * 
 * Note: Entity types are fetched from the API (which respects org permissions)
 * instead of the sync store manifest (which only has public content).
 * 
 * Organization context is managed via the auth store - users can belong
 * to multiple organizations and switch between them.
 */

import { useEffect, useState, useRef } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem, EntityTypeListItem } from '@1cc/shared';

export function AdminDashboard() {
  const { 
    isAuthenticated, 
    isOrgAdmin, 
    isSuperadmin,
    loading: authLoading, 
    organizationId,
    // Multi-org support from auth store
    organizations,
    currentOrganization,
    switchOrganization
  } = useAuth();
  
  // Fetch entity types from API (respects org permissions) instead of sync store
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [entityCounts, setEntityCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [recentEntities, setRecentEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Organization switcher UI state
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const orgSwitcherRef = useRef<HTMLDivElement>(null);
  
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
  
  // Load entity counts for each type after types are loaded
  useEffect(() => {
    if (isOrgAdmin.value && entityTypes.length > 0) {
      loadEntityCounts();
    }
  }, [isOrgAdmin.value, entityTypes.length]);
  
  // Load recent entities
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadRecentEntities();
    }
  }, [isOrgAdmin.value]);
  
  // Re-load data when organization changes
  useEffect(() => {
    if (isOrgAdmin.value && organizationId.value) {
      console.log('[AdminDashboard] Organization changed to:', organizationId.value);
      loadEntityTypes();
      loadRecentEntities();
    }
  }, [organizationId.value]);
  
  // Close org switcher when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (orgSwitcherRef.current && !orgSwitcherRef.current.contains(e.target as Node)) {
        setShowOrgSwitcher(false);
      }
    }
    if (showOrgSwitcher) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOrgSwitcher]);
  
  // Fetch entity types that this org can CREATE (not just view)
  async function loadEntityTypes() {
    setLoadingTypes(true);
    console.log('[AdminDashboard] Fetching creatable entity types from API...');
    
    try {
      // Use permission=creatable to get types the org can create (not just view)
      const response = await api.get('/api/entity-types?permission=creatable') as { 
        success: boolean; 
        data?: { items: EntityTypeListItem[] } 
      };
      
      if (response.success && response.data) {
        // Only show active entity types
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setEntityTypes(activeTypes);
        console.log('[AdminDashboard] Loaded', activeTypes.length, 'creatable entity types for org');
      } else {
        console.error('[AdminDashboard] Failed to load entity types:', response);
      }
    } catch (err) {
      console.error('[AdminDashboard] Error loading entity types:', err);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  // Load entity counts per type for the organization
  async function loadEntityCounts() {
    setLoadingCounts(true);
    console.log('[AdminDashboard] Fetching entity counts per type...');
    
    const counts: Record<string, number> = {};
    
    try {
      // Fetch counts for each entity type
      await Promise.all(
        entityTypes.map(async (type) => {
          try {
            // Fetch with pageSize=1 to get total count efficiently
            const response = await api.get(`/api/entities?typeId=${type.id}&pageSize=1`) as {
              success: boolean;
              data?: {
                items: EntityListItem[];
                total?: number;
              };
            };
            
            if (response.success && response.data) {
              counts[type.id] = response.data.total || 0;
              console.log(`[AdminDashboard] Type ${type.name}: ${counts[type.id]} entities`);
            } else {
              counts[type.id] = 0;
            }
          } catch (err) {
            console.error(`[AdminDashboard] Error loading count for type ${type.id}:`, err);
            counts[type.id] = 0;
          }
        })
      );
      
      setEntityCounts(counts);
      console.log('[AdminDashboard] Loaded entity counts for', Object.keys(counts).length, 'types');
    } catch (err) {
      console.error('[AdminDashboard] Error loading entity counts:', err);
    } finally {
      setLoadingCounts(false);
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
  
  // Handle organization switch - uses auth store's switchOrganization
  function handleSwitchOrganization(orgId: string) {
    console.log('[AdminDashboard] Switching to organization:', orgId);
    setShowOrgSwitcher(false);
    
    // Switch organization context via auth store (client-side)
    switchOrganization(orgId);
    
    // Data will reload via useEffect when organizationId.value changes
  }
  
  // Get organizations the user can admin (from auth store)
  // If superadmin, they can admin any org they're in; otherwise filter by role
  const adminOrganizations = organizations.value.filter(
    org => isSuperadmin.value || org.role === 'org_admin'
  );
  
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
        <div class="flex-1">
          <h1 class="heading-1 mb-2">Admin Dashboard</h1>
          {/* Organization name and switcher from auth store */}
          {currentOrganization.value ? (
            <div class="flex items-center gap-3">
              <p class="body-text text-surface-600 dark:text-surface-400">{currentOrganization.value.name}</p>
              {adminOrganizations.length > 1 && (
                <div class="relative" ref={orgSwitcherRef}>
                  <button
                    onClick={() => setShowOrgSwitcher(!showOrgSwitcher)}
                    class="btn-secondary text-sm flex items-center gap-2"
                    title="Switch organization"
                  >
                    <span class="i-lucide-building-2"></span>
                    <span>Switch Organization</span>
                    <span class={`i-lucide-chevron-down transition-transform ${showOrgSwitcher ? 'rotate-180' : ''}`}></span>
                  </button>
                  
                  {showOrgSwitcher && (
                    <div class="absolute top-full left-0 mt-2 bg-surface-0 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
                      {adminOrganizations.map(org => (
                        <button
                          key={org.id}
                          onClick={() => handleSwitchOrganization(org.id)}
                          class={`w-full text-left px-4 py-3 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors flex items-center justify-between ${
                            org.id === organizationId.value ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100'
                          }`}
                        >
                          <div class="flex flex-col">
                            <span class="font-medium">{org.name}</span>
                            <span class="text-xs text-surface-400">{org.role}</span>
                          </div>
                          {org.id === organizationId.value && (
                            <span class="i-lucide-check text-primary-600"></span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p class="body-text text-surface-500">
              {organizations.value.length === 0 
                ? 'No organization assigned. Contact your administrator.'
                : 'Select an organization to manage.'
              }
            </p>
          )}
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
      
      {/* Entity Types */}
      <div class="mb-12">
        <h2 class="heading-3 mb-4">Entity Types</h2>
        
        {loadingTypes || loadingCounts ? (
          // Loading skeleton while fetching entity types and counts
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} class="card p-6 flex items-center gap-4 animate-pulse">
                <div class="w-12 h-12 bg-surface-200 dark:bg-surface-700 rounded-xl"></div>
                <div class="flex-1">
                  <div class="h-5 w-24 bg-surface-200 dark:bg-surface-700 rounded mb-2"></div>
                  <div class="h-4 w-16 bg-surface-200 dark:bg-surface-700 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : types.length > 0 ? (
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {types.map(type => {
              const count = entityCounts[type.id] ?? 0;
              return (
                <div
                  key={type.id}
                  class="card-hover p-6 flex items-center gap-4 relative group cursor-pointer"
                  onClick={() => {
                    route(`/admin/entity-types/${type.id}`);
                  }}
                >
                  <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <span class="i-lucide-box text-2xl text-primary-600 dark:text-primary-400"></span>
                  </div>
                  <div class="flex-1">
                    <h3 class="font-semibold text-surface-900 dark:text-surface-100">{type.pluralName}</h3>
                    <p class="text-sm text-surface-500">{count} {count === 1 ? 'entity' : 'entities'}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      route(`/admin/entities/new/${type.id}`);
                    }}
                    class="btn-primary flex items-center gap-2 flex-shrink-0"
                    title={`Add new ${type.name}`}
                  >
                    <span class="i-lucide-plus"></span>
                    <span class="text-sm">New</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div class="card p-6 text-center">
            <span class="i-lucide-alert-circle text-3xl text-surface-400 mb-3 block"></span>
            <p class="body-text">No entity types available. Contact your administrator to grant permissions.</p>
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
