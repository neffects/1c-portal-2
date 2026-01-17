/**
 * Membership Keys Manager Page
 * 
 * Configure membership keys that control access levels and content visibility.
 * Organizations are assigned a membership key directly.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { MembershipKeyDefinition } from '@1cc/shared';

export function MembershipKeys() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Data state
  const [keys, setKeys] = useState<MembershipKeyDefinition[]>([]);
  
  // Key editing state
  const [editingKey, setEditingKey] = useState<MembershipKeyDefinition | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyFormData, setKeyFormData] = useState<Partial<MembershipKeyDefinition>>({
    id: '',
    name: '',
    description: '',
    requiresAuth: false,
    order: 0
  });
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load config on mount
  useEffect(() => {
    if (isSuperadmin.value) {
      loadConfig();
    }
  }, [isSuperadmin.value]);
  
  async function loadConfig() {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get('/api/super/config/membership-keys') as {
        success: boolean;
        data?: { keys: MembershipKeyDefinition[] };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        setKeys(response.data.keys);
      } else {
        setError(response.error?.message || 'Failed to load membership keys config');
      }
    } catch (err) {
      console.error('[MembershipKeys] Error loading config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load membership keys config');
    } finally {
      setLoading(false);
    }
  }
  
  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      // Validate before saving
      if (keys.length === 0) {
        throw new Error('At least one membership key is required');
      }
      
      // Check for duplicate IDs
      const keyIds = keys.map(k => k.id);
      if (new Set(keyIds).size !== keyIds.length) {
        throw new Error('Duplicate membership key IDs found');
      }
      
      // Store the keys we're saving for verification
      const keysToSave = keys;
      
      const response = await api.patch('/api/super/config/membership-keys', {
        keys: keysToSave
      }) as {
        success: boolean;
        data?: { keys: MembershipKeyDefinition[]; warnings?: string[] };
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        // Wait a moment for cache to clear on the server
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Fetch the updated config and verify it matches what we saved
        let configReloaded = false;
        let retries = 0;
        const maxRetries = 5;
        
        while (!configReloaded && retries < maxRetries) {
          try {
            await loadConfig();
            
            // Verify the config was actually updated by comparing key IDs
            const savedKeyIds = keysToSave.map(k => k.id).sort().join(',');
            const loadedKeyIds = keys.map(k => k.id).sort().join(',');
            
            if (savedKeyIds === loadedKeyIds) {
              // Verify key details match (at least check a couple of keys)
              let keysMatch = true;
              for (const savedKey of keysToSave.slice(0, Math.min(3, keysToSave.length))) {
                const loadedKey = keys.find(k => k.id === savedKey.id);
                if (!loadedKey || loadedKey.name !== savedKey.name || loadedKey.order !== savedKey.order) {
                  keysMatch = false;
                  break;
                }
              }
              
              if (keysMatch) {
                configReloaded = true;
                console.log('[MembershipKeys] Config reloaded and verified after', retries + 1, 'attempt(s)');
              }
            }
            
            if (!configReloaded) {
              retries++;
              if (retries < maxRetries) {
                console.log('[MembershipKeys] Config not yet updated, retrying...', retries);
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          } catch (loadError) {
            console.error('[MembershipKeys] Error reloading config:', loadError);
            retries++;
            if (retries < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 500));
            } else {
              throw new Error('Failed to reload config after save. Please refresh the page to see changes.');
            }
          }
        }
        
        if (!configReloaded) {
          throw new Error('Config reload verification failed. The changes may not be visible yet. Please refresh the page.');
        }
        
        // Show warnings if any
        if (response.data.warnings && response.data.warnings.length > 0) {
          setError(response.data.warnings.join(' '));
        } else {
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } else {
        throw new Error(response.error?.message || 'Failed to save membership keys config');
      }
    } catch (err) {
      console.error('[MembershipKeys] Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save membership keys config');
    } finally {
      setSaving(false);
    }
  }
  
  function openKeyModal(key?: MembershipKeyDefinition) {
    if (key) {
      setEditingKey(key);
      setKeyFormData({ ...key });
    } else {
      setEditingKey(null);
      setKeyFormData({
        id: '',
        name: '',
        description: '',
        requiresAuth: false,
        order: keys.length > 0 ? Math.max(...keys.map(k => k.order)) + 1 : 0
      });
    }
    setShowKeyModal(true);
  }
  
  function saveKey() {
    if (!keyFormData.id || !keyFormData.name || keyFormData.order === undefined) {
      setError('ID, name, and order are required');
      return;
    }
    
    // Validate ID format
    if (!/^[a-z0-9_]+$/.test(keyFormData.id)) {
      setError('Key ID must be lowercase letters, numbers, and underscores only');
      return;
    }
    
    // Check for duplicate ID (unless editing the same key)
    if (keys.some(k => k.id === keyFormData.id && k.id !== editingKey?.id)) {
      setError(`Key ID '${keyFormData.id}' already exists`);
      return;
    }
    
    const newKeys = [...keys];
    if (editingKey) {
      // Update existing
      const index = newKeys.findIndex(k => k.id === editingKey.id);
      if (index !== -1) {
        newKeys[index] = keyFormData as MembershipKeyDefinition;
      }
    } else {
      // Add new
      newKeys.push(keyFormData as MembershipKeyDefinition);
    }
    
    // Sort by order
    newKeys.sort((a, b) => a.order - b.order);
    setKeys(newKeys);
    setShowKeyModal(false);
    setError(null);
  }
  
  function deleteKey(keyId: string) {
    // Prevent deletion of 'public' key - it must always be present
    if (keyId === 'public') {
      setError('The "public" membership key cannot be deleted. It must always be present.');
      return;
    }
    
    if (!confirm(`Delete membership key '${keyId}'? This may affect organizations and entity types using this key.`)) {
      return;
    }
    
    setKeys(keys.filter(k => k.id !== keyId));
  }
  
  if (authLoading.value || loading) {
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
            <span class="text-surface-900 dark:text-surface-100">Membership Keys</span>
          </nav>
          <h1 class="heading-1 mb-2">Membership Keys</h1>
          <p class="body-text">Manage access levels that control content visibility. Organizations are assigned a membership key directly.</p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          class="btn-primary"
        >
          {saving ? (
            <>
              <span class="i-lucide-loader-2 animate-spin mr-2"></span>
              Saving...
            </>
          ) : (
            <>
              <span class="i-lucide-save mr-2"></span>
              Save Changes
            </>
          )}
        </button>
      </div>
      
      {/* Success message */}
      {success && (
        <div class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
          Membership keys configuration saved successfully!
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      
      {/* Membership Keys Section */}
      <div class="card p-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="heading-3">Membership Keys</h2>
            <button
              onClick={() => openKeyModal()}
              class="btn-secondary text-sm"
            >
              <span class="i-lucide-plus mr-1"></span>
              Add Key
            </button>
          </div>
          
          {keys.length === 0 ? (
            <p class="text-sm text-surface-500 py-4">No membership keys defined. Add your first key to get started.</p>
          ) : (
            <div class="space-y-3">
              {keys.map(key => (
                <div key={key.id} class="p-4 border border-surface-200 dark:border-surface-700 rounded-lg">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <code class="text-sm font-mono bg-surface-100 dark:bg-surface-800 px-2 py-1 rounded">
                          {key.id}
                        </code>
                        <span class="font-semibold text-surface-900 dark:text-surface-100">{key.name}</span>
                        {key.requiresAuth && (
                          <span class="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                            Requires Auth
                          </span>
                        )}
                      </div>
                      {key.description && (
                        <p class="text-sm text-surface-600 dark:text-surface-400 mb-2">{key.description}</p>
                      )}
                      <p class="text-xs text-surface-500">Order: {key.order}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        onClick={() => openKeyModal(key)}
                        class="text-primary-600 hover:text-primary-700 text-sm"
                      >
                        Edit
                      </button>
                      {key.id !== 'public' && (
                        <button
                          onClick={() => deleteKey(key.id)}
                          class="text-red-600 hover:text-red-700 text-sm"
                        >
                          Delete
                        </button>
                      )}
                      {key.id === 'public' && (
                        <span class="text-xs text-surface-400 italic">Cannot delete (always required)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      
      {/* Key Modal */}
      {showKeyModal && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div class="bg-white dark:bg-surface-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 class="heading-3 mb-4">{editingKey ? 'Edit' : 'Add'} Membership Key</h3>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-semibold mb-2">ID</label>
                <input
                  type="text"
                  value={keyFormData.id || ''}
                  onInput={(e) => setKeyFormData({ ...keyFormData, id: (e.target as HTMLInputElement).value.toLowerCase() })}
                  class="input-default w-full"
                  placeholder="public"
                  disabled={!!editingKey}
                />
                <p class="text-xs text-surface-500 mt-1">Lowercase letters, numbers, and underscores only</p>
              </div>
              
              <div>
                <label class="block text-sm font-semibold mb-2">Name</label>
                <input
                  type="text"
                  value={keyFormData.name || ''}
                  onInput={(e) => setKeyFormData({ ...keyFormData, name: (e.target as HTMLInputElement).value })}
                  class="input-default w-full"
                  placeholder="Public Access"
                />
              </div>
              
              <div>
                <label class="block text-sm font-semibold mb-2">Description</label>
                <textarea
                  value={keyFormData.description || ''}
                  onInput={(e) => setKeyFormData({ ...keyFormData, description: (e.target as HTMLInputElement).value })}
                  class="input-default w-full"
                  rows={3}
                  placeholder="Accessible to everyone without authentication"
                />
              </div>
              
              <div>
                <label class="block text-sm font-semibold mb-2">Order</label>
                <input
                  type="number"
                  value={keyFormData.order || 0}
                  onInput={(e) => setKeyFormData({ ...keyFormData, order: parseInt((e.target as HTMLInputElement).value) || 0 })}
                  class="input-default w-full"
                  min="0"
                />
                <p class="text-xs text-surface-500 mt-1">Used for hierarchy (higher = more access)</p>
              </div>
              
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="requiresAuth"
                  checked={keyFormData.requiresAuth || false}
                  onChange={(e) => setKeyFormData({ ...keyFormData, requiresAuth: (e.target as HTMLInputElement).checked })}
                  class="rounded"
                />
                <label for="requiresAuth" class="text-sm">Requires Authentication</label>
              </div>
            </div>
            
            <div class="flex items-center gap-3 mt-6">
              <button
                onClick={saveKey}
                class="btn-primary flex-1"
              >
                {editingKey ? 'Update' : 'Add'} Key
              </button>
              <button
                onClick={() => {
                  setShowKeyModal(false);
                  setError(null);
                }}
                class="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
