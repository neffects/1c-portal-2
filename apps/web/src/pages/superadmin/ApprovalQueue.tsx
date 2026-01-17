/**
 * Approval Queue Page
 * 
 * Review and approve/reject pending content.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityListItem, OrganizationListItem } from '@1cc/shared';

export function ApprovalQueue() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [pendingEntities, setPendingEntities] = useState<EntityListItem[]>([]);
  const [organizations, setOrganizations] = useState<Map<string, OrganizationListItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionFeedback, setRejectionFeedback] = useState<string>('');
  
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
    
    // Fetch pending entities
    const entitiesResponse = await api.get('/api/entities?status=pending') as { success: boolean; data?: { items: EntityListItem[] } };
    
    if (entitiesResponse.success && entitiesResponse.data) {
      setPendingEntities(entitiesResponse.data.items);
      
      // Fetch organizations for the entities
      const orgsResponse = await api.get('/api/organizations') as { success: boolean; data?: { items: OrganizationListItem[] } };
      
      if (orgsResponse.success && orgsResponse.data) {
        const orgMap = new Map<string, OrganizationListItem>();
        orgsResponse.data.items.forEach(org => {
          orgMap.set(org.id, org);
        });
        setOrganizations(orgMap);
      }
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
  
  function handleRejectClick(entityId: string) {
    setRejectingId(entityId);
    setRejectionFeedback('');
  }
  
  function handleRejectCancel() {
    setRejectingId(null);
    setRejectionFeedback('');
  }
  
  async function handleRejectConfirm() {
    if (!rejectingId) return;
    
    const entityId = rejectingId;
    setProcessingId(entityId);
    setRejectingId(null);
    
    const response = await api.post(`/api/entities/${entityId}/transition`, {
      action: 'reject',
      feedback: rejectionFeedback || undefined
    });
    
    if (response.success) {
      setPendingEntities(pendingEntities.filter(e => e.id !== entityId));
    }
    
    setRejectionFeedback('');
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
          {pendingEntities.map(entity => {
            const org = organizations.get(entity.organizationId);
            
            return (
              <div key={entity.id} class="card p-6">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex-1">
                    <h3 class="font-semibold text-lg text-surface-900 dark:text-surface-100 mb-1">
                      {entity.name || `Entity ${entity.id}`}
                    </h3>
                    
                    {entity.data.description && (
                      <p class="text-surface-600 dark:text-surface-400 mb-3 line-clamp-2">
                        {entity.data.description as string}
                      </p>
                    )}
                    
                    <div class="flex items-center gap-4 text-sm text-surface-500">
                      {org && (
                        <>
                          <span class="font-medium text-surface-700 dark:text-surface-300">{org.name}</span>
                          <span>·</span>
                        </>
                      )}
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
                          onClick={() => handleRejectClick(entity.id)}
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
            );
          })}
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
      
      {/* Rejection Modal */}
      {rejectingId && (
        <div 
          class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in" 
          onClick={handleRejectCancel}
        >
          <div 
            class="bg-white dark:bg-surface-800 rounded-xl shadow-2xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div class="p-6 border-b border-surface-200 dark:border-surface-700">
              <h2 class="heading-3">Reject Entity</h2>
              <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
                Please provide an optional reason for rejection
              </p>
            </div>
            
            {/* Content */}
            <div class="p-6">
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Rejection Reason (optional)
              </label>
              <textarea
                value={rejectionFeedback}
                onInput={(e) => setRejectionFeedback((e.target as HTMLTextAreaElement).value)}
                placeholder="Enter reason for rejection..."
                class="input w-full min-h-[100px] resize-y"
                autofocus
              />
            </div>
            
            {/* Footer */}
            <div class="p-6 border-t border-surface-200 dark:border-surface-700 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleRejectCancel}
                class="btn-secondary"
                disabled={processingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                class="btn-primary bg-red-600 hover:bg-red-700"
                disabled={processingId !== null}
              >
                <span class="i-lucide-x mr-2"></span>
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
