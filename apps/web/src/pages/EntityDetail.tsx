/**
 * Entity Detail Page
 * 
 * Shows full details of a single entity.
 */

import { useSync } from '../stores/sync';
import { useAuth } from '../stores/auth';
import { api } from '../lib/api';
import { useState } from 'preact/hooks';

interface EntityDetailPageProps {
  orgSlug?: string;
  typeSlug?: string;
  entitySlug?: string;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Render field value based on type
 */
function FieldValue({ value, type }: { value: unknown; type?: string }) {
  if (value === null || value === undefined || value === '') {
    return <span class="text-surface-400 italic">Not specified</span>;
  }
  
  if (typeof value === 'boolean') {
    return value ? (
      <span class="text-green-600 dark:text-green-400">Yes</span>
    ) : (
      <span class="text-surface-500">No</span>
    );
  }
  
  if (Array.isArray(value)) {
    return (
      <div class="flex flex-wrap gap-2">
        {value.map((item, i) => (
          <span key={i} class="badge bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200">
            {String(item)}
          </span>
        ))}
      </div>
    );
  }
  
  if (type === 'markdown' && typeof value === 'string') {
    return (
      <div class="prose prose-sm dark:prose-invert max-w-none">
        {value}
      </div>
    );
  }
  
  if (typeof value === 'string' && value.startsWith('http')) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" class="text-primary-600 dark:text-primary-400 hover:underline break-all">
        {value}
      </a>
    );
  }
  
  return <span>{String(value)}</span>;
}

export function EntityDetailPage({ orgSlug, typeSlug, entitySlug }: EntityDetailPageProps) {
  const { getEntityType, getEntityBySlug, syncing } = useSync();
  const { isAuthenticated, user } = useAuth();
  
  const [flagged, setFlagged] = useState(false);
  const [flagLoading, setFlagLoading] = useState(false);
  
  // Get entity type and entity
  const entityType = typeSlug ? getEntityType(typeSlug) : undefined;
  const entity = entityType && entitySlug ? getEntityBySlug(entityType.id, entitySlug) : undefined;
  
  const isLoading = syncing.value && !entity;
  
  // Flag entity for alerts
  async function handleFlag() {
    if (!entity) return;
    
    setFlagLoading(true);
    
    const response = await api.post('/api/users/me/flags', {
      entityId: entity.id
    });
    
    if (response.success) {
      setFlagged(true);
    }
    
    setFlagLoading(false);
  }
  
  // Unflag entity
  async function handleUnflag() {
    if (!entity) return;
    
    setFlagLoading(true);
    
    const response = await api.delete(`/api/users/me/flags/${entity.id}`);
    
    if (response.success) {
      setFlagged(false);
    }
    
    setFlagLoading(false);
  }
  
  if (!typeSlug || !entitySlug) {
    return (
      <div class="container-default py-12">
        <p class="body-text">Entity not specified.</p>
      </div>
    );
  }
  
  if (!entity && !isLoading) {
    return (
      <div class="container-default py-12">
        <div class="text-center py-16">
          <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
            <span class="i-lucide-file-x text-3xl text-surface-400"></span>
          </div>
          <h2 class="heading-3 mb-2">Not Found</h2>
          <p class="body-text mb-6">
            This content doesn't exist or you don't have access.
          </p>
          <a href={`/browse/${typeSlug}`} class="btn-primary">
            Back to {entityType?.pluralName || 'List'}
          </a>
        </div>
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div class="container-default py-12">
        <div class="skeleton h-8 w-48 mb-4"></div>
        <div class="skeleton h-12 w-2/3 mb-6"></div>
        <div class="skeleton h-4 w-full mb-2"></div>
        <div class="skeleton h-4 w-full mb-2"></div>
        <div class="skeleton h-4 w-3/4"></div>
      </div>
    );
  }
  
  const name = (entity?.data.name as string) || `Entity ${entity?.id}`;
  const description = (entity?.data.description as string) || '';
  
  // Get other fields (excluding name and description)
  const otherFields = entity ? Object.entries(entity.data).filter(
    ([key]) => !['name', 'description'].includes(key)
  ) : [];
  
  return (
    <div class="container-default py-12">
      {/* Breadcrumb */}
      <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-6">
        <a href="/" class="hover:text-surface-700 dark:hover:text-surface-200">Home</a>
        <span class="i-lucide-chevron-right"></span>
        <a href={`/browse/${typeSlug}`} class="hover:text-surface-700 dark:hover:text-surface-200">
          {entityType?.pluralName || typeSlug}
        </a>
        <span class="i-lucide-chevron-right"></span>
        <span class="text-surface-900 dark:text-surface-100 truncate max-w-48">{name}</span>
      </nav>
      
      {/* Header */}
      <header class="mb-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="heading-1 mb-2">{name}</h1>
            
            <div class="flex items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
              <span class="flex items-center gap-1">
                <span class="i-lucide-calendar text-base"></span>
                Updated {entity ? formatDate(entity.updatedAt) : ''}
              </span>
              
              <span class="badge-published">
                {entity?.status}
              </span>
            </div>
          </div>
          
          {/* Actions */}
          <div class="flex items-center gap-2">
            {isAuthenticated.value && (
              <button
                onClick={flagged ? handleUnflag : handleFlag}
                disabled={flagLoading}
                class={flagged ? 'btn-primary' : 'btn-secondary'}
              >
                {flagLoading ? (
                  <span class="i-lucide-loader-2 animate-spin"></span>
                ) : flagged ? (
                  <>
                    <span class="i-lucide-bell-ring mr-2"></span>
                    Watching
                  </>
                ) : (
                  <>
                    <span class="i-lucide-bell mr-2"></span>
                    Watch for Updates
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>
      
      {/* Content */}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div class="lg:col-span-2">
          {description && (
            <div class="card p-6 mb-6">
              <h2 class="heading-4 mb-4">Description</h2>
              <div class="prose prose-sm dark:prose-invert max-w-none">
                {description}
              </div>
            </div>
          )}
          
          {otherFields.length > 0 && (
            <div class="card p-6">
              <h2 class="heading-4 mb-4">Details</h2>
              <dl class="space-y-4">
                {otherFields.map(([key, value]) => (
                  <div key={key}>
                    <dt class="text-sm font-medium text-surface-500 dark:text-surface-400 capitalize mb-1">
                      {key.replace(/_/g, ' ')}
                    </dt>
                    <dd class="text-surface-900 dark:text-surface-100">
                      <FieldValue value={value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
        
        {/* Sidebar */}
        <div class="lg:col-span-1">
          <div class="card p-6 sticky top-24">
            <h3 class="font-medium text-surface-900 dark:text-surface-100 mb-4">Information</h3>
            
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-surface-500 dark:text-surface-400">Type</dt>
                <dd class="text-surface-900 dark:text-surface-100">{entityType?.name}</dd>
              </div>
              
              <div class="flex justify-between">
                <dt class="text-surface-500 dark:text-surface-400">ID</dt>
                <dd class="text-surface-900 dark:text-surface-100 font-mono text-xs">{entity?.id}</dd>
              </div>
              
              <div class="flex justify-between">
                <dt class="text-surface-500 dark:text-surface-400">Version</dt>
                <dd class="text-surface-900 dark:text-surface-100">v{entity?.version}</dd>
              </div>
            </dl>
            
            <hr class="my-4 border-surface-200 dark:border-surface-700" />
            
            <div class="flex flex-col gap-2">
              <a href={`/browse/${typeSlug}`} class="btn-secondary w-full text-sm">
                <span class="i-lucide-arrow-left mr-2"></span>
                Back to List
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
