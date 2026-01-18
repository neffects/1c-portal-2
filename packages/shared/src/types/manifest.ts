/**
 * Manifest and Bundle types for client sync
 */

import type { EntityStatus, VisibilityScope } from './entity';
import type { BrandingConfig, FeatureFlags, SyncConfig, AuthConfig } from './config';

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
  /** Application configuration (branding, features, sync, auth) */
  config?: {
    branding: BrandingConfig;
    features: FeatureFlags;
    sync: SyncConfig;
    auth: AuthConfig;
    apiBaseUrl?: string;
    r2PublicUrl?: string;
  };
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
  /** When last updated (ISO 8601) */
  lastUpdated: string;
}

/**
 * Entity bundle - pre-aggregated entities for sync
 * Location:
 * - public/bundles/{typeId}.json
 * - platform/bundles/{typeId}.json
 * - private/orgs/{orgId}/bundles/{typeId}.json
 * 
 * NOTE: Bundles use `typeId` (NOT `entityTypeId`) to identify the entity type.
 * This is intentional - bundles are scoped by type, so the type ID is stored at the bundle level.
 * 
 * NOTE: Bundles do NOT have versions. Change detection uses HTTP ETags instead.
 */
export interface EntityBundle {
  /** Entity type ID (NOT entityTypeId - this is the bundle-level type identifier) */
  typeId: string;
  /** Entity type name */
  typeName: string;
  /** When the bundle was generated (ISO 8601) */
  generatedAt: string;
  /** Total entity count */
  entityCount: number;
  /** Entities in this bundle */
  entities: BundleEntity[];
}

/**
 * Entity entry in a bundle (compact format)
 * Note: Only entities have versions - bundles don't track entity versions
 * 
 * IMPORTANT: BundleEntity does NOT include entityTypeId.
 * The entity type is identified by the parent EntityBundle.typeId field.
 * This keeps bundle entities compact and avoids redundancy.
 */
export interface BundleEntity {
  /** Entity ID */
  id: string;
  /** Current status */
  status: EntityStatus;
  /** Entity name (common property, top-level) */
  name: string;
  /** URL slug */
  slug: string;
  /** Entity dynamic data fields (does NOT include name, slug, or entityTypeId) */
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
