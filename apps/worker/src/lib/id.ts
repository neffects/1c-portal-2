/**
 * ID Generation Utilities
 * 
 * Generates short, URL-safe unique identifiers using NanoID.
 * IDs are 7 characters using lowercase letters and numbers.
 */

import { customAlphabet } from 'nanoid';
import { ENTITY_ID_LENGTH, ENTITY_ID_ALPHABET } from '@1cc/shared';

/**
 * Create a custom NanoID generator with our alphabet
 */
const generateId = customAlphabet(ENTITY_ID_ALPHABET, ENTITY_ID_LENGTH);

/**
 * Generate a new entity ID
 * Format: 7 lowercase alphanumeric characters (e.g., "a7k2m9x")
 */
export function createEntityId(): string {
  const id = generateId();
  console.log('[ID] Generated entity ID:', id);
  return id;
}

/**
 * Generate a new user ID
 * Same format as entity IDs for consistency
 */
export function createUserId(): string {
  const id = generateId();
  console.log('[ID] Generated user ID:', id);
  return id;
}

/**
 * Generate a new organization ID
 * Same format as entity IDs for consistency
 */
export function createOrgId(): string {
  const id = generateId();
  console.log('[ID] Generated org ID:', id);
  return id;
}

/**
 * Generate a new entity type ID
 * Same format as entity IDs for consistency
 */
export function createEntityTypeId(): string {
  const id = generateId();
  console.log('[ID] Generated entity type ID:', id);
  return id;
}

/**
 * Generate a magic link token (longer for security)
 */
const generateToken = customAlphabet(ENTITY_ID_ALPHABET, 32);

export function createMagicLinkToken(): string {
  const token = generateToken();
  console.log('[ID] Generated magic link token');
  return token;
}

/**
 * Generate an invitation token
 */
export function createInvitationToken(): string {
  const token = generateToken();
  console.log('[ID] Generated invitation token');
  return token;
}

/**
 * Validate that a string is a valid entity ID
 */
export function isValidEntityId(id: string): boolean {
  if (typeof id !== 'string') return false;
  if (id.length !== ENTITY_ID_LENGTH) return false;
  return /^[a-z0-9]+$/.test(id);
}

/**
 * Generate a URL-safe slug from a string
 */
export function createSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length
}

/**
 * Generate a unique slug by appending numbers if needed
 */
export function createUniqueSlug(text: string, existingSlugs: string[]): string {
  let slug = createSlug(text);
  let counter = 1;
  
  while (existingSlugs.includes(slug)) {
    slug = `${createSlug(text)}-${counter}`;
    counter++;
  }
  
  return slug;
}
