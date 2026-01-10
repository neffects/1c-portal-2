/**
 * Authentication types for magic link flow and JWT tokens
 */

import type { UserRole } from './user';

/**
 * JWT payload structure embedded in authentication tokens
 */
export interface JWTPayload {
  /** User's unique identifier */
  sub: string;
  /** User's email address */
  email: string;
  /** User's role in the system */
  role: UserRole;
  /** Organization ID the user belongs to (null for superadmins) */
  organizationId: string | null;
  /** Token issued at timestamp (Unix epoch seconds) */
  iat: number;
  /** Token expiration timestamp (Unix epoch seconds) */
  exp: number;
}

/**
 * Magic link token stored in R2 for verification
 */
export interface MagicLinkToken {
  /** The token string sent in the email */
  token: string;
  /** Email address this token is for */
  email: string;
  /** When the token expires (ISO 8601) */
  expiresAt: string;
  /** When the token was created (ISO 8601) */
  createdAt: string;
  /** Whether the token has been used */
  used: boolean;
  /** IP address that requested the token */
  requestedFromIp?: string;
}

/**
 * Request body for magic link generation
 */
export interface MagicLinkRequest {
  email: string;
}

/**
 * Response after magic link is sent
 */
export interface MagicLinkResponse {
  success: boolean;
  message: string;
}

/**
 * Response after successful authentication
 */
export interface AuthResponse {
  success: boolean;
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
    organizationName?: string;
  };
  expiresAt: string;
}

/**
 * Session data stored client-side
 */
export interface Session {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
  };
  expiresAt: string;
}
