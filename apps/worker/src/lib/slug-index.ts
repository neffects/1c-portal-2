/**
 * Slug Index Utilities
 * 
 * Manages slug-based indexes for fast entity lookups by slug chains.
 * Index format: stubs/slug-index/{orgId}-{typeSlug}-{entitySlug}.json
 */

import { R2_PATHS } from '@1cc/shared';
import { readJSON, writeJSON, deleteFile, fileExists } from './r2';
import type { AppAbility } from './abilities';
import type { VisibilityScope } from '@1cc/shared';

/**
 * Slug index entry mapping slug chain to entity metadata
 */
export interface SlugIndex {
  entityId: string;
  visibility: VisibilityScope;
  organizationId: string | null;
  entityTypeId: string;
}

/**
 * Get the R2 path for a slug index entry
 */
export function getSlugIndexPath(
  orgId: string | null,
  typeSlug: string,
  entitySlug: string
): string {
  // For global entities (null orgId), use a special prefix
  const orgPrefix = orgId || 'global';
  return `${R2_PATHS.STUBS}slug-index/${orgPrefix}-${typeSlug}-${entitySlug}.json`;
}

/**
 * Create or update a slug index entry
 */
export async function upsertSlugIndex(
  bucket: R2Bucket,
  orgId: string | null,
  typeSlug: string,
  entitySlug: string,
  index: SlugIndex,
  ability: AppAbility | null
): Promise<void> {
  const path = getSlugIndexPath(orgId, typeSlug, entitySlug);
  console.log('[SlugIndex] Upserting slug index:', path);
  await writeJSON(bucket, path, index, ability, undefined, 'update', 'Entity');
}

/**
 * Read a slug index entry
 */
export async function readSlugIndex(
  bucket: R2Bucket,
  orgId: string | null,
  typeSlug: string,
  entitySlug: string,
  ability: AppAbility | null
): Promise<SlugIndex | null> {
  const path = getSlugIndexPath(orgId, typeSlug, entitySlug);
  console.log('[SlugIndex] Reading slug index:', path);
  return await readJSON<SlugIndex>(bucket, path, ability, 'read', 'Entity');
}

/**
 * Delete a slug index entry
 */
export async function deleteSlugIndex(
  bucket: R2Bucket,
  orgId: string | null,
  typeSlug: string,
  entitySlug: string,
  ability: AppAbility | null
): Promise<void> {
  const path = getSlugIndexPath(orgId, typeSlug, entitySlug);
  console.log('[SlugIndex] Deleting slug index:', path);
  await deleteFile(bucket, path, ability, 'delete', 'Entity');
}

/**
 * Check if a slug index exists
 */
export async function slugIndexExists(
  bucket: R2Bucket,
  orgId: string | null,
  typeSlug: string,
  entitySlug: string,
  ability: AppAbility | null
): Promise<boolean> {
  const path = getSlugIndexPath(orgId, typeSlug, entitySlug);
  return await fileExists(bucket, path, ability);
}
