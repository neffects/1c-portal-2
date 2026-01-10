/**
 * Shared constants used across the 1C Portal application
 */

// Entity ID configuration
export const ENTITY_ID_LENGTH = 7;
export const ENTITY_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// JWT configuration
export const JWT_ALGORITHM = 'HS256';
export const JWT_EXPIRY_SECONDS = 604800; // 7 days
export const MAGIC_LINK_EXPIRY_SECONDS = 600; // 10 minutes

// Bundle sync configuration
export const BUNDLE_REFRESH_INTERVAL_MS = 300000; // 5 minutes
export const STALE_TIME_MS = 60000; // 1 minute
export const GC_TIME_MS = 86400000; // 24 hours

// Entity statuses
export const ENTITY_STATUSES = ['draft', 'pending', 'published', 'archived', 'deleted'] as const;

// User roles
export const USER_ROLES = ['superadmin', 'org_admin', 'org_member'] as const;

// Visibility scopes
// - public: Accessible to everyone, SEO indexable
// - authenticated: All authenticated users on the platform
// - members: Organization members only
export const VISIBILITY_SCOPES = ['public', 'authenticated', 'members'] as const;

// Field types
export const FIELD_TYPES = [
  'string',
  'text',
  'markdown',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'link',
  'image',
  'logo',
  'file',
  'country'
] as const;

// R2 path prefixes
export const R2_PATHS = {
  CONFIG: 'config/',
  PUBLIC: 'public/',
  PLATFORM: 'platform/',
  PRIVATE: 'private/',
  STUBS: 'stubs/',
  SECRET: 'secret/'
} as const;

// API routes
export const API_ROUTES = {
  AUTH: '/auth',
  ORGANIZATIONS: '/organizations',
  ENTITY_TYPES: '/entity-types',
  ENTITIES: '/entities',
  USERS: '/users'
} as const;

// Debug flag
export const DEBUG = true;
