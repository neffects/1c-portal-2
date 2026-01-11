/**
 * Worker environment and context types
 */

import type { JWTPayload, User, UserRole } from '@1cc/shared';

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // R2 bucket for data storage
  R2_BUCKET: R2Bucket;
  
  // Environment variables
  ENVIRONMENT: string;
  API_BASE_URL: string;
  FRONTEND_URL: string;
  
  // Secrets (set via wrangler secret)
  JWT_SECRET: string;
  RESEND_API_KEY?: string;
  
  // Superadmin emails (comma-separated list)
  SUPERADMIN_EMAILS: string;
  
  // Optional: KV namespace for caching
  CACHE?: KVNamespace;
}

/**
 * Hono context variables (set by middleware)
 * 
 * Note: Role and organization are NOT in JWT anymore.
 * They are looked up from user-org stubs per request.
 */
export interface Variables {
  // Set by auth middleware (from JWT)
  user?: JWTPayload;
  userId?: string;
  userEmail?: string;
  
  // Set by auth middleware (checked against env)
  isSuperadmin?: boolean;
  
  // Request tracking
  requestId?: string;
}

/**
 * Request context passed to handlers
 */
export interface RequestContext {
  env: Env;
  user?: JWTPayload;
  requestId: string;
}

/**
 * R2 object metadata
 */
export interface R2ObjectMetadata {
  contentType?: string;
  customMetadata?: Record<string, string>;
}

/**
 * Standard API response format
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
  };
}
