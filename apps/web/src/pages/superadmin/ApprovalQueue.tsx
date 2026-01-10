/**
 * Approval Queue Page
 * 
 * Review and approve/reject pending content.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem } from '@1cc/shared';

export function ApprovalQueue() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [pendingEntities, setPendingEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load pending entities
  useEffect(() => {
    if (isSuperadmin.value) {
      loadPending();
    }
  }, [isSuperadmin.value]);
  
  async function loadPending() {
    setLoading(true);
    const response = await api.get('/api/entities?status=pending') as { success: boolean; data?: { items: EntityListItem[] } };
    
    if (response.success && response.data) {
      setPendingEntities(response.data.items);
    }
    setLoading(false);
  }
  
  async function handleApprove(entityId: string) {
    setProcessingId(entityId);
    
    const response = await api.post(`/api/entities/${entityId}/transition`, {
      action: 'approve'
    });
    
    if (response.success) {
      setPendingEntities(pendingEntities.filter(e => e.id !== entityId));
    }
    
    setProcessingId(null);
  }
  
  async function handleReject(entityId: string) {
    const feedback = prompt('Rejection reason (optional):');
    
    setProcessingId(entityId);
    
    const response = await api.post(`/api/entities/${entityId}/transition`, {
      action: 'reject',
      feedback
    });
    
    if (response.success) {
      setPendingEntities(pendingEntities.filter(e => e.id !== entityId));
    }
    
    setProcessingId(null);
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
          <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">Approval Queue</span>
        </nav>
        <div class="flex items-center justify-between">
          <h1 class="heading-1">Approval Queue</h1>
          <span class="badge-pending text-base px-3 py-1">
            {pendingEntities.length} pending
          </span>
        </div>
      </div>
      
      {/* Queue */}
      {loading ? (
        <div class="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} class="card p-6">
              <div class="skeleton h-6 w-1/2 mb-2"></div>
              <div class="skeleton h-4 w-3/4 mb-4"></div>
              <div class="skeleton h-4 w-1/4"></div>
            </div>
          ))}
        </div>
      ) : pendingEntities.length > 0 ? (
        <div class="space-y-4">
          {pendingEntities.map(entity => (
            <div key={entity.id} class="card p-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <h3 class="font-semibold text-lg text-surface-900 dark:text-surface-100 mb-1">
                    {(entity.data.name as string) || `Entity ${entity.id}`}
                  </h3>
                  
                  {entity.data.description && (
                    <p class="text-surface-600 dark:text-surface-400 mb-3 line-clamp-2">
                      {entity.data.description as string}
                    </p>
                  )}
                  
                  <div class="flex items-center gap-4 text-sm text-surface-500">
                    <span>ID: {entity.id}</span>
                    <span>·</span>
                    <span>v{entity.version}</span>
                    <span>·</span>
                    <span>Updated {new Date(entity.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                
                <div class="flex items-center gap-3">
                  {processingId === entity.id ? (
                    <span class="i-lucide-loader-2 animate-spin text-xl text-surface-400"></span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleReject(entity.id)}
                        class="btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        disabled={processingId !== null}
                      >
                        <span class="i-lucide-x mr-1"></span>
                        Reject
                      </button>
                      <button
                        onClick={() => handleApprove(entity.id)}
                        class="btn-primary bg-green-600 hover:bg-green-700"
                        disabled={processingId !== null}
                      >
                        <span class="i-lucide-check mr-1"></span>
                        Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="card p-8 text-center">
          <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <span class="i-lucide-check-circle text-3xl text-green-600 dark:text-green-400"></span>
          </div>
          <h3 class="heading-4 mb-2">All caught up!</h3>
          <p class="body-text">
            No pending content to review. Check back later.
          </p>
        </div>
      )}
    </div>
  );
}
