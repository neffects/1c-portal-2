/**
 * Organization types for the 1C Portal
 */

/**
 * Organization profile stored in R2
 * Location: private/orgs/{orgId}/profile.json
 */
export interface Organization {
  /** Unique organization identifier (NanoID format) */
  id: string;
  /** Organization display name */
  name: string;
  /** URL-friendly slug */
  slug: string;
  /** Organization profile details */
  profile: OrganizationProfile;
  /** Organization settings */
  settings: OrganizationSettings;
  /** Membership key (references membershipKeys.keys[].id from app config) */
  membershipKey: string;
  /** When the organization was created (ISO 8601) */
  createdAt: string;
  /** When the organization was last updated (ISO 8601) */
  updatedAt: string;
  /** Whether the organization is active */
  isActive: boolean;
}

/**
 * Organization profile information
 */
export interface OrganizationProfile {
  /** Short description of the organization */
  description?: string;
  /** Logo URL for light theme */
  logoUrl?: string;
  /** Logo URL for dark theme */
  logoDarkUrl?: string;
  /** Organization website */
  website?: string;
  /** Contact email */
  contactEmail?: string;
}

/**
 * Organization settings and configuration
 */
export interface OrganizationSettings {
  /** Email domains allowed for self-signup */
  domainWhitelist: string[];
  /** Whether users with whitelisted domains can self-register */
  allowSelfSignup: boolean;
  /** Custom branding settings */
  branding?: {
    primaryColor?: string;
    accentColor?: string;
  };
}

/**
 * Entity type permissions for an organization
 * Location: private/policies/organizations/{orgId}/entity-type-permissions.json
 */
export interface EntityTypePermissions {
  /** Organization ID */
  organizationId: string;
  /** Entity type IDs members can view */
  viewable: string[];
  /** Entity type IDs admins can create */
  creatable: string[];
  /** When permissions were last updated (ISO 8601) */
  updatedAt: string;
  /** ID of user who updated permissions */
  updatedBy: string;
}

/**
 * Create organization request
 */
export interface CreateOrganizationRequest {
  name: string;
  slug: string;
  description?: string;
  domainWhitelist?: string[];
  allowSelfSignup?: boolean;
}

/**
 * Update organization request
 */
export interface UpdateOrganizationRequest {
  name?: string;
  slug?: string;
  profile?: Partial<OrganizationProfile>;
  settings?: Partial<OrganizationSettings>;
}

/**
 * Organization list response item
 */
export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  membershipKey: string;
  memberCount: number;
  entityCount: number;
  createdAt: string;
  isActive: boolean;
}
