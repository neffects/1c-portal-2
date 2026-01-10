/**
 * @1cc/shared - Shared types, schemas, and utilities for the 1C Portal
 * 
 * This package contains all shared code used across the worker and web apps:
 * - TypeScript interfaces for entities, users, organizations
 * - Zod validation schemas
 * - Common utilities and constants
 */

// Re-export all types
export * from './types';

// Re-export all schemas
export * from './schemas';

// Re-export constants
export * from './constants';

// Debug logging
console.log('[shared] Package loaded');
