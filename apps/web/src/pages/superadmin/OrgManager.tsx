/**
 * Organization Manager Page
 * 
 * Create and manage organizations (tenants).
 * Provides list view of all organizations and creation wizard integration.
 * Supports editing existing organizations via a modal form.
 * Includes user/admin management for each organization.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { OrgWizard } from './OrgWizard';
import type { OrganizationListItem, Organization, OrganizationMembership } from '@1cc/shared';

// Tab type for edit modal
type EditTab = 'settings' | 'members';

// Type for system users (from /api/users/all)
interface SystemUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
  organizationName?: string;
  isSuperadmin?: boolean;
}

export function OrgManager() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [orgs, setOrgs] = useState<OrganizationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Controls showing the full organization creation wizard
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  
  // Edit modal state
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<EditTab>('settings');
  
  // Edit form fields
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDomainWhitelist, setEditDomainWhitelist] = useState<string[]>([]);
  const [editAllowSelfSignup, setEditAllowSelfSignup] = useState(false);
  const [editNewDomain, setEditNewDomain] = useState('');
  
  // Member management state
  const [members, setMembers] = useState<OrganizationMembership[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  
  // Invite user state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'org_admin' | 'org_member'>('org_member');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  
  // Role update state
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);
  
  // Remove user state
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [confirmRemoveUser, setConfirmRemoveUser] = useState<OrganizationMembership | null>(null);
  
  // Email autocomplete state
  const [allSystemUsers, setAllSystemUsers] = useState<SystemUser[]>([]);
  const [loadingSystemUsers, setLoadingSystemUsers] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  
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
  
  /**
   * Load a specific organization for editing
   */
  async function loadOrgForEdit(orgId: string) {
    console.log('[OrgManager] Loading organization for edit:', orgId);
    setEditLoading(true);
    setEditError(null);
    setEditTab('settings'); // Reset to settings tab
    
    try {
      const response = await api.get(`/api/organizations/${orgId}`) as { 
        success: boolean; 
        data?: Organization;
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        const org = response.data;
        setEditingOrg(org);
        
        // Populate form fields with existing data
        setEditName(org.name);
        setEditSlug(org.slug);
        setEditDescription(org.profile?.description || '');
        setEditDomainWhitelist(org.settings?.domainWhitelist || []);
        setEditAllowSelfSignup(org.settings?.allowSelfSignup || false);
        setEditNewDomain('');
        
        // Also load members for this org
        loadOrgMembers(orgId);
        
        // Load system users for email autocomplete
        loadAllSystemUsers();
        
        console.log('[OrgManager] Organization loaded for editing:', org.name);
      } else {
        setEditError(response.error?.message || 'Failed to load organization');
        console.error('[OrgManager] Failed to load organization:', response.error);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to load organization');
      console.error('[OrgManager] Error loading organization:', err);
    } finally {
      setEditLoading(false);
    }
  }
  
  /**
   * Load members for the organization being edited
   */
  async function loadOrgMembers(orgId: string) {
    console.log('[OrgManager] Loading members for org:', orgId);
    setMembersLoading(true);
    setMembersError(null);
    
    try {
      const response = await api.get(`/api/users?orgId=${orgId}`) as {
        success: boolean;
        data?: { items: OrganizationMembership[] };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        setMembers(response.data.items);
        console.log('[OrgManager] Loaded', response.data.items.length, 'members');
      } else {
        setMembersError(response.error?.message || 'Failed to load members');
        console.error('[OrgManager] Failed to load members:', response.error);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load members');
      console.error('[OrgManager] Error loading members:', err);
    } finally {
      setMembersLoading(false);
    }
  }
  
  /**
   * Invite/add a user to the organization
   * If the user already exists in the platform, they're added instantly.
   * If they're new, an invitation email is sent.
   */
  async function inviteUser() {
    if (!editingOrg || !inviteEmail) return;
    
    const emailToAdd = inviteEmail; // Capture before clearing
    console.log('[OrgManager] Adding user:', emailToAdd, 'to org:', editingOrg.id);
    setInviting(true);
    setMembersError(null);
    setInviteSuccess(null);
    
    try {
      const response = await api.post(`/api/organizations/${editingOrg.id}/users/invite`, {
        email: inviteEmail,
        role: inviteRole
      }) as { 
        success: boolean; 
        data?: { existingUser?: boolean; message?: string };
        error?: { message: string };
      };
      
      if (response.success) {
        const wasExistingUser = response.data?.existingUser;
        
        setInviteEmail('');
        setInviteRole('org_member');
        
        if (wasExistingUser) {
          // User was added instantly - refresh the members list
          console.log('[OrgManager] Existing user added instantly:', emailToAdd);
          setInviteSuccess(`${emailToAdd} added to organization`);
          
          // Refresh members list to show the new member
          loadOrgMembers(editingOrg.id);
          
          // Refresh org list to update member counts
          loadOrgs();
        } else {
          // New user - invitation sent
          console.log('[OrgManager] Invitation sent to new user:', emailToAdd);
          setInviteSuccess(`Invitation sent to ${emailToAdd}`);
        }
        
        // Clear success message after 5 seconds
        setTimeout(() => setInviteSuccess(null), 5000);
      } else {
        setMembersError(response.error?.message || 'Failed to add user');
        console.error('[OrgManager] Failed to add user:', response);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to add user');
      console.error('[OrgManager] Error adding user:', err);
    } finally {
      setInviting(false);
    }
  }
  
  /**
   * Update a user's role in the organization
   */
  async function updateUserRole(userId: string, newRole: 'org_admin' | 'org_member') {
    console.log('[OrgManager] Updating role for user:', userId, 'to:', newRole);
    setUpdatingRoleUserId(userId);
    setMembersError(null);
    
    try {
      const response = await api.patch(`/api/users/${userId}/role`, {
        role: newRole
      });
      
      if (response.success) {
        console.log('[OrgManager] Role updated successfully');
        // Update local state
        setMembers(members.map(m => 
          m.userId === userId ? { ...m, role: newRole } : m
        ));
      } else {
        const errorResponse = response as { success: false; error?: { message: string } };
        setMembersError(errorResponse.error?.message || 'Failed to update role');
        console.error('[OrgManager] Failed to update role:', response);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to update role');
      console.error('[OrgManager] Error updating role:', err);
    } finally {
      setUpdatingRoleUserId(null);
    }
  }
  
  /**
   * Remove a user from the organization
   */
  async function removeUser(userId: string) {
    console.log('[OrgManager] Removing user:', userId);
    setRemovingUserId(userId);
    setMembersError(null);
    
    try {
      const response = await api.delete(`/api/users/${userId}`);
      
      if (response.success) {
        console.log('[OrgManager] User removed successfully');
        // Update local state
        setMembers(members.filter(m => m.userId !== userId));
        setConfirmRemoveUser(null);
        // Refresh org list to update member counts
        loadOrgs();
      } else {
        const errorResponse = response as { success: false; error?: { message: string } };
        setMembersError(errorResponse.error?.message || 'Failed to remove user');
        console.error('[OrgManager] Failed to remove user:', response);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to remove user');
      console.error('[OrgManager] Error removing user:', err);
    } finally {
      setRemovingUserId(null);
    }
  }
  
  /**
   * Load all users across the system for autocomplete
   */
  async function loadAllSystemUsers() {
    if (allSystemUsers.length > 0 || loadingSystemUsers) return; // Already loaded
    
    console.log('[OrgManager] Loading all system users for autocomplete');
    setLoadingSystemUsers(true);
    
    try {
      const response = await api.get('/api/users/all') as {
        success: boolean;
        data?: { items: SystemUser[] };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        setAllSystemUsers(response.data.items);
        console.log('[OrgManager] Loaded', response.data.items.length, 'system users');
      } else {
        console.error('[OrgManager] Failed to load system users:', response.error);
      }
    } catch (err) {
      console.error('[OrgManager] Error loading system users:', err);
    } finally {
      setLoadingSystemUsers(false);
    }
  }
  
  /**
   * Get autocomplete suggestions based on current email input
   */
  function getAutocompleteSuggestions(): SystemUser[] {
    if (!inviteEmail || inviteEmail.length < 2) return [];
    
    const memberEmails = new Set(members.map(m => m.email.toLowerCase()));
    const query = inviteEmail.toLowerCase();
    
    return allSystemUsers.filter(user => {
      // Exclude users already in this org
      if (memberEmails.has(user.email.toLowerCase())) return false;
      // Match email
      return user.email.toLowerCase().includes(query);
    }).slice(0, 5); // Limit to 5 suggestions
  }
  
  /**
   * Select a user from autocomplete
   */
  function selectAutocompleteUser(user: SystemUser) {
    setInviteEmail(user.email);
    setShowAutocomplete(false);
  }
  
  /**
   * Close the edit modal and reset state
   */
  function closeEditModal() {
    setEditingOrg(null);
    setEditError(null);
    setEditTab('settings');
    setEditName('');
    setEditSlug('');
    setEditDescription('');
    setEditDomainWhitelist([]);
    setEditAllowSelfSignup(false);
    setEditNewDomain('');
    
    // Reset member state
    setMembers([]);
    setMembersError(null);
    setInviteEmail('');
    setInviteRole('org_member');
    setInviteSuccess(null);
    setConfirmRemoveUser(null);
    
    // Reset autocomplete state
    setShowAutocomplete(false);
    setAllSystemUsers([]);
  }
  
  /**
   * Add a domain to the edit whitelist
   */
  function addEditDomain() {
    if (editNewDomain && !editDomainWhitelist.includes(editNewDomain.toLowerCase())) {
      setEditDomainWhitelist([...editDomainWhitelist, editNewDomain.toLowerCase()]);
      setEditNewDomain('');
    }
  }
  
  /**
   * Remove a domain from the edit whitelist
   */
  function removeEditDomain(domain: string) {
    setEditDomainWhitelist(editDomainWhitelist.filter(d => d !== domain));
  }
  
  /**
   * Save organization edits
   */
  async function saveOrgEdit() {
    if (!editingOrg) return;
    
    console.log('[OrgManager] Saving organization edits:', editingOrg.id);
    setEditSaving(true);
    setEditError(null);
    
    try {
      const response = await api.patch(`/api/organizations/${editingOrg.id}`, {
        name: editName,
        slug: editSlug,
        profile: {
          description: editDescription || undefined
        },
        settings: {
          domainWhitelist: editDomainWhitelist,
          allowSelfSignup: editAllowSelfSignup
        }
      });
      
      if (response.success) {
        console.log('[OrgManager] Organization updated successfully');
        closeEditModal();
        loadOrgs(); // Refresh the list
      } else {
        const errorResponse = response as { success: false; error?: { message: string } };
        setEditError(errorResponse.error?.message || 'Failed to update organization');
        console.error('[OrgManager] Failed to update organization:', response);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update organization');
      console.error('[OrgManager] Error updating organization:', err);
    } finally {
      setEditSaving(false);
    }
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
                    <button 
                      onClick={() => loadOrgForEdit(org.id)}
                      class="text-primary-600 hover:text-primary-700 text-sm font-medium"
                    >
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
      
      {/* Organization Edit Modal */}
      {(editingOrg || editLoading) && (
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 overflow-y-auto py-8">
          <div class="bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 my-auto">
            {/* Modal header */}
            <div class="flex items-center justify-between p-6 border-b border-surface-200 dark:border-surface-700">
              <h2 class="heading-2">
                {editLoading ? 'Loading Organization...' : `Edit ${editingOrg?.name}`}
              </h2>
              <button 
                onClick={closeEditModal}
                class="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close modal"
                disabled={editSaving}
              >
                <span class="i-lucide-x text-xl text-surface-500"></span>
              </button>
            </div>
            
            {/* Tabs */}
            {editingOrg && !editLoading && (
              <div class="flex border-b border-surface-200 dark:border-surface-700">
                <button
                  onClick={() => setEditTab('settings')}
                  class={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                    editTab === 'settings'
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                  }`}
                >
                  <span class="i-lucide-settings mr-2"></span>
                  Settings
                </button>
                <button
                  onClick={() => setEditTab('members')}
                  class={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                    editTab === 'members'
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                  }`}
                >
                  <span class="i-lucide-users mr-2"></span>
                  Members ({members.length})
                </button>
              </div>
            )}
            
            {/* Modal content */}
            <div class="p-6 max-h-[60vh] overflow-y-auto">
              {editLoading ? (
                // Loading state
                <div class="space-y-6">
                  <div class="skeleton h-10 w-full"></div>
                  <div class="skeleton h-10 w-full"></div>
                  <div class="skeleton h-20 w-full"></div>
                </div>
              ) : editingOrg ? (
                <>
                  {/* Settings Tab */}
                  {editTab === 'settings' && (
                    <div class="space-y-6">
                      {/* Error message */}
                      {editError && (
                        <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                          <span class="i-lucide-alert-circle mr-2"></span>
                          {editError}
                        </div>
                      )}
                      
                      {/* Organization Name */}
                      <div>
                        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                          Organization Name <span class="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                          class="input"
                          placeholder="e.g., Acme Corporation"
                          disabled={editSaving}
                        />
                      </div>
                      
                      {/* URL Slug */}
                      <div>
                        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                          URL Slug <span class="text-red-500">*</span>
                        </label>
                        <div class="flex items-center gap-2">
                          <span class="text-surface-500">/org/</span>
                          <input
                            type="text"
                            value={editSlug}
                            onInput={(e) => setEditSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            class="input flex-1 font-mono"
                            placeholder="acme-corp"
                            disabled={editSaving}
                          />
                        </div>
                      </div>
                      
                      {/* Description */}
                      <div>
                        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                          Description
                        </label>
                        <textarea
                          value={editDescription}
                          onInput={(e) => setEditDescription((e.target as HTMLTextAreaElement).value)}
                          class="input"
                          rows={3}
                          placeholder="Brief description of this organization..."
                          disabled={editSaving}
                        />
                      </div>
                      
                      {/* Domain Whitelist */}
                      <div>
                        <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                          Domain Whitelist
                        </label>
                        <div class="flex gap-2 mb-2">
                          <input
                            type="text"
                            value={editNewDomain}
                            onInput={(e) => setEditNewDomain((e.target as HTMLInputElement).value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEditDomain())}
                            class="input flex-1"
                            placeholder="e.g., acme.com"
                            disabled={editSaving}
                          />
                          <button 
                            type="button" 
                            onClick={addEditDomain} 
                            class="btn-secondary"
                            disabled={editSaving}
                          >
                            Add
                          </button>
                        </div>
                        
                        {editDomainWhitelist.length > 0 && (
                          <div class="flex flex-wrap gap-2">
                            {editDomainWhitelist.map(domain => (
                              <span key={domain} class="inline-flex items-center gap-1 px-3 py-1 bg-surface-100 dark:bg-surface-700 rounded-full text-sm">
                                {domain}
                                <button
                                  type="button"
                                  onClick={() => removeEditDomain(domain)}
                                  class="text-surface-500 hover:text-red-500"
                                  disabled={editSaving}
                                >
                                  <span class="i-lucide-x text-xs"></span>
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Allow Self-Signup */}
                      <label class="flex items-center gap-3 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editAllowSelfSignup}
                          onChange={(e) => setEditAllowSelfSignup((e.target as HTMLInputElement).checked)}
                          class="w-5 h-5 rounded"
                          disabled={editSaving}
                        />
                        <div>
                          <span class="font-medium text-surface-900 dark:text-surface-100">Allow Self-Signup</span>
                          <p class="text-sm text-surface-500">Users with whitelisted domains can register without an invitation</p>
                        </div>
                      </label>
                    </div>
                  )}
                  
                  {/* Members Tab */}
                  {editTab === 'members' && (
                    <div class="space-y-6">
                      {/* Error/Success messages */}
                      {membersError && (
                        <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                          <span class="i-lucide-alert-circle mr-2"></span>
                          {membersError}
                        </div>
                      )}
                      
                      {inviteSuccess && (
                        <div class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
                          <span class="i-lucide-check-circle mr-2"></span>
                          {inviteSuccess}
                        </div>
                      )}
                      
                      {/* Add Member Section */}
                      <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                        <h3 class="font-medium text-surface-900 dark:text-surface-100 mb-3">
                          <span class="i-lucide-user-plus mr-2"></span>
                          Add Member
                        </h3>
                        <div class="flex flex-col sm:flex-row gap-3">
                          {/* Email input with autocomplete */}
                          <div class="relative flex-1">
                            <input
                              type="email"
                              value={inviteEmail}
                              onInput={(e) => {
                                setInviteEmail((e.target as HTMLInputElement).value);
                                setShowAutocomplete(true);
                              }}
                              onFocus={() => setShowAutocomplete(true)}
                              onBlur={() => {
                                // Delay hiding to allow click on suggestion
                                setTimeout(() => setShowAutocomplete(false), 200);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  setShowAutocomplete(false);
                                  inviteUser();
                                } else if (e.key === 'Escape') {
                                  setShowAutocomplete(false);
                                }
                              }}
                              class="input w-full"
                              placeholder="email@example.com"
                              disabled={inviting}
                              autoComplete="off"
                            />
                            
                            {/* Autocomplete dropdown */}
                            {showAutocomplete && getAutocompleteSuggestions().length > 0 && (
                              <div class="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-10 overflow-hidden">
                                {getAutocompleteSuggestions().map(user => (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => selectAutocompleteUser(user)}
                                    class="w-full px-3 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-700 flex items-center gap-2"
                                  >
                                    <span class={user.isSuperadmin ? 'i-lucide-shield text-amber-500' : 'i-lucide-user text-surface-400'}></span>
                                    <div class="flex-1 min-w-0">
                                      <p class="font-medium text-surface-900 dark:text-surface-100 truncate text-sm">
                                        {user.email}
                                      </p>
                                      <p class="text-xs text-surface-500 truncate">
                                        {user.isSuperadmin ? 'Superadmin' : user.organizationName ? `Member of ${user.organizationName}` : 'Existing user'}
                                      </p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <select
                            value={inviteRole}
                            onChange={(e) => setInviteRole((e.target as HTMLSelectElement).value as 'org_admin' | 'org_member')}
                            class="input w-full sm:w-40"
                            disabled={inviting}
                          >
                            <option value="org_member">Member</option>
                            <option value="org_admin">Admin</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setShowAutocomplete(false);
                              inviteUser();
                            }}
                            class="btn-primary whitespace-nowrap"
                            disabled={inviting || !inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)}
                          >
                            {inviting ? (
                              <>
                                <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                                Adding...
                              </>
                            ) : (
                              <>
                                <span class="i-lucide-plus mr-2"></span>
                                Add
                              </>
                            )}
                          </button>
                        </div>
                        <p class="text-xs text-surface-500 mt-2">
                          Existing users are added immediately. New users receive an invitation email.
                        </p>
                      </div>
                      
                      {/* Members List */}
                      <div>
                        <h3 class="font-medium text-surface-900 dark:text-surface-100 mb-3">
                          Current Members ({members.length})
                        </h3>
                        
                        {membersLoading ? (
                          <div class="space-y-3">
                            {[...Array(3)].map((_, i) => (
                              <div key={i} class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                                <div class="flex-1">
                                  <div class="skeleton h-5 w-48 mb-2"></div>
                                  <div class="skeleton h-4 w-24"></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : members.length > 0 ? (
                          <div class="space-y-3">
                            {members.map(member => (
                              <div key={member.userId} class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                                <div class="flex-1 min-w-0">
                                  <div class="flex items-center gap-2">
                                    <span class="i-lucide-user text-surface-400"></span>
                                    <p class="font-medium text-surface-900 dark:text-surface-100 truncate">
                                      {member.email}
                                    </p>
                                    {member.role === 'org_admin' && (
                                      <span class="px-2 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
                                        Admin
                                      </span>
                                    )}
                                  </div>
                                  <p class="text-sm text-surface-500 mt-1">
                                    Joined {new Date(member.joinedAt).toLocaleDateString()}
                                  </p>
                                </div>
                                
                                <div class="flex items-center gap-2 ml-4">
                                  {/* Role selector */}
                                  <select
                                    value={member.role}
                                    onChange={(e) => updateUserRole(member.userId, (e.target as HTMLSelectElement).value as 'org_admin' | 'org_member')}
                                    class="input text-sm py-1 px-2 w-28"
                                    disabled={updatingRoleUserId === member.userId}
                                  >
                                    <option value="org_member">Member</option>
                                    <option value="org_admin">Admin</option>
                                  </select>
                                  
                                  {/* Remove button */}
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveUser(member)}
                                    class="p-2 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    title="Remove member"
                                    disabled={removingUserId === member.userId}
                                  >
                                    {removingUserId === member.userId ? (
                                      <span class="i-lucide-loader-2 animate-spin"></span>
                                    ) : (
                                      <span class="i-lucide-trash-2"></span>
                                    )}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div class="text-center py-8 text-surface-500">
                            <span class="i-lucide-users text-4xl mb-4 block mx-auto opacity-50"></span>
                            <p>No members yet. Invite someone to get started!</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            
            {/* Modal footer - only show for settings tab */}
            {editingOrg && !editLoading && editTab === 'settings' && (
              <div class="flex items-center justify-end gap-3 p-6 border-t border-surface-200 dark:border-surface-700">
                <button
                  type="button"
                  onClick={closeEditModal}
                  class="btn-ghost"
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveOrgEdit}
                  class="btn-primary"
                  disabled={editSaving || !editName || !editSlug}
                >
                  {editSaving ? (
                    <>
                      <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <span class="i-lucide-check mr-2"></span>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            )}
            
            {/* Modal footer for members tab - just close button */}
            {editingOrg && !editLoading && editTab === 'members' && (
              <div class="flex items-center justify-end gap-3 p-6 border-t border-surface-200 dark:border-surface-700">
                <button
                  type="button"
                  onClick={closeEditModal}
                  class="btn-secondary"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Confirm Remove User Modal */}
      {confirmRemoveUser && (
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div class="bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <span class="i-lucide-alert-triangle text-2xl text-red-600 dark:text-red-400"></span>
              </div>
              <div>
                <h3 class="heading-3">Remove Member</h3>
                <p class="text-sm text-surface-500">This action cannot be undone</p>
              </div>
            </div>
            
            <p class="body-text mb-6">
              Are you sure you want to remove <strong>{confirmRemoveUser.email}</strong> from this organization? 
              They will lose access to all organization content.
            </p>
            
            <div class="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmRemoveUser(null)}
                class="btn-ghost"
                disabled={removingUserId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => removeUser(confirmRemoveUser.userId)}
                class="btn-primary bg-red-600 hover:bg-red-700"
                disabled={removingUserId !== null}
              >
                {removingUserId === confirmRemoveUser.userId ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                    Removing...
                  </>
                ) : (
                  <>
                    <span class="i-lucide-trash-2 mr-2"></span>
                    Remove Member
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
