/**
 * R2 Storage Utilities
 * 
 * Helper functions for reading and writing JSON files to Cloudflare R2.
 * Handles serialization, error handling, and path management.
 */

import { R2_PATHS } from '@1cc/shared';

/**
 * Read a JSON file from R2
 */
export async function readJSON<T>(
  bucket: R2Bucket,
  path: string
): Promise<T | null> {
  console.log('[R2] Reading:', path);
  
  try {
    const object = await bucket.get(path);
    
    if (!object) {
      console.log('[R2] File not found:', path);
      return null;
    }
    
    const text = await object.text();
    const data = JSON.parse(text) as T;
    
    console.log('[R2] Read successful:', path);
    return data;
    
  } catch (error) {
    console.error('[R2] Read error:', path, error);
    throw error;
  }
}

/**
 * Write a JSON file to R2
 */
export async function writeJSON<T>(
  bucket: R2Bucket,
  path: string,
  data: T,
  metadata?: Record<string, string>
): Promise<void> {
  console.log('[R2] Writing:', path);
  
  try {
    const json = JSON.stringify(data, null, 2);
    
    await bucket.put(path, json, {
      httpMetadata: {
        contentType: 'application/json'
      },
      customMetadata: metadata
    });
    
    console.log('[R2] Write successful:', path);
    
  } catch (error) {
    console.error('[R2] Write error:', path, error);
    throw error;
  }
}

/**
 * Delete a file from R2
 */
export async function deleteFile(
  bucket: R2Bucket,
  path: string
): Promise<void> {
  console.log('[R2] Deleting:', path);
  
  try {
    await bucket.delete(path);
    console.log('[R2] Delete successful:', path);
  } catch (error) {
    console.error('[R2] Delete error:', path, error);
    throw error;
  }
}

/**
 * Check if a file exists in R2
 */
export async function fileExists(
  bucket: R2Bucket,
  path: string
): Promise<boolean> {
  const object = await bucket.head(path);
  return object !== null;
}

/**
 * List files in a directory
 */
export async function listFiles(
  bucket: R2Bucket,
  prefix: string,
  limit: number = 1000
): Promise<string[]> {
  console.log('[R2] Listing:', prefix);
  
  const listed = await bucket.list({
    prefix,
    limit
  });
  
  const paths = listed.objects.map(obj => obj.key);
  console.log('[R2] Found', paths.length, 'files');
  
  return paths;
}

/**
 * List files with pagination
 */
export async function listFilesPaginated(
  bucket: R2Bucket,
  prefix: string,
  options: {
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{
  files: string[];
  cursor?: string;
  hasMore: boolean;
}> {
  const { limit = 100, cursor } = options;
  
  const listed = await bucket.list({
    prefix,
    limit,
    cursor
  });
  
  return {
    files: listed.objects.map(obj => obj.key),
    cursor: listed.truncated ? listed.cursor : undefined,
    hasMore: listed.truncated
  };
}

// Path builders for different storage locations

/**
 * Visibility scope type (user-facing values)
 * Maps to R2 storage prefixes:
 * - 'public' -> R2_PATHS.PUBLIC (public/)
 * - 'authenticated' -> R2_PATHS.PLATFORM (platform/)
 * - 'members' -> R2_PATHS.PRIVATE (private/)
 */
type VisibilityScope = 'public' | 'authenticated' | 'members';

/**
 * Get R2 path prefix for a visibility scope
 */
function getVisibilityPrefix(visibility: VisibilityScope): string {
  switch (visibility) {
    case 'public':
      return R2_PATHS.PUBLIC;
    case 'authenticated':
      return R2_PATHS.PLATFORM;
    case 'members':
      return R2_PATHS.PRIVATE;
    default:
      return R2_PATHS.PLATFORM;
  }
}

/**
 * Check if visibility scope is organization-specific (members only)
 */
function isOrgSpecificVisibility(visibility: VisibilityScope): boolean {
  return visibility === 'members';
}

/**
 * Get path for entity version file
 */
export function getEntityVersionPath(
  visibility: VisibilityScope,
  entityId: string,
  version: number,
  orgId?: string
): string {
  if (isOrgSpecificVisibility(visibility) && orgId) {
    return `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/${entityId}/v${version}.json`;
  }
  const prefix = getVisibilityPrefix(visibility);
  return `${prefix}entities/${entityId}/v${version}.json`;
}

/**
 * Get path for entity latest pointer
 */
export function getEntityLatestPath(
  visibility: VisibilityScope,
  entityId: string,
  orgId?: string
): string {
  if (isOrgSpecificVisibility(visibility) && orgId) {
    return `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/${entityId}/latest.json`;
  }
  const prefix = getVisibilityPrefix(visibility);
  return `${prefix}entities/${entityId}/latest.json`;
}

/**
 * Get path for entity stub
 */
export function getEntityStubPath(entityId: string): string {
  return `${R2_PATHS.STUBS}${entityId}.json`;
}

/**
 * Get path for entity type definition
 */
export function getEntityTypePath(typeId: string): string {
  return `${R2_PATHS.PUBLIC}entity-types/${typeId}/definition.json`;
}

/**
 * Get path for organization profile
 */
export function getOrgProfilePath(orgId: string): string {
  return `${R2_PATHS.PRIVATE}orgs/${orgId}/profile.json`;
}

/**
 * Get path for organization entity type permissions
 */
export function getOrgPermissionsPath(orgId: string): string {
  return `${R2_PATHS.PRIVATE}policies/organizations/${orgId}/entity-type-permissions.json`;
}

/**
 * Get path for user membership in org
 */
export function getUserMembershipPath(orgId: string, userId: string): string {
  return `${R2_PATHS.PRIVATE}orgs/${orgId}/users/${userId}.json`;
}

/**
 * Get path for site manifest
 */
export function getManifestPath(
  visibility: VisibilityScope,
  orgId?: string
): string {
  if (isOrgSpecificVisibility(visibility) && orgId) {
    return `${R2_PATHS.PRIVATE}orgs/${orgId}/manifests/site.json`;
  }
  const prefix = getVisibilityPrefix(visibility);
  return `${prefix}manifests/site.json`;
}

/**
 * Get path for entity bundle
 */
export function getBundlePath(
  visibility: VisibilityScope,
  typeId: string,
  orgId?: string
): string {
  if (isOrgSpecificVisibility(visibility) && orgId) {
    return `${R2_PATHS.PRIVATE}orgs/${orgId}/bundles/${typeId}.json`;
  }
  const prefix = getVisibilityPrefix(visibility);
  return `${prefix}bundles/${typeId}.json`;
}

/**
 * Get path for app config
 */
export function getAppConfigPath(): string {
  return `${R2_PATHS.CONFIG}app.json`;
}

/**
 * Get path for root config
 */
export function getRootConfigPath(): string {
  return `${R2_PATHS.SECRET}ROOT.json`;
}

/**
 * Get path for magic link token
 */
export function getMagicLinkPath(token: string): string {
  return `${R2_PATHS.PRIVATE}magic-links/${token}.json`;
}

/**
 * Get path for user invitation
 */
export function getInvitationPath(token: string): string {
  return `${R2_PATHS.PRIVATE}invitations/${token}.json`;
}

/**
 * Get path for user flags
 */
export function getUserFlagsPath(userId: string, entityId: string): string {
  return `${R2_PATHS.PRIVATE}users/${userId}/flags/${entityId}.json`;
}

/**
 * Get path for user preferences
 */
export function getUserPreferencesPath(userId: string): string {
  return `${R2_PATHS.PRIVATE}users/${userId}/preferences.json`;
}
