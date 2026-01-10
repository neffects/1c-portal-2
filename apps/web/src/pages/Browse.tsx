/**
 * Browse Page
 * 
 * Lists entities of a specific type.
 */

import { useSync } from '../stores/sync';
import { EntityCard, EntityCardSkeleton } from '../components/EntityCard';

interface BrowsePageProps {
  typeSlug?: string;
}

export function BrowsePage({ typeSlug }: BrowsePageProps) {
  const { getEntityType, getBundle, syncing } = useSync();
  
  // Get entity type info
  const entityType = typeSlug ? getEntityType(typeSlug) : undefined;
  const bundle = entityType ? getBundle(entityType.id) : undefined;
  
  const entities = bundle?.entities || [];
  const isLoading = syncing.value && entities.length === 0;
  
  if (!typeSlug) {
    return (
      <div class="container-default py-12">
        <p class="body-text">No entity type specified.</p>
      </div>
    );
  }
  
  if (!entityType && !syncing.value) {
    return (
      <div class="container-default py-12">
        <div class="text-center py-16">
          <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
            <span class="i-lucide-search-x text-3xl text-surface-400"></span>
          </div>
          <h2 class="heading-3 mb-2">Not Found</h2>
          <p class="body-text mb-6">
            Entity type "{typeSlug}" doesn't exist or you don't have access.
          </p>
          <a href="/" class="btn-primary">
            Back to Home
          </a>
        </div>
      </div>
    );
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="mb-8">
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
          <a href="/" class="hover:text-surface-700 dark:hover:text-surface-200">Home</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">{entityType?.pluralName || typeSlug}</span>
        </nav>
        
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="heading-1 mb-2">{entityType?.pluralName || typeSlug}</h1>
            {entityType?.description && (
              <p class="body-text text-lg">{entityType.description}</p>
            )}
          </div>
          
          <div class="flex items-center gap-2 text-sm text-surface-500">
            {entities.length} {entities.length === 1 ? 'item' : 'items'}
          </div>
        </div>
      </div>
      
      {/* Search and filters - placeholder for future */}
      <div class="flex items-center gap-4 mb-6">
        <div class="flex-1 relative">
          <span class="i-lucide-search absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"></span>
          <input
            type="text"
            placeholder={`Search ${entityType?.pluralName || 'entities'}...`}
            class="input pl-10"
          />
        </div>
      </div>
      
      {/* Entity list */}
      {isLoading ? (
        <div class="space-y-4">
          {[...Array(5)].map((_, i) => (
            <EntityCardSkeleton key={i} />
          ))}
        </div>
      ) : entities.length > 0 ? (
        <div class="space-y-4">
          {entities.map((entity, index) => (
            <div key={entity.id} class={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
              <EntityCard
                entity={entity}
                typeSlug={typeSlug}
              />
            </div>
          ))}
        </div>
      ) : (
        <div class="text-center py-16">
          <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
            <span class="i-lucide-inbox text-3xl text-surface-400"></span>
          </div>
          <h3 class="heading-4 mb-2">No items yet</h3>
          <p class="body-text">
            {entityType?.pluralName || 'Items'} will appear here once they're published.
          </p>
        </div>
      )}
    </div>
  );
}
