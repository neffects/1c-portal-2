/**
 * TanStack DB Query Hooks
 * 
 * Preact hooks for querying TanStack DB with reactive state management.
 * Provides offline-first data access with loading and error states.
 */

import { useState, useEffect } from 'preact/hooks';
import { useAuth } from '../stores/auth';
import {
  getEntityType as dbGetEntityType,
  getEntityTypesForManifest,
  getBundle as dbGetBundle,
  getEntity as dbGetEntity,
  getEntityBySlug as dbGetEntityBySlug,
} from '../stores/db';
import type {
  ManifestEntityType,
  EntityBundle,
  BundleEntity,
} from '@1cc/shared';

// Internal type from db.ts
interface EntityTypeRow {
  id: string;
  manifestId: string;
  name: string;
  pluralName: string;
  slug: string;
  description?: string;
  entityCount: number;
  lastUpdated: string;
}

/**
 * Convert EntityTypeRow to ManifestEntityType
 */
function entityTypeRowToManifestType(row: EntityTypeRow): ManifestEntityType {
  return {
    id: row.id,
    name: row.name,
    pluralName: row.pluralName,
    slug: row.slug,
    description: row.description,
    entityCount: row.entityCount,
    lastUpdated: row.lastUpdated,
  };
}

/**
 * Hook to determine the correct manifest ID based on auth state
 * Returns: 'public' | 'platform' | 'org:${orgId}:member' | 'org:${orgId}:admin'
 */
export function useManifestId(): string {
  const { isAuthenticated, organizationId, userRole } = useAuth();
  
  if (!isAuthenticated.value) {
    return 'public';
  }
  
  const orgId = organizationId.value;
  const role = userRole.value;
  
  if (orgId && role === 'org_admin') {
    return `org:${orgId}:admin`;
  }
  
  if (orgId) {
    return `org:${orgId}:member`;
  }
  
  return 'platform';
}

/**
 * Hook to get entity type by ID or slug
 * Returns entity type data with loading and error states
 */
export function useEntityType(idOrSlug: string | undefined) {
  const [data, setData] = useState<ManifestEntityType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!idOrSlug) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    
    dbGetEntityType(idOrSlug)
      .then((row) => {
        if (row) {
          setData(entityTypeRowToManifestType(row));
        } else {
          setData(null);
        }
      })
      .catch((err) => {
        console.error('[useEntityType] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [idOrSlug]);

  return { data, loading, error };
}

/**
 * Hook to get all entity types for a manifest
 * If manifestId is not provided, uses useManifestId() to determine it
 */
export function useEntityTypes(manifestId?: string) {
  const defaultManifestId = useManifestId();
  const resolvedManifestId = manifestId || defaultManifestId;
  
  const [data, setData] = useState<ManifestEntityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    console.log('[useEntityTypes] Fetching entity types for manifest:', resolvedManifestId);
    
    getEntityTypesForManifest(resolvedManifestId)
      .then((types) => {
        console.log('[useEntityTypes] Found', types.length, 'entity types for manifest:', resolvedManifestId, types.map(t => t.id));
        setData(types);
      })
      .catch((err) => {
        console.error('[useEntityTypes] Error fetching entity types for manifest:', resolvedManifestId, err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setData([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [resolvedManifestId]);

  return { data, loading, error };
}

/**
 * Hook to get bundle by manifest ID and type ID
 * Returns bundle data with loading and error states
 */
export function useBundle(manifestId: string | undefined, typeId: string | undefined) {
  const [data, setData] = useState<EntityBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!manifestId || !typeId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    
    dbGetBundle(manifestId, typeId)
      .then(setData)
      .catch((err) => {
        console.error('[useBundle] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [manifestId, typeId]);

  return { data, loading, error };
}

/**
 * Hook to get entity by ID
 * Returns entity data with loading and error states
 */
export function useEntity(entityId: string | undefined) {
  const [data, setData] = useState<BundleEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!entityId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    
    dbGetEntity(entityId)
      .then(setData)
      .catch((err) => {
        console.error('[useEntity] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [entityId]);

  return { data, loading, error };
}

/**
 * Hook to get entity by type ID and slug
 * Returns entity data with loading and error states
 */
export function useEntityBySlug(typeId: string | undefined, slug: string | undefined) {
  const [data, setData] = useState<BundleEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!typeId || !slug) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    
    dbGetEntityBySlug(typeId, slug)
      .then(setData)
      .catch((err) => {
        console.error('[useEntityBySlug] Error:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [typeId, slug]);

  return { data, loading, error };
}
