/**
 * User Management Page
 * 
 * Manage organization users - invite, role change, remove.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { OrganizationMembership } from '@1cc/shared';

export function UserManagement() {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, organizationId } = useAuth();
  
  const [users, setUsers] = useState<OrganizationMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'org_admin' | 'org_member'>('org_member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load users
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadUsers();
    }
  }, [isOrgAdmin.value]);
  
  async function loadUsers() {
    setLoading(true);
    const response = await api.get('/api/users') as { success: boolean; data?: { items: OrganizationMembership[] } };
    
    if (response.success && response.data) {
      setUsers(response.data.items);
    }
    setLoading(false);
  }
  
  async function handleInvite(e: Event) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);
    
    const response = await api.post('/api/users/invite', {
      email: inviteEmail,
      role: inviteRole
    });
    
    if (response.success) {
      setInviteSuccess(true);
      setInviteEmail('');
      loadUsers();
    } else {
      setInviteError(response.error?.message || 'Failed to send invitation');
    }
    
    setInviting(false);
  }
  
  async function handleChangeRole(userId: string, newRole: 'org_admin' | 'org_member') {
    const response = await api.patch(`/api/users/${userId}/role`, { role: newRole });
    
    if (response.success) {
      loadUsers();
    }
  }
  
  async function handleRemoveUser(userId: string) {
    if (!confirm('Are you sure you want to remove this user?')) return;
    
    const response = await api.delete(`/api/users/${userId}`);
    
    if (response.success) {
      setUsers(users.filter(u => u.userId !== userId));
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
      <div class="mb-8">
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
          <a href="/admin" class="hover:text-surface-700 dark:hover:text-surface-200">Admin</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">Users</span>
        </nav>
        
        <h1 class="heading-1">User Management</h1>
      </div>
      
      {/* Invite form */}
      <div class="card p-6 mb-8">
        <h2 class="heading-4 mb-4">Invite New User</h2>
        
        <form onSubmit={handleInvite} class="flex flex-wrap gap-4">
          <div class="flex-1 min-w-64">
            <input
              type="email"
              value={inviteEmail}
              onInput={(e) => setInviteEmail((e.target as HTMLInputElement).value)}
              placeholder="email@example.com"
              required
              class="input"
              disabled={inviting}
            />
          </div>
          
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole((e.target as HTMLSelectElement).value as 'org_admin' | 'org_member')}
            class="input w-auto"
            disabled={inviting}
          >
            <option value="org_member">Member</option>
            <option value="org_admin">Admin</option>
          </select>
          
          <button type="submit" class="btn-primary" disabled={inviting || !inviteEmail}>
            {inviting ? (
              <>
                <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                Sending...
              </>
            ) : (
              <>
                <span class="i-lucide-send mr-2"></span>
                Send Invitation
              </>
            )}
          </button>
        </form>
        
        {inviteError && (
          <p class="text-sm text-red-600 dark:text-red-400 mt-3">
            <span class="i-lucide-alert-circle mr-1"></span>
            {inviteError}
          </p>
        )}
        
        {inviteSuccess && (
          <p class="text-sm text-green-600 dark:text-green-400 mt-3">
            <span class="i-lucide-check-circle mr-1"></span>
            Invitation sent successfully!
          </p>
        )}
      </div>
      
      {/* User list */}
      <div>
        <h2 class="heading-4 mb-4">Team Members ({users.length})</h2>
        
        {loading ? (
          <div class="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} class="card p-4">
                <div class="skeleton h-5 w-1/3 mb-2"></div>
                <div class="skeleton h-4 w-1/4"></div>
              </div>
            ))}
          </div>
        ) : users.length > 0 ? (
          <div class="card overflow-hidden">
            <table class="w-full">
              <thead class="bg-surface-50 dark:bg-surface-800">
                <tr>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Email</th>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Role</th>
                  <th class="text-left px-4 py-3 text-sm font-medium text-surface-500">Joined</th>
                  <th class="text-right px-4 py-3 text-sm font-medium text-surface-500">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-200 dark:divide-surface-700">
                {users.map(user => (
                  <tr key={user.userId} class="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                    <td class="px-4 py-3">
                      <span class="font-medium text-surface-900 dark:text-surface-100">
                        {user.email}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => handleChangeRole(user.userId, (e.target as HTMLSelectElement).value as 'org_admin' | 'org_member')}
                        class="input w-auto py-1 text-sm"
                      >
                        <option value="org_member">Member</option>
                        <option value="org_admin">Admin</option>
                      </select>
                    </td>
                    <td class="px-4 py-3 text-sm text-surface-500">
                      {new Date(user.joinedAt).toLocaleDateString()}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemoveUser(user.userId)}
                        class="text-red-600 hover:text-red-700 text-sm font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="card p-8 text-center">
            <p class="body-text">No users yet. Invite your first team member above!</p>
          </div>
        )}
      </div>
    </div>
  );
}
