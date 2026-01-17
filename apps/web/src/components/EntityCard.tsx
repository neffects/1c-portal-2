/**
 * Entity Card Component
 * 
 * Displays an entity in card format for listings.
 */

import type { BundleEntity, EntityStatus } from '@1cc/shared';
import { clsx } from 'clsx';

interface EntityCardProps {
  entity: BundleEntity;
  typeSlug: string;
  showStatus?: boolean;
}

/**
 * Get status badge class
 */
function getStatusBadge(status: EntityStatus): string {
  const badges: Record<EntityStatus, string> = {
    draft: 'badge-draft',
    pending: 'badge-pending',
    published: 'badge-published',
    archived: 'badge-archived',
    deleted: 'badge-archived'
  };
  return badges[status] || 'badge-draft';
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Entity card for listings
 */
export function EntityCard({ entity, typeSlug, showStatus = false }: EntityCardProps) {
  // Name and slug are stored at top-level (common properties)
  const name = entity.name || `Entity ${entity.id}`;
  const description = (entity.data.description as string) || '';
  const entitySlug = entity.slug || '';
  
  return (
    <a
      href={`/browse/${typeSlug}/${entitySlug}`}
      class="card-hover p-5 block group"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          {/* Title */}
          <h3 class="font-semibold text-surface-900 dark:text-surface-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
            {name}
          </h3>
          
          {/* Description */}
          {description && (
            <p class="mt-1 text-sm text-surface-600 dark:text-surface-400 line-clamp-2">
              {description}
            </p>
          )}
          
          {/* Meta info */}
          <div class="mt-3 flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400">
            <span class="flex items-center gap-1">
              <span class="i-lucide-calendar text-sm"></span>
              {formatDate(entity.updatedAt)}
            </span>
            
            {showStatus && (
              <span class={getStatusBadge(entity.status)}>
                {entity.status}
              </span>
            )}
          </div>
        </div>
        
        {/* Arrow */}
        <span class="i-lucide-chevron-right text-xl text-surface-400 group-hover:text-primary-500 group-hover:translate-x-1 transition-all"></span>
      </div>
    </a>
  );
}

/**
 * Entity card skeleton for loading state
 */
export function EntityCardSkeleton() {
  return (
    <div class="card p-5">
      <div class="skeleton h-5 w-2/3 mb-2"></div>
      <div class="skeleton h-4 w-full mb-1"></div>
      <div class="skeleton h-4 w-4/5 mb-3"></div>
      <div class="skeleton h-3 w-24"></div>
    </div>
  );
}
