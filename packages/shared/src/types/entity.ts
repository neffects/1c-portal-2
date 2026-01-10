/**
 * Entity types for the 1C Portal
 */

import { ENTITY_STATUSES, VISIBILITY_SCOPES } from '../constants';

/**
 * Entity status type derived from constants
 */
export type EntityStatus = typeof ENTITY_STATUSES[number];

/**
 * Visibility scope type derived from constants
 */
export type VisibilityScope = typeof VISIBILITY_SCOPES[number];

/**
 * Entity record - the core content unit
 * Location varies by visibility:
 * - public/entities/{entityId}/v{n}.json
 * - platform/entities/{entityId}/v{n}.json
 * - private/orgs/{orgId}/entities/{entityId}/v{n}.json
 */
export interface Entity {
  /** Unique entity identifier (7-char NanoID) */
  id: string;
  /** Entity type identifier */
  entityTypeId: string;
  /** Organization that owns this entity */
  organizationId: string;
  /** Version number (increments on each save) */
  version: number;
  /** Current status in the lifecycle */
  status: EntityStatus;
  /** Visibility scope determining who can access */
  visibility: VisibilityScope;
  /** URL-friendly slug generated from name */
  slug: string;
  /** Dynamic data fields defined by entity type */
  data: Record<string, unknown>;
  /** When the entity was created (ISO 8601) */
  createdAt: string;
  /** When the entity was last updated (ISO 8601) */
  updatedAt: string;
  /** ID of user who created the entity */
  createdBy: string;
  /** ID of user who last updated the entity */
  updatedBy: string;
  /** Approval feedback from superadmin (rejection reason or approval notes) */
  approvalFeedback?: string;
  /** When approval action was taken (ISO 8601) */
  approvalActionAt?: string;
  /** ID of superadmin who took approval action */
  approvalActionBy?: string;
}

/**
 * Entity ID stub for quick ownership lookup
 * Location: stubs/{entityId}.json
 */
export interface EntityStub {
  /** Entity ID */
  entityId: string;
  /** Organization that owns this entity */
  organizationId: string;
  /** Entity type identifier */
  entityTypeId: string;
  /** When the entity was created (ISO 8601) */
  createdAt: string;
}

/**
 * Latest version pointer
 * Location: entities/{entityId}/latest.json
 */
export interface EntityLatestPointer {
  /** Current version number */
  version: number;
  /** Current status */
  status: EntityStatus;
  /** Current visibility */
  visibility: VisibilityScope;
  /** When last updated (ISO 8601) */
  updatedAt: string;
}

/**
 * Create entity request
 */
export interface CreateEntityRequest {
  /** Entity type ID to create */
  entityTypeId: string;
  /** Initial field data */
  data: Record<string, unknown>;
  /** Visibility scope (uses type default if not specified) */
  visibility?: VisibilityScope;
}

/**
 * Update entity request - atomic field updates
 */
export interface UpdateEntityRequest {
  /** Fields to update (merged with existing) */
  data?: Record<string, unknown>;
  /** Update visibility */
  visibility?: VisibilityScope;
}

/**
 * Entity status transition request
 */
export interface EntityTransitionRequest {
  /** Target status */
  action: 'submitForApproval' | 'approve' | 'reject' | 'archive' | 'restore' | 'delete';
  /** Optional feedback (e.g., rejection reason) */
  feedback?: string;
}

/**
 * Entity list item (compact version for lists)
 */
export interface EntityListItem {
  id: string;
  entityTypeId: string;
  organizationId: string;
  slug: string;
  status: EntityStatus;
  visibility: VisibilityScope;
  /** Subset of data fields for display */
  data: {
    name?: string;
    [key: string]: unknown;
  };
  version: number;
  updatedAt: string;
}

/**
 * Entity version history item
 */
export interface EntityVersionInfo {
  version: number;
  status: EntityStatus;
  updatedAt: string;
  updatedBy: string;
  changeDescription?: string;
}
