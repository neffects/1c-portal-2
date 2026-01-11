/**
 * User-Organization Stub Utilities
 * 
 * Manages user-org membership stub files on R2 for efficient membership lookups.
 * Stub files encode email-hash, user-id, org-id, and role in the filename.
 * 
 * Path format: private/user-stubs/[email-hash]-[user-id]-[org-id]-[role].json
 * 
 * These stubs allow:
 * - Fast membership existence checks (no file read needed)
 * - Role extraction from filename
 * - Listing all organizations a user belongs to
 */

import { R2_PATHS } from '@1cc/shared';
import type { UserRole } from '@1cc/shared';
import { listFiles, writeJSON, deleteFile, fileExists } from './r2';

// Stub directory path
const USER_STUBS_PREFIX = `${R2_PATHS.PRIVATE}user-stubs/`;

/**
 * Hash an email address using SHA-256
 * Returns first 16 characters of the hex hash for reasonable uniqueness
 */
export async function hashEmail(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedEmail);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Return first 16 chars for reasonable uniqueness while keeping paths manageable
  return hashHex.substring(0, 16);
}

/**
 * Build the stub file path for a user-org membership
 * Format: private/user-stubs/[email-hash]-[user-id]-[org-id]-[role].json
 */
export function getUserStubPath(
  emailHash: string,
  userId: string,
  orgId: string,
  role: string
): string {
  return `${USER_STUBS_PREFIX}${emailHash}-${userId}-${orgId}-${role}.json`;
}

/**
 * Build a prefix for listing stubs by email hash and user id
 * Used to find all organizations a user belongs to
 */
export function getUserStubPrefix(emailHash: string, userId: string): string {
  return `${USER_STUBS_PREFIX}${emailHash}-${userId}-`;
}

/**
 * Build a prefix for checking membership in a specific org
 * Used to check if user is member of an org (includes finding role)
 */
export function getUserOrgStubPrefix(
  emailHash: string,
  userId: string,
  orgId: string
): string {
  return `${USER_STUBS_PREFIX}${emailHash}-${userId}-${orgId}-`;
}

/**
 * Parse a stub filename to extract components
 * Returns null if filename doesn't match expected format
 */
export function parseStubFilename(filename: string): {
  emailHash: string;
  userId: string;
  orgId: string;
  role: string;
} | null {
  // Remove the directory prefix and .json extension
  const basename = filename
    .replace(USER_STUBS_PREFIX, '')
    .replace('.json', '');
  
  // Split by hyphen - format is emailHash-userId-orgId-role
  const parts = basename.split('-');
  
  // We expect at least 4 parts (emailHash, userId, orgId, role)
  // Note: IDs might contain hyphens, so we need to be careful
  // Format: 16-char-hash - 7-char-userId - 7-char-orgId - role
  if (parts.length < 4) {
    console.log('[UserStubs] Invalid stub filename format:', filename);
    return null;
  }
  
  // Email hash is first 16 chars (split by hyphens in the hash won't happen as it's hex)
  const emailHash = parts[0];
  const userId = parts[1];
  const orgId = parts[2];
  // Role is everything after orgId (in case role has hyphens, though it shouldn't)
  const role = parts.slice(3).join('-');
  
  return { emailHash, userId, orgId, role };
}

/**
 * Check if a user-org stub exists and get the role
 * Returns { exists: false } if no stub, or { exists: true, role: string } if found
 */
export async function userOrgStubExists(
  bucket: R2Bucket,
  email: string,
  userId: string,
  orgId: string
): Promise<{ exists: boolean; role?: UserRole }> {
  console.log('[UserStubs] Checking stub for user:', userId, 'org:', orgId);
  
  const emailHash = await hashEmail(email);
  const prefix = getUserOrgStubPrefix(emailHash, userId, orgId);
  
  // List files with this prefix to find the stub (we need to discover the role)
  const files = await listFiles(bucket, prefix);
  
  if (files.length === 0) {
    console.log('[UserStubs] No stub found for user:', userId, 'org:', orgId);
    return { exists: false };
  }
  
  // Parse the first matching file to get the role
  const parsed = parseStubFilename(files[0]);
  if (!parsed) {
    console.log('[UserStubs] Could not parse stub filename:', files[0]);
    return { exists: false };
  }
  
  console.log('[UserStubs] Found stub with role:', parsed.role);
  return { exists: true, role: parsed.role as UserRole };
}

/**
 * Create a user-org stub file
 * The file content is minimal - just a timestamp for debugging
 */
export async function createUserOrgStub(
  bucket: R2Bucket,
  email: string,
  userId: string,
  orgId: string,
  role: UserRole
): Promise<void> {
  console.log('[UserStubs] Creating stub for user:', userId, 'org:', orgId, 'role:', role);
  
  const emailHash = await hashEmail(email);
  const path = getUserStubPath(emailHash, userId, orgId, role);
  
  // Minimal content - the important data is in the filename
  const stubContent = {
    createdAt: new Date().toISOString()
  };
  
  await writeJSON(bucket, path, stubContent);
  console.log('[UserStubs] Created stub at:', path);
}

/**
 * Delete a user-org stub file
 * Since we don't know the role, we need to find the file first
 */
export async function deleteUserOrgStub(
  bucket: R2Bucket,
  email: string,
  userId: string,
  orgId: string
): Promise<void> {
  console.log('[UserStubs] Deleting stub for user:', userId, 'org:', orgId);
  
  const emailHash = await hashEmail(email);
  const prefix = getUserOrgStubPrefix(emailHash, userId, orgId);
  
  // Find the stub file (we need to know the role to build the exact path)
  const files = await listFiles(bucket, prefix);
  
  if (files.length === 0) {
    console.log('[UserStubs] No stub found to delete');
    return;
  }
  
  // Delete all matching stubs (should be just one, but handle edge cases)
  for (const file of files) {
    await deleteFile(bucket, file);
    console.log('[UserStubs] Deleted stub:', file);
  }
}

/**
 * Update a user-org stub (change role)
 * Deletes old stub and creates new one with new role
 */
export async function updateUserOrgStubRole(
  bucket: R2Bucket,
  email: string,
  userId: string,
  orgId: string,
  newRole: UserRole
): Promise<void> {
  console.log('[UserStubs] Updating stub role for user:', userId, 'org:', orgId, 'to:', newRole);
  
  // Delete existing stub(s)
  await deleteUserOrgStub(bucket, email, userId, orgId);
  
  // Create new stub with new role
  await createUserOrgStub(bucket, email, userId, orgId, newRole);
}

/**
 * List all organizations a user belongs to
 * Returns array of { orgId, role } objects
 */
export async function listUserOrganizations(
  bucket: R2Bucket,
  email: string,
  userId: string
): Promise<Array<{ orgId: string; role: UserRole }>> {
  console.log('[UserStubs] Listing organizations for user:', userId);
  
  const emailHash = await hashEmail(email);
  const prefix = getUserStubPrefix(emailHash, userId);
  
  // List all stub files for this user
  const files = await listFiles(bucket, prefix);
  
  const organizations: Array<{ orgId: string; role: UserRole }> = [];
  
  for (const file of files) {
    const parsed = parseStubFilename(file);
    if (parsed) {
      organizations.push({
        orgId: parsed.orgId,
        role: parsed.role as UserRole
      });
    }
  }
  
  console.log('[UserStubs] Found', organizations.length, 'organizations for user');
  return organizations;
}

/**
 * Check if user is a superadmin (special case - not in stubs)
 * Superadmins are identified by email in environment variable
 */
export function isSuperadminEmail(email: string, superadminEmails?: string): boolean {
  if (!superadminEmails) return false;
  
  const emails = superadminEmails.split(',').map(e => e.trim().toLowerCase());
  return emails.includes(email.toLowerCase().trim());
}
