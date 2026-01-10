/**
 * Alerts Page
 * 
 * Shows user's flagged entities and alert preferences.
 */

import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../stores/auth';
import { useSync } from '../stores/sync';
import { api } from '../lib/api';
import { route } from 'preact-router';
import type { EntityFlag } from '@1cc/shared';

export function AlertsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { getEntity, getEntityType } = useSync();
  
  const [flags, setFlags] = useState<EntityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading.value && !isAuthenticated.value) {
      route('/login');
    }
  }, [authLoading.value, isAuthenticated.value]);
  
  // Load flagged entities
  useEffect(() => {
    if (isAuthenticated.value) {
      loadFlags();
    }
  }, [isAuthenticated.value]);
  
  async function loadFlags() {
    setLoading(true);
    setError(null);
    
    const response = await api.get('/api/users/me/flags') as { success: boolean; data?: { items: EntityFlag[] }; error?: { message: string } };
    
    if (response.success && response.data) {
      setFlags(response.data.items);
    } else {
      setError(response.error?.message || 'Failed to load alerts');
    }
    
    setLoading(false);
  }
  
  async function handleUnflag(entityId: string) {
    const response = await api.delete(`/api/users/me/flags/${entityId}`);
    
    if (response.success) {
      setFlags(flags.filter(f => f.entityId !== entityId));
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
      <div class="max-w-3xl mx-auto">
        {/* Header */}
        <div class="mb-8">
          <h1 class="heading-1 mb-2">Your Alerts</h1>
          <p class="body-text">
            Entities you're watching for updates. You'll receive notifications when they change.
          </p>
        </div>
        
        {/* Alert preferences */}
        <div class="card p-6 mb-8">
          <h2 class="heading-4 mb-4">Notification Settings</h2>
          
          <div class="space-y-4">
            <label class="flex items-center justify-between">
              <span class="text-surface-700 dark:text-surface-300">Email notifications</span>
              <input type="checkbox" defaultChecked class="w-5 h-5 rounded border-surface-300 text-primary-600 focus:ring-primary-500" />
            </label>
            
            <div class="flex items-center justify-between">
              <span class="text-surface-700 dark:text-surface-300">Digest frequency</span>
              <select class="input w-auto">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Flagged entities */}
        <div>
          <h2 class="heading-4 mb-4">Watched Entities ({flags.length})</h2>
          
          {loading ? (
            <div class="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} class="card p-4">
                  <div class="skeleton h-5 w-1/2 mb-2"></div>
                  <div class="skeleton h-4 w-1/4"></div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div class="card p-6 text-center">
              <span class="i-lucide-alert-circle text-3xl text-red-500 mb-2"></span>
              <p class="text-red-600 dark:text-red-400">{error}</p>
              <button onClick={loadFlags} class="btn-secondary mt-4">
                Try Again
              </button>
            </div>
          ) : flags.length > 0 ? (
            <div class="space-y-4">
              {flags.map(flag => {
                const entity = getEntity(flag.entityId);
                const entityType = getEntityType(flag.entityTypeId);
                const name = entity?.data?.name as string || `Entity ${flag.entityId}`;
                
                return (
                  <div key={flag.entityId} class="card p-4 flex items-center justify-between">
                    <div>
                      <a 
                        href={entity && entityType ? `/browse/${entityType.slug}/${entity.slug}` : '#'}
                        class="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        {name}
                      </a>
                      <div class="flex items-center gap-3 mt-1 text-sm text-surface-500 dark:text-surface-400">
                        <span>{entityType?.name || 'Unknown type'}</span>
                        <span>·</span>
                        <span>Flagged {new Date(flag.flaggedAt).toLocaleDateString()}</span>
                      </div>
                      {flag.note && (
                        <p class="mt-2 text-sm text-surface-600 dark:text-surface-400 italic">
                          {flag.note}
                        </p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => handleUnflag(flag.entityId)}
                      class="btn-ghost text-sm text-surface-500 hover:text-red-600"
                    >
                      <span class="i-lucide-bell-off mr-1"></span>
                      Unwatch
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div class="card p-8 text-center">
              <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
                <span class="i-lucide-bell text-3xl text-surface-400"></span>
              </div>
              <h3 class="heading-4 mb-2">No alerts yet</h3>
              <p class="body-text mb-6">
                When you watch an entity, you'll see it here and receive updates when it changes.
              </p>
              <a href="/" class="btn-primary">
                Browse Content
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
