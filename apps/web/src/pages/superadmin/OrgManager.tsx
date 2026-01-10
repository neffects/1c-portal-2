/**
 * Organization Manager Page
 * 
 * Create and manage organizations (tenants).
 * Provides list view of all organizations and creation wizard integration.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { OrgWizard } from './OrgWizard';
import type { OrganizationListItem, Organization } from '@1cc/shared';

export function OrgManager() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [orgs, setOrgs] = useState<OrganizationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Controls showing the full organization creation wizard
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load organizations
  useEffect(() => {
    if (isSuperadmin.value) {
      loadOrgs();
    }
  }, [isSuperadmin.value]);
  
  async function loadOrgs() {
    setLoading(true);
    const response = await api.get('/api/organizations') as { success: boolean; data?: { items: OrganizationListItem[] } };
    
    if (response.success && response.data) {
      setOrgs(response.data.items);
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
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">Organizations</span>
          </nav>
          <h1 class="heading-1">Organizations</h1>
        </div>
        
        <button onClick={() => setShowCreateWizard(true)} class="btn-primary">
          <span class="i-lucide-plus mr-2"></span>
          New Organization
        </button>
      </div>
      
      {/* Organization list */}
      {loading ? (
        <div class="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} class="card p-4">
              <div class="skeleton h-6 w-1/3 mb-2"></div>
              <div class="skeleton h-4 w-1/4"></div>
            </div>
          ))}
        </div>
      ) : orgs.length > 0 ? (
        <div class="card overflow-hidden">
          <table class="w-full">
            <thead class="bg-surface-50 dark:bg-surface-800">
              <tr>
                <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Organization</th>
                <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Members</th>
                <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Entities</th>
                <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Created</th>
                <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Status</th>
                <th class="text-right px-4 py-3 text-sm font-medium text-surface-500">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-200 dark:divide-surface-700">
              {orgs.map(org => (
                <tr key={org.id} class="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                  <td class="px-4 py-3">
                    <div>
                      <p class="font-medium text-surface-900 dark:text-surface-100">{org.name}</p>
                      <p class="text-sm text-surface-500">/{org.slug}</p>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-surface-600 dark:text-surface-400">
                    {org.memberCount}
                  </td>
                  <td class="px-4 py-3 text-surface-600 dark:text-surface-400">
                    {org.entityCount}
                  </td>
                  <td class="px-4 py-3 text-sm text-surface-500">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td class="px-4 py-3">
                    {org.isActive ? (
                      <span class="badge-published">Active</span>
                    ) : (
                      <span class="badge-archived">Inactive</span>
                    )}
                  </td>
                  <td class="px-4 py-3 text-right space-x-3">
                    <button class="text-primary-600 hover:text-primary-700 text-sm font-medium">
                      Edit
                    </button>
                    <button class="text-primary-600 hover:text-primary-700 text-sm font-medium">
                      Permissions
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="card p-8 text-center">
          <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
            <span class="i-lucide-building-2 text-3xl text-surface-400"></span>
          </div>
          <h3 class="heading-4 mb-2">No organizations yet</h3>
          <p class="body-text mb-6">
            Organizations are tenants that can manage their own content.
          </p>
          <button onClick={() => setShowCreateWizard(true)} class="btn-primary">
            Create First Organization
          </button>
        </div>
      )}
      
      {/* Organization Creation Wizard Modal */}
      {showCreateWizard && (
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 overflow-y-auto py-8">
          <div class="bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-3xl mx-4 my-auto">
            {/* Modal header */}
            <div class="flex items-center justify-between p-6 border-b border-surface-200 dark:border-surface-700">
              <h2 class="heading-2">Create Organization</h2>
              <button 
                onClick={() => setShowCreateWizard(false)}
                class="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close wizard"
              >
                <span class="i-lucide-x text-xl text-surface-500"></span>
              </button>
            </div>
            
            {/* Wizard content */}
            <div class="p-6">
              <OrgWizard 
                onComplete={() => {
                  // Close modal and refresh org list
                  setShowCreateWizard(false);
                  loadOrgs();
                  console.log('[OrgManager] Organization created, refreshing list');
                }}
                onCancel={() => setShowCreateWizard(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
