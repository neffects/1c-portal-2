/**
 * User types for the 1C Portal
 */

import { USER_ROLES } from '../constants';

/**
 * User role type derived from constants
 */
export type UserRole = typeof USER_ROLES[number];

/**
 * User record stored in R2
 * Location: private/orgs/{orgId}/users/{userId}.json
 */
export interface User {
  /** Unique user identifier (NanoID format) */
  id: string;
  /** User's email address */
  email: string;
  /** Display name (optional) */
  name?: string;
  /** User's role in the system */
  role: UserRole;
  /** Organization ID (null for superadmins) */
  organizationId: string | null;
  /** When the user was created (ISO 8601) */
  createdAt: string;
  /** When the user was last updated (ISO 8601) */
  updatedAt: string;
  /** Whether the user is active */
  isActive: boolean;
  /** Last login timestamp (ISO 8601) */
  lastLoginAt?: string;
}

/**
 * Organization membership record
 * Location: private/orgs/{orgId}/users/{userId}.json
 */
export interface OrganizationMembership {
  /** User ID */
  userId: string;
  /** Organization ID */
  organizationId: string;
  /** Role within this organization */
  role: 'org_admin' | 'org_member';
  /** User's email address */
  email: string;
  /** When the user joined the organization (ISO 8601) */
  joinedAt: string;
  /** ID of user who invited this member */
  invitedBy?: string;
}

/**
 * User invitation record
 * Location: private/invitations/{token}.json
 */
export interface UserInvitation {
  /** Unique invitation token */
  token: string;
  /** Email address invited */
  email: string;
  /** Organization to join */
  organizationId: string;
  /** Role to assign upon acceptance */
  role: 'org_admin' | 'org_member';
  /** ID of user who sent the invitation */
  invitedBy: string;
  /** When the invitation was sent (ISO 8601) */
  createdAt: string;
  /** When the invitation expires (ISO 8601) */
  expiresAt: string;
  /** Whether the invitation has been accepted */
  accepted: boolean;
  /** When the invitation was accepted (ISO 8601) */
  acceptedAt?: string;
}

/**
 * User alert preferences
 * Location: private/users/{userId}/preferences.json
 */
export interface UserPreferences {
  userId: string;
  /** Email notification settings */
  notifications: {
    /** Receive alert digest emails */
    emailAlerts: boolean;
    /** Alert digest frequency */
    alertFrequency: 'daily' | 'weekly' | 'monthly';
    /** Specific time to send digest (24h format) */
    digestTime?: string;
  };
  /** UI preferences */
  ui: {
    /** Preferred theme */
    theme: 'light' | 'dark' | 'system';
    /** Preferred language */
    language: string;
  };
  updatedAt: string;
}

/**
 * Entity flag for alerts
 * Location: private/users/{userId}/flags/{entityId}.json
 */
export interface EntityFlag {
  userId: string;
  entityId: string;
  entityTypeId: string;
  /** When the flag was created (ISO 8601) */
  flaggedAt: string;
  /** Optional note about why flagged */
  note?: string;
}
