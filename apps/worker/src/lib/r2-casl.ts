/**
 * CASL-Aware R2 Operations
 * 
 * All R2 access should go through these functions to ensure CASL enforcement.
 * These functions verify permissions before performing R2 operations based on path patterns.
 * 
 * SECURITY: This is the ONLY way to access R2 - direct bucket.get/put/delete calls are forbidden.
 */

import type { AppAbility } from './abilities';
import type { Actions, Subjects } from './abilities';
import { ForbiddenError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import { invalidateBundlesForFile } from './bundle-invalidation';

/**
 * Map R2 path to subject/action for CASL verification
 * 
 * Path patterns:
 * - entities/ and stubs/ paths: Entity subject
 * - entity-types/ paths: EntityType subject
 * - orgs/.../profile.json paths: Organization subject
 * - orgs/.../users/... paths: User subject
 * - bundles/ paths: Platform subject for writes, Entity subject for reads
 * - manifests/ paths: Platform subject
 * - config/ and secret/ paths: Platform subject (system config)
 * - public/ paths (non-bundle): null for special handling
 */
function pathToPermission(path: string, operation: 'read' | 'write' | 'delete'): { action: Actions; subject: Subjects } | null {
  // Entity type operations (check before public path check - entity types in public/ still need CASL for writes)
  if (path.includes('/entity-types/')) {
    return { action: operation as Actions, subject: 'EntityType' };
  }
  
  // Entity operations
  if (path.includes('/entities/') || path.startsWith('stubs/')) {
    return { action: operation as Actions, subject: 'Entity' };
  }
  
  // Bundle/Manifest operations - CHECK BEFORE PUBLIC PATHS
  // Bundles are internal platform files, not public content
  // This must come before the public/ check to correctly handle bundles/public/* paths
  if (path.startsWith('bundles/') || path.includes('/bundles/') || path.includes('/manifests/')) {
    // For write/delete operations on bundles/manifests, use Platform subject
    // For read operations, bundles contain entities so use Entity subject
    if (operation === 'write' || operation === 'delete') {
      return { action: operation as Actions, subject: 'Platform' };
    }
    return { action: 'read', subject: 'Entity' }; // Bundles contain entities for reads
  }
  
  // Public/config/secret paths that don't require CASL (return null for special handling)
  // Note: Entity types and bundles are checked above, so they're excluded from this
  if (path.startsWith('public/') ||
      path.startsWith('config/') ||
      path.startsWith('secret/')) {
    return null;
  }
  
  // Organization operations
  if (path.includes('/orgs/') && (path.includes('/profile.json') || path.includes('/entity-type-permissions.json'))) {
    return { action: operation as Actions, subject: 'Organization' };
  }
  
  // Organization permissions (policies path)
  if (path.includes('/policies/organizations/') && path.includes('/entity-type-permissions.json')) {
    return { action: operation as Actions, subject: 'Organization' };
  }
  
  // User operations (org membership, preferences, flags)
  if (path.includes('/users/') || path.includes('/magic-links/') || path.includes('/invitations/')) {
    return { action: operation as Actions, subject: 'User' };
  }
  
  // File upload operations (uploads/ prefix)
  if (path.startsWith('uploads/')) {
    return { action: operation as Actions, subject: 'Platform' };
  }
  
  // Default: Platform level
  return { action: operation as Actions, subject: 'Platform' };
}

/**
 * Check if a path is public (doesn't require ability check for reads)
 * Note: bundles/ are internal platform files and require Platform permission for writes
 */
function isPublicPath(path: string): boolean {
  // Bundles are internal platform files, NOT public content - they require Platform permission
  if (path.startsWith('bundles/')) {
    return false;
  }
  return path.startsWith('public/') ||
         path.startsWith('config/') ||
         path.startsWith('secret/');
}

/**
 * Check if a path is system/config (doesn't require user ability but is protected)
 */
function isSystemPath(path: string): boolean {
  return path.startsWith('config/') || path.startsWith('secret/');
}

/**
 * Check if a path is used for authentication flows (user lookup, domain whitelist checks)
 * These paths can be accessed without ability during authentication (but only for specific operations)
 */
function isAuthPath(path: string): boolean {
  // Allow listing orgs directory and reading org profiles for user lookup
  if (path.startsWith('private/orgs/')) {
    // Allow listing org directories
    if (path === 'private/orgs/' || path.match(/^private\/orgs\/[^\/]+\/$/)) {
      return true;
    }
    // Allow reading org profiles during domain whitelist checks
    if (path.match(/^private\/orgs\/[^\/]+\/profile\.json$/)) {
      return true;
    }
    // Allow listing users directory within an org for user lookup
    if (path.match(/^private\/orgs\/[^\/]+\/users\/$/)) {
      return true;
    }
    // Allow reading user membership files during user lookup
    if (path.match(/^private\/orgs\/[^\/]+\/users\/[^\/]+\.json$/)) {
      return true;
    }
  }
  // Allow reading magic links and invitations (auth tokens)
  if (path.startsWith('private/magic-links/') || path.startsWith('private/invitations/')) {
    return true;
  }
  // Allow writing pending users during signup
  if (path.startsWith('private/pending-users/')) {
    return true;
  }
  // Allow reading user-org stubs during authentication (to list user's organizations)
  if (path.startsWith('private/user-stubs/')) {
    return true;
  }
  return false;
}


/**
 * Check if a path should trigger bundle invalidation
 * Returns true for entity files, entity stubs, entity types, org profiles, and org permissions
 */
function shouldInvalidateBundles(path: string): boolean {
  // Entity files: entities/{entityId}/v{version}.json or latest.json
  if (path.includes('/entities/') && (path.includes('/v') || path.includes('/latest.json'))) {
    return true;
  }
  
  // Entity stubs
  if (path.match(/^stubs\/[^\/]+\.json$/)) {
    return true;
  }
  
  // Entity type definitions
  if (path.match(/entity-types\/[^\/]+\/definition\.json$/)) {
    return true;
  }
  
  // Organization profiles
  if (path.match(/orgs\/[^\/]+\/profile\.json$/)) {
    return true;
  }
  
  // Organization permissions
  if (path.match(/policies\/organizations\/[^\/]+\/entity-type-permissions\.json$/)) {
    return true;
  }
  
  return false;
}

/**
 * Read JSON with CASL permission check
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to read
 * @param ability - User's CASL ability (required for protected paths, optional for public)
 * @param requiredAction - Optional explicit action to check (overrides path inference)
 * @param requiredSubject - Optional explicit subject to check (overrides path inference)
 * @returns JSON data or null if not found
 * @throws ForbiddenError if permission denied
 */
export async function readJSON<T>(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null,
  requiredAction?: Actions,
  requiredSubject?: Subjects
): Promise<T | null> {
  console.log('[R2-CASL] Reading:', path);
  
  // Determine required permission
  const permission = requiredAction && requiredSubject
    ? { action: requiredAction, subject: requiredSubject }
    : pathToPermission(path, 'read');
  
  // Public paths don't require ability check
  if (isPublicPath(path)) {
    // Allow public access without ability
    console.log('[R2-CASL] Public path - no ability check required');
  } else if (isSystemPath(path)) {
    // System paths are protected but don't require user ability
    // These are accessed by authorized internal operations
    // Allow if ability is provided (authorized route context)
    if (!ability) {
      console.warn('[R2-CASL] System path accessed without ability:', path);
      // Still allow for backward compatibility, but log warning
    }
  } else if (isAuthPath(path)) {
    // Auth paths can be accessed without ability during authentication flows
    // (user lookup, domain whitelist checks, magic link verification)
    console.log('[R2-CASL] Auth path - allowing access without ability for authentication flow:', path);
  } else {
    // Protected paths require ability
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability provided for protected path:', path);
      throw new ForbiddenError('CASL ability required for protected paths');
    }
    
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    } else {
      // Path doesn't map to permission but isn't public - deny by default
      console.error('[R2-CASL] Unknown path pattern, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with read
  try {
    const object = await bucket.get(path);
    
    if (!object) {
      console.log('[R2-CASL] File not found:', path);
      return null;
    }
    
    const text = await object.text();
    const data = JSON.parse(text) as T;
    
    console.log('[R2-CASL] Read successful:', path);
    return data;
    
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error; // Re-throw CASL errors
    }
    console.error('[R2-CASL] Read error:', path, error);
    throw error;
  }
}

/**
 * Read JSON with ETag metadata and CASL permission check
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to read
 * @param ability - User's CASL ability (required for protected paths)
 * @param requiredAction - Optional explicit action to check
 * @param requiredSubject - Optional explicit subject to check
 * @returns JSON data and ETag, or null if not found
 */
export async function readJSONWithEtag<T>(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null,
  requiredAction?: Actions,
  requiredSubject?: Subjects
): Promise<{ data: T | null; etag: string | null }> {
  console.log('[R2-CASL] Reading with ETag:', path);
  
  // Determine required permission
  const permission = requiredAction && requiredSubject
    ? { action: requiredAction, subject: requiredSubject }
    : pathToPermission(path, 'read');
  
  // Public paths don't require ability check
  if (isPublicPath(path)) {
    console.log('[R2-CASL] Public path - no ability check required');
  } else if (isSystemPath(path)) {
    // System paths - allow if ability provided
    if (!ability) {
      console.warn('[R2-CASL] System path accessed without ability:', path);
    }
  } else {
    // Protected paths require ability
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability provided for protected path:', path);
      throw new ForbiddenError('CASL ability required for protected paths');
    }
    
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    } else {
      console.error('[R2-CASL] Unknown path pattern, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with read
  try {
    const object = await bucket.get(path);
    
    if (!object) {
      console.log('[R2-CASL] File not found:', path);
      return { data: null, etag: null };
    }
    
    const text = await object.text();
    const data = JSON.parse(text) as T;
    
    // Get ETag from R2 object metadata
    const etag = object.httpEtag || object.etag || null;
    
    console.log('[R2-CASL] Read successful with ETag:', path, 'ETag:', etag);
    return { data, etag };
    
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    console.error('[R2-CASL] Read error:', path, error);
    throw error;
  }
}

/**
 * Write JSON with CASL permission check
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to write
 * @param data - Data to write
 * @param ability - User's CASL ability (required for protected paths)
 * @param metadata - Optional custom metadata
 * @param requiredAction - Optional explicit action to check
 * @param requiredSubject - Optional explicit subject to check
 */
export async function writeJSON<T>(
  bucket: R2Bucket,
  path: string,
  data: T,
  ability: AppAbility | null,
  metadata?: Record<string, string>,
  requiredAction?: Actions,
  requiredSubject?: Subjects
): Promise<void> {
  console.log('[R2-CASL] Writing:', path);
  
  // Write operations always require ability (except system config and auth path writes)
  if (isSystemPath(path)) {
    // System config writes are internal operations - allow if ability provided
    if (!ability) {
      console.warn('[R2-CASL] System path write without ability:', path);
      // Still allow for backward compatibility with internal operations
    }
  } else if (isAuthPath(path)) {
    // Auth paths can be written without ability during authentication flows
    console.log('[R2-CASL] Auth path - allowing write without ability for authentication flow:', path);
  } else {
    // All other writes require ability
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability provided for write:', path);
      throw new ForbiddenError('CASL ability required for write operations');
    }
    
    // Determine required permission
    const permission = requiredAction && requiredSubject
      ? { action: requiredAction, subject: requiredSubject }
      : pathToPermission(path, 'write');
    
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    } else {
      console.error('[R2-CASL] Unknown path pattern for write, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with write
  try {
    const json = JSON.stringify(data, null, 2);
    
    await bucket.put(path, json, {
      httpMetadata: {
        contentType: 'application/json'
      },
      customMetadata: metadata
    });
    
    console.log('[R2-CASL] Write successful:', path);
    
    // Automatic bundle invalidation for relevant file writes
    // invalidateBundlesForFile() figures out which bundles need to be regenerated
    if (shouldInvalidateBundles(path) && ability) {
      // Trigger bundle invalidation asynchronously (non-blocking)
      // This ensures bundles/manifests are always regenerated when entities, types, or orgs change
      invalidateBundlesForFile(bucket, path, ability)
        .then(() => {
          console.log('[R2-CASL] Bundle invalidation complete for file:', path);
        })
        .catch(error => {
          // Log but don't fail the write operation
          console.error('[R2-CASL] Bundle invalidation failed (non-blocking):', path, error);
        });
    }
    
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    console.error('[R2-CASL] Write error:', path, error);
    throw error;
  }
}

/**
 * Delete file with CASL permission check
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to delete
 * @param ability - User's CASL ability (required for protected paths)
 * @param requiredAction - Optional explicit action to check
 * @param requiredSubject - Optional explicit subject to check
 */
export async function deleteFile(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null,
  requiredAction?: Actions,
  requiredSubject?: Subjects
): Promise<void> {
  console.log('[R2-CASL] Deleting:', path);
  
  // Delete operations always require ability (except system config and auth path deletes)
  if (isSystemPath(path)) {
    // System config deletes are internal operations
    if (!ability) {
      console.warn('[R2-CASL] System path delete without ability:', path);
    }
  } else if (isAuthPath(path)) {
    // Auth paths can be deleted without ability during authentication flows
    console.log('[R2-CASL] Auth path - allowing delete without ability for authentication flow:', path);
  } else {
    // All other deletes require ability
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability provided for delete:', path);
      throw new ForbiddenError('CASL ability required for delete operations');
    }
    
    // Determine required permission
    const permission = requiredAction && requiredSubject
      ? { action: requiredAction, subject: requiredSubject }
      : pathToPermission(path, 'delete');
    
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    } else {
      console.error('[R2-CASL] Unknown path pattern for delete, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with delete
  try {
    await bucket.delete(path);
    console.log('[R2-CASL] Delete successful:', path);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    console.error('[R2-CASL] Delete error:', path, error);
    throw error;
  }
}

/**
 * Check if a file exists (low-cost check using head)
 * Requires read permission if not public path
 */
export async function fileExists(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null
): Promise<boolean> {
  const head = await headFile(bucket, path, ability);
  return head !== null;
}

/**
 * Get file metadata (head) with CASL permission check
 * Returns R2ObjectHead with metadata (size, etag, customMetadata, etc.)
 * Requires read permission if not public path
 */
export async function headFile(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null
): Promise<R2ObjectHead | null> {
  console.log('[R2-CASL] Head:', path);
  
  // Check permission for protected paths
  if (!isPublicPath(path) && !isSystemPath(path)) {
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability for headFile:', path);
      throw new ForbiddenError('CASL ability required for headFile on protected paths');
    }
    
    const permission = pathToPermission(path, 'read');
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    }
  }
  
  const object = await bucket.head(path);
  console.log('[R2-CASL] Head result:', path, object ? 'exists' : 'not found');
  return object;
}

/**
 * List files with CASL permission check
 * Requires read permission on the prefix
 */
export async function listFiles(
  bucket: R2Bucket,
  prefix: string,
  ability: AppAbility | null,
  limit: number = 1000
): Promise<string[]> {
  console.log('[R2-CASL] Listing:', prefix);
  
  // Check permission for protected paths
  if (!isPublicPath(prefix) && !isSystemPath(prefix) && !isAuthPath(prefix)) {
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability for listFiles:', prefix);
      throw new ForbiddenError('CASL ability required for listFiles on protected paths');
    }
    
    const permission = pathToPermission(prefix, 'read');
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    }
  } else if (isAuthPath(prefix)) {
    // Auth paths can be listed without ability during authentication flows
    console.log('[R2-CASL] Auth path - allowing listFiles without ability for authentication flow:', prefix);
  }
  
  const listed = await bucket.list({
    prefix,
    limit
  });
  
  const paths = listed.objects.map(obj => obj.key);
  console.log('[R2-CASL] Found', paths.length, 'files');
  
  return paths;
}

/**
 * List files with pagination
 */
export async function listFilesPaginated(
  bucket: R2Bucket,
  prefix: string,
  ability: AppAbility | null,
  options: {
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{
  files: string[];
  cursor?: string;
  hasMore: boolean;
}> {
  // Check permission (same as listFiles)
  if (!isPublicPath(prefix) && !isSystemPath(prefix) && !isAuthPath(prefix)) {
    if (!ability) {
      throw new ForbiddenError('CASL ability required for listFilesPaginated on protected paths');
    }
    
    const permission = pathToPermission(prefix, 'read');
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    }
  } else if (isAuthPath(prefix)) {
    // Auth paths can be listed without ability during authentication flows
    console.log('[R2-CASL] Auth path - allowing listFilesPaginated without ability for authentication flow:', prefix);
  }
  
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

/**
 * Low-cost ETag check using bucket.head() (no body download)
 * Requires read permission if not public path
 */
export async function checkETag(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null
): Promise<string | null> {
  // Check permission for protected paths
  if (!isPublicPath(path) && !isSystemPath(path)) {
    if (!ability) {
      throw new ForbiddenError('CASL ability required for checkETag on protected paths');
    }
    
    const permission = pathToPermission(path, 'read');
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    }
  }
  
  const object = await bucket.head(path);
  return object?.httpEtag || object?.etag || null;
}

/**
 * Write binary file with CASL permission check
 * For file uploads (images, documents, etc.)
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to write
 * @param data - Binary data (ArrayBuffer or Blob)
 * @param ability - User's CASL ability (required for protected paths)
 * @param metadata - Optional custom metadata
 * @param contentType - Content type (e.g., 'image/png')
 */
export async function writeFile(
  bucket: R2Bucket,
  path: string,
  data: ArrayBuffer | Blob,
  ability: AppAbility | null,
  metadata?: Record<string, string>,
  contentType?: string
): Promise<void> {
  console.log('[R2-CASL] Writing file:', path);
  
  // File uploads always require ability
  if (!ability) {
    console.error('[R2-CASL] Permission denied - no ability provided for file write:', path);
    throw new ForbiddenError('CASL ability required for file write operations');
  }
  
  // Determine required permission based on path
  // uploads/ paths map to Platform subject (file management)
  const permission = pathToPermission(path, 'write');
  
  if (permission) {
    const { action, subject } = permission;
    if (!ability.can(action, subject)) {
      console.log('[R2-CASL] Permission denied:', { path, action, subject });
      throw new ForbiddenError(`Cannot ${action} ${subject}`);
    }
  } else {
    // uploads/ paths should map to Platform subject
    // If path doesn't match known patterns, check if it's an uploads path
    if (path.startsWith('uploads/')) {
      if (!ability.can('write', 'Platform')) {
        throw new ForbiddenError('Cannot write files');
      }
    } else {
      console.error('[R2-CASL] Unknown path pattern for file write, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with write
  try {
    await bucket.put(path, data, {
      httpMetadata: {
        contentType: contentType || 'application/octet-stream'
      },
      customMetadata: metadata
    });
    
    console.log('[R2-CASL] File write successful:', path);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    console.error('[R2-CASL] File write error:', path, error);
    throw error;
  }
}

/**
 * Read binary file with CASL permission check
 * For file serving (images, documents, etc.)
 * 
 * @param bucket - R2 bucket
 * @param path - R2 path to read
 * @param ability - User's CASL ability (null for public files)
 * @returns R2ObjectBody or null if not found
 */
export async function readFile(
  bucket: R2Bucket,
  path: string,
  ability: AppAbility | null
): Promise<R2ObjectBody | null> {
  console.log('[R2-CASL] Reading file:', path);
  
  // Check permission for protected paths
  // uploads/ paths are typically public for reading (serving files)
  // But we still check CASL for consistency
  if (!isPublicPath(path) && !isSystemPath(path)) {
    if (!ability) {
      console.error('[R2-CASL] Permission denied - no ability for file read:', path);
      throw new ForbiddenError('CASL ability required for file read on protected paths');
    }
    
    const permission = pathToPermission(path, 'read');
    if (permission) {
      const { action, subject } = permission;
      if (!ability.can(action, subject)) {
        console.log('[R2-CASL] Permission denied:', { path, action, subject });
        throw new ForbiddenError(`Cannot ${action} ${subject}`);
      }
    } else if (path.startsWith('uploads/')) {
      // uploads/ paths - allow read (public file serving)
      // But still log for audit
      console.log('[R2-CASL] Reading uploads file (public):', path);
    } else {
      console.error('[R2-CASL] Unknown path pattern for file read, denying access:', path);
      throw new ForbiddenError('Unknown path pattern - access denied');
    }
  }
  
  // Proceed with read
  try {
    const object = await bucket.get(path);
    console.log('[R2-CASL] File read successful:', path, object ? 'found' : 'not found');
    return object;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    console.error('[R2-CASL] File read error:', path, error);
    throw error;
  }
}
