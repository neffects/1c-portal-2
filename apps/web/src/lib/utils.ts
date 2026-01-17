/**
 * Utility Functions
 * 
 * Common helpers used across the frontend.
 */

import type { EntityBundle, BundleEntity } from '@1cc/shared';

/**
 * Format a date for display
 */
export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', options || {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format a date with time
 */
export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 7) {
    return formatDate(dateStr);
  } else if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generate initials from a name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Pluralize a word
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural || singular + 's');
}

/**
 * Generate a slug from text
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if running on mobile device
 */
export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Get query params from URL
 */
export function getQueryParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  
  params.forEach((value, key) => {
    result[key] = value;
  });
  
  return result;
}

/**
 * Set query params in URL
 */
export function setQueryParams(params: Record<string, string>): void {
  const url = new URL(window.location.href);
  
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });
  
  window.history.replaceState({}, '', url.toString());
}

/**
 * Duplicate check result for entity name/slug validation
 */
export interface DuplicateCheckResult {
  /** Entity with matching name (if any) */
  nameMatch?: BundleEntity;
  /** Entity with matching slug (if any) */
  slugMatch?: BundleEntity;
}

/**
 * Check for duplicate entities in a bundle by name or slug
 * 
 * Used for real-time validation in entity create/edit forms.
 * Checks against the org bundle which contains all entity statuses for admin users.
 * 
 * @param bundle - The entity bundle to search (typically org bundle for the entity type)
 * @param name - The entity name to check for duplicates
 * @param slug - The entity slug to check for duplicates
 * @param excludeId - Optional entity ID to exclude (for edit mode)
 * @returns Object with matching entities for name and slug (if found)
 */
export function checkDuplicatesInBundle(
  bundle: EntityBundle | undefined,
  name: string,
  slug: string,
  excludeId?: string
): DuplicateCheckResult {
  const result: DuplicateCheckResult = {};
  
  // Return empty result if no bundle or empty values
  if (!bundle || !bundle.entities || bundle.entities.length === 0) {
    console.log('[checkDuplicatesInBundle] No bundle or empty entities');
    return result;
  }
  
  // Normalize for comparison
  const normalizedName = name.trim().toLowerCase();
  const normalizedSlug = slug.trim().toLowerCase();
  
  // Skip if values are empty
  if (!normalizedName && !normalizedSlug) {
    return result;
  }
  
  console.log('[checkDuplicatesInBundle] Checking duplicates in bundle with', bundle.entities.length, 'entities');
  console.log('[checkDuplicatesInBundle] Looking for name:', normalizedName, 'slug:', normalizedSlug, 'excluding:', excludeId);
  
  for (const entity of bundle.entities) {
    // Skip the current entity when editing
    if (excludeId && entity.id === excludeId) {
      continue;
    }
    
    // Check name match (case-insensitive)
    if (normalizedName && !result.nameMatch) {
      const entityName = (entity.name || '').trim().toLowerCase();
      if (entityName === normalizedName) {
        console.log('[checkDuplicatesInBundle] Found name match:', entity.id, entityName);
        result.nameMatch = entity;
      }
    }
    
    // Check slug match (case-insensitive, though slugs should be lowercase)
    // Slug is stored at top-level (common property)
    if (normalizedSlug && !result.slugMatch) {
      const entitySlug = (entity.slug || '').trim().toLowerCase();
      if (entitySlug === normalizedSlug) {
        console.log('[checkDuplicatesInBundle] Found slug match:', entity.id, entitySlug);
        result.slugMatch = entity;
      }
    }
    
    // Early exit if both found
    if (result.nameMatch && result.slugMatch) {
      break;
    }
  }
  
  return result;
}
