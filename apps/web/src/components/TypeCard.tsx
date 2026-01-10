/**
 * Entity Type Card Component
 * 
 * Displays an entity type in card format for the homepage.
 */

import type { ManifestEntityType } from '@1cc/shared';

interface TypeCardProps {
  type: ManifestEntityType;
}

/**
 * Get icon for entity type based on name
 */
function getTypeIcon(name: string): string {
  const iconMap: Record<string, string> = {
    tools: 'i-lucide-wrench',
    services: 'i-lucide-briefcase',
    products: 'i-lucide-package',
    articles: 'i-lucide-newspaper',
    projects: 'i-lucide-folder',
    events: 'i-lucide-calendar',
    people: 'i-lucide-users',
    locations: 'i-lucide-map-pin',
    default: 'i-lucide-box'
  };
  
  const key = name.toLowerCase();
  return iconMap[key] || iconMap.default;
}

/**
 * Entity type card for homepage
 */
export function TypeCard({ type }: TypeCardProps) {
  return (
    <a
      href={`/browse/${type.slug}`}
      class="card-hover p-6 block group relative overflow-hidden"
    >
      {/* Background decoration */}
      <div class="absolute top-0 right-0 w-24 h-24 bg-primary-500/10 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500"></div>
      
      <div class="relative">
        {/* Icon */}
        <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <span class={`${getTypeIcon(type.pluralName)} text-2xl text-primary-600 dark:text-primary-400`}></span>
        </div>
        
        {/* Title */}
        <h3 class="font-semibold text-lg text-surface-900 dark:text-surface-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {type.pluralName}
        </h3>
        
        {/* Description */}
        {type.description && (
          <p class="mt-1 text-sm text-surface-600 dark:text-surface-400 line-clamp-2">
            {type.description}
          </p>
        )}
        
        {/* Count */}
        <div class="mt-4 flex items-center justify-between">
          <span class="text-sm text-surface-500 dark:text-surface-400">
            {type.entityCount} {type.entityCount === 1 ? 'item' : 'items'}
          </span>
          
          <span class="i-lucide-arrow-right text-primary-500 group-hover:translate-x-1 transition-transform"></span>
        </div>
      </div>
    </a>
  );
}

/**
 * Type card skeleton for loading state
 */
export function TypeCardSkeleton() {
  return (
    <div class="card p-6">
      <div class="skeleton w-12 h-12 rounded-xl mb-4"></div>
      <div class="skeleton h-6 w-1/2 mb-2"></div>
      <div class="skeleton h-4 w-full mb-1"></div>
      <div class="skeleton h-4 w-3/4 mb-4"></div>
      <div class="skeleton h-4 w-20"></div>
    </div>
  );
}
