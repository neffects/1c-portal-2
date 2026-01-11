/**
 * Authentication types for magic link flow and JWT tokens
 * 
 * Note: JWT is user-level (email only), not organization-specific.
 * User's organization memberships and roles are stored in user-org stub files.
 */

import type { UserRole } from './user';

/**
 * JWT payload structure embedded in authentication tokens
 * 
 * Minimal payload: only user identification (sub + email).
 * Role and organization are looked up from user-org stubs per request.
 */
export interface JWTPayload {
  /** User's unique identifier */
  sub: string;
  /** User's email address */
  email: string;
  /** Token issued at timestamp (Unix epoch seconds) */
  iat: number;
  /** Token expiration timestamp (Unix epoch seconds) */
  exp: number;
}

/**
 * Organization membership info for a user
 * Returned by /auth/me endpoint
 */
export interface UserOrganization {
  /** Organization ID */
  id: string;
  /** Organization name */
  name: string;
  /** Organization slug */
  slug: string;
  /** User's role in this organization */
  role: UserRole;
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
    /** Whether user is a superadmin (not organization-specific) */
    isSuperadmin: boolean;
    /** Organizations the user belongs to with their roles */
    organizations: UserOrganization[];
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
    /** Whether user is a superadmin */
    isSuperadmin: boolean;
    /** Organizations the user belongs to with their roles */
    organizations: UserOrganization[];
  };
  /** Currently selected organization ID (client-side context) */
  currentOrganizationId: string | null;
  expiresAt: string;
}
