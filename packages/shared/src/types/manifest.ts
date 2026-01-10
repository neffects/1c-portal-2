/**
 * Manifest and Bundle types for client sync
 */

import type { EntityStatus, VisibilityScope } from './entity';

/**
 * Site manifest - index of available entity types
 * Location: 
 * - public/manifests/site.json
 * - platform/manifests/site.json
 * - private/orgs/{orgId}/manifests/site.json
 */
export interface SiteManifest {
  /** When the manifest was generated (ISO 8601) */
  generatedAt: string;
  /** Manifest version (increments on changes) */
  version: number;
  /** Available entity types */
  entityTypes: ManifestEntityType[];
}

/**
 * Entity type entry in a manifest
 */
export interface ManifestEntityType {
  /** Entity type ID */
  id: string;
  /** Display name */
  name: string;
  /** Plural name */
  pluralName: string;
  /** URL slug */
  slug: string;
  /** Description */
  description?: string;
  /** Number of entities of this type */
  entityCount: number;
  /** Current bundle version */
  bundleVersion: number;
  /** When last updated (ISO 8601) */
  lastUpdated: string;
}

/**
 * Entity bundle - pre-aggregated entities for sync
 * Location:
 * - public/bundles/{typeId}.json
 * - platform/bundles/{typeId}.json
 * - private/orgs/{orgId}/bundles/{typeId}.json
 */
export interface EntityBundle {
  /** Entity type ID */
  typeId: string;
  /** Entity type name */
  typeName: string;
  /** When the bundle was generated (ISO 8601) */
  generatedAt: string;
  /** Bundle version (increments on any entity change) */
  version: number;
  /** Total entity count */
  entityCount: number;
  /** Entities in this bundle */
  entities: BundleEntity[];
}

/**
 * Entity entry in a bundle (compact format)
 */
export interface BundleEntity {
  /** Entity ID */
  id: string;
  /** Entity version */
  version: number;
  /** Current status */
  status: EntityStatus;
  /** URL slug */
  slug: string;
  /** Entity data fields */
  data: Record<string, unknown>;
  /** When last updated (ISO 8601) */
  updatedAt: string;
}

/**
 * Client sync state - tracks what's been synced
 */
export interface SyncState {
  /** Last synced manifest version */
  manifestVersion: number;
  /** Last synced bundle versions by type ID */
  bundleVersions: Record<string, number>;
  /** When last synced (ISO 8601) */
  lastSyncedAt: string;
}

/**
 * Sync request - client sends current state
 */
export interface SyncRequest {
  /** Current manifest version client has */
  manifestVersion?: number;
  /** Current bundle versions client has */
  bundleVersions?: Record<string, number>;
}

/**
 * Sync response - server sends updates
 */
export interface SyncResponse {
  /** Whether manifest needs update */
  manifestUpdated: boolean;
  /** New manifest (if updated) */
  manifest?: SiteManifest;
  /** Updated bundles (only those that changed) */
  updatedBundles: EntityBundle[];
  /** Type IDs that were removed */
  removedTypes: string[];
}
