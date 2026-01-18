/**
 * Superadmin Entity Routes
 * 
 * CRUD /api/super/entities - Superadmin entity management (including global entities)
 * 
 * Routes:
 * - GET /entities/export - Export entities for a type
 * - POST /entities/bulk-import - Atomic bulk import with versioning
 * - POST /entities - Create entity (global or any org)
 * - GET /entities - List entities
 * - GET /entities/:id - Get entity by ID (global or org-scoped)
 * - PATCH /entities/:id - Update entity by ID (global or org-scoped)
 * - POST /entities/:id/transition - Status transition (delete, archive, etc.)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { 
  createEntityRequestSchema, 
  updateEntityRequestSchema, 
  entityQueryParamsSchema,
  exportQuerySchema,
  bulkImportRequestSchema,
  entityTransitionRequestSchema
} from '@1cc/shared';
import { isValidTransition, getAllowedTransitions } from '@1cc/xstate-machines';
import type { BulkImportError } from '@1cc/shared';
import { 
  readJSON, writeJSON, listFiles, deleteFile,
  getEntityVersionPath, getEntityLatestPath, getEntityStubPath, 
  getEntityTypePath, getOrgPermissionsPath, getOrgProfilePath, getBundlePath,
  getOrgMemberBundlePath, getOrgAdminBundlePath, getGlobalAdminBundlePath
} from '../../lib/r2';
import { regenerateEntityBundles, loadAppConfig } from '../../lib/bundle-invalidation';
import { upsertSlugIndex, deleteSlugIndex, readSlugIndex } from '../../lib/slug-index';
import { findOrgBySlug } from '../../lib/organizations';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId } from '../../lib/id';
import { requireAbility } from '../../middleware/casl';
import type { AppAbility } from '../../lib/abilities';
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '../../middleware/error';
import { validateEntityData, validateEntityFields, checkSlugUniqueness } from '../../lib/entity-validation';
import type { 
  Entity, EntityStub, EntityLatestPointer, EntityType, EntityListItem,
  EntityTypePermissions, VisibilityScope, EntityStatus, EntityBundle, BundleEntity,
  Organization
} from '@1cc/shared';

export const superEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entities/export
 * Export entities for a type (superadmin only)
 * Returns entities with the entity type schema for CSV template generation
 * Uses bundles to aggregate entities (same approach as listing endpoint)
 */
superEntityRoutes.get('/entities/export',
  requireAbility('read', 'Entity'),
  zValidator('query', exportQuerySchema),
  async (c) => {
  console.log('[SuperEntities] Export handler called');
  
  const query = c.req.valid('query');
  console.log('[SuperEntities] Exporting entities for type:', query.typeId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity type definition - CASL verifies superadmin can read entity types
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(query.typeId),
    ability,
    'read',
    'EntityType'
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', query.typeId);
  }
  
  // Collect bundle entities (same approach as listing endpoint)
  const bundleEntityMap = new Map<string, { bundleEntity: BundleEntity; organizationId: string | null; visibility: VisibilityScope }>();
  
  // 1. Load global bundles (public and platform)
  console.log('[SuperEntities] Loading global bundles for export - type:', query.typeId);
  
  const publicBundlePath = getBundlePath('public', query.typeId);
  const publicBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, publicBundlePath, ability, 'read', 'Entity');
  if (publicBundle) {
    console.log('[SuperEntities] Loaded public bundle with', publicBundle.entities.length, 'entities');
    for (const bundleEntity of publicBundle.entities) {
      if (!bundleEntityMap.has(bundleEntity.id)) {
        bundleEntityMap.set(bundleEntity.id, {
          bundleEntity,
          organizationId: null,
          visibility: 'public'
        });
      }
    }
  }
  
  const platformBundlePath = getBundlePath('platform', query.typeId);
  const platformBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, platformBundlePath, ability, 'read', 'Entity');
  if (platformBundle) {
    console.log('[SuperEntities] Loaded platform bundle with', platformBundle.entities.length, 'entities');
    for (const bundleEntity of platformBundle.entities) {
      if (!bundleEntityMap.has(bundleEntity.id)) {
        bundleEntityMap.set(bundleEntity.id, {
          bundleEntity,
          organizationId: null,
          visibility: 'authenticated'
        });
      }
    }
  }
  
  // Load global admin bundles (draft + deleted entities) for public and platform
  // Admin bundles include all draft/deleted entities regardless of visibility
  console.log('[SuperEntities] Loading global admin bundles for export - type:', query.typeId);
  
  const publicAdminBundlePath = getGlobalAdminBundlePath('public', query.typeId);
  const publicAdminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, publicAdminBundlePath, ability, 'read', 'Entity');
  if (publicAdminBundle) {
    console.log('[SuperEntities] Loaded public admin bundle with', publicAdminBundle.entities.length, 'entities');
    for (const bundleEntity of publicAdminBundle.entities) {
      if (!bundleEntityMap.has(bundleEntity.id)) {
        bundleEntityMap.set(bundleEntity.id, {
          bundleEntity,
          organizationId: null,
          visibility: 'public'
        });
      }
    }
  }
  
  const platformAdminBundlePath = getGlobalAdminBundlePath('platform', query.typeId);
  const platformAdminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, platformAdminBundlePath, ability, 'read', 'Entity');
  if (platformAdminBundle) {
    console.log('[SuperEntities] Loaded platform admin bundle with', platformAdminBundle.entities.length, 'entities');
    for (const bundleEntity of platformAdminBundle.entities) {
      if (!bundleEntityMap.has(bundleEntity.id)) {
        bundleEntityMap.set(bundleEntity.id, {
          bundleEntity,
          organizationId: null,
          visibility: 'authenticated'
        });
      }
    }
  }
  
  // 2. Load all organization bundles
  console.log('[SuperEntities] Loading organization bundles for export - type:', query.typeId);
  
  // CASL verifies superadmin can list orgs
  const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`, ability);
  const orgIds = new Set<string>();
  
  // Extract organization IDs from file paths
  for (const file of orgFiles) {
    const match = file.match(/orgs\/([^\/]+)\//);
    if (match) {
      orgIds.add(match[1]);
    }
  }
  
  console.log('[SuperEntities] Found', orgIds.size, 'organizations');
  
  // Load all organization bundles first (don't filter inside the loop)
  for (const orgId of orgIds) {
    // Load member bundle (published entities) - CASL verifies superadmin can read org bundles
    const memberBundlePath = getOrgMemberBundlePath(orgId, query.typeId);
    const memberBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, memberBundlePath, ability, 'read', 'Entity');
    if (memberBundle) {
      console.log('[SuperEntities] Loaded member bundle for org', orgId, 'with', memberBundle.entities.length, 'entities');
      for (const bundleEntity of memberBundle.entities) {
        if (!bundleEntityMap.has(bundleEntity.id)) {
          bundleEntityMap.set(bundleEntity.id, {
            bundleEntity,
            organizationId: orgId,
            visibility: 'members'
          });
        }
      }
    }
    
    // Load admin bundle (draft + deleted entities) - superadmins can see these
    // CASL verifies superadmin can read org bundles
    const adminBundlePath = getOrgAdminBundlePath(orgId, query.typeId);
    const adminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, adminBundlePath, ability, 'read', 'Entity');
    if (adminBundle) {
      console.log('[SuperEntities] Loaded admin bundle for org', orgId, 'with', adminBundle.entities.length, 'entities');
      for (const bundleEntity of adminBundle.entities) {
        if (!bundleEntityMap.has(bundleEntity.id)) {
          bundleEntityMap.set(bundleEntity.id, {
            bundleEntity,
            organizationId: orgId,
            visibility: 'members'
          });
        }
      }
    }
  }
  
  // 3. Filter bundle entities AFTER collecting all entities (same approach as listing endpoint)
  let filteredBundleEntities = Array.from(bundleEntityMap.values());
  
  // Filter by organization if specified
  if (query.organizationId !== undefined) {
    filteredBundleEntities = filteredBundleEntities.filter(item => {
      if (query.organizationId === null) {
        return item.organizationId === null;
      }
      return item.organizationId === query.organizationId;
    });
  }
  
  // Filter by status if specified
  if (query.status) {
    filteredBundleEntities = filteredBundleEntities.filter(item => item.bundleEntity.status === query.status);
  }
  
  console.log('[SuperEntities] Aggregated', bundleEntityMap.size, 'entities from bundles,', filteredBundleEntities.length, 'after filters');
  
  // 4. Load full Entity objects from R2
  // Use latest pointer approach to get current version (bundles might have stale version)
  const entities: Entity[] = [];
  const missingEntityIds: string[] = [];
  
  console.log('[SuperEntities] Attempting to load', filteredBundleEntities.length, 'entities from bundle entries');
  console.log('[SuperEntities] Bundle entity IDs:', filteredBundleEntities.map(e => `${e.bundleEntity.id} (org: ${e.organizationId ?? 'null'})`).join(', '));
  
  for (const { bundleEntity, organizationId, visibility } of filteredBundleEntities) {
    let entity: Entity | null = null;
    let latestPointer: EntityLatestPointer | null = null;
    
    // Get latest pointer to get current version - CASL verifies superadmin can read entities
    if (organizationId === null) {
      // Global entity - try both public and authenticated paths (bundle might have wrong visibility)
      for (const checkVisibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(checkVisibility, bundleEntity.id, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        
        if (latestPointer) {
          const versionPath = getEntityVersionPath(checkVisibility, bundleEntity.id, latestPointer.version, undefined);
          console.log('[SuperEntities] Loading global entity:', bundleEntity.id, 'visibility:', checkVisibility, 'version:', latestPointer.version, 'path:', versionPath);
          entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
          if (entity) break; // Found entity, stop searching
        }
      }
    } else {
      // Org entity - always use members path - CASL verifies superadmin can read org entities
      const latestPath = getEntityLatestPath('members', bundleEntity.id, organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
      
      if (latestPointer) {
        const versionPath = getEntityVersionPath('members', bundleEntity.id, latestPointer.version, organizationId);
        console.log('[SuperEntities] Loading org entity:', bundleEntity.id, 'org:', organizationId, 'version:', latestPointer.version, 'path:', versionPath);
        entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
      }
    }
    
    if (entity) {
      entities.push(entity);
      console.log('[SuperEntities] ✓ Successfully loaded entity:', bundleEntity.id, 'name:', bundleEntity.name);
    } else {
      const versionInfo = latestPointer ? `latest version ${latestPointer.version}` : 'no latest pointer';
      console.warn('[SuperEntities] ✗ Entity file not found for bundle entity:', bundleEntity.id, 'name:', bundleEntity.name, 'org:', organizationId, versionInfo);
      missingEntityIds.push(bundleEntity.id);
    }
  }
  
  // Sort by createdAt
  entities.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  // 5. Load organization slugs for all unique org IDs (for export)
  console.log('[SuperEntities] Loading organization slugs for export');
  const orgSlugMap = new Map<string, string>(); // orgId -> orgSlug
  const uniqueOrgIds = new Set<string>();
  for (const entity of entities) {
    if (entity.organizationId !== null && entity.organizationId !== undefined) {
      uniqueOrgIds.add(entity.organizationId);
    }
  }
  
  console.log('[SuperEntities] Found', uniqueOrgIds.size, 'unique organizations to load slugs for');
  for (const orgId of uniqueOrgIds) {
    try {
      const orgPath = getOrgProfilePath(orgId);
      // CASL verifies superadmin can read org profiles
      const org = await readJSON<Organization>(c.env.R2_BUCKET, orgPath, ability, 'read', 'Organization');
      if (org && org.slug) {
        orgSlugMap.set(orgId, org.slug);
        console.log('[SuperEntities] Loaded org slug for', orgId, ':', org.slug);
      } else {
        console.warn('[SuperEntities] Organization profile not found or missing slug for:', orgId);
      }
    } catch (error) {
      console.warn('[SuperEntities] Error loading organization profile for', orgId, ':', error);
    }
  }
  
  // Add organization slugs to entities (computed field, not stored in entity)
  const entitiesWithOrgSlugs = entities.map(entity => {
    const orgSlug = entity.organizationId ? orgSlugMap.get(entity.organizationId) : undefined;
    return {
      ...entity,
      organizationSlug: orgSlug || null // Add computed organization slug
    };
  });
  
  console.log('[SuperEntities] Exporting', entities.length, 'entities for type:', query.typeId);
  if (missingEntityIds.length > 0) {
    console.warn('[SuperEntities] WARNING:', missingEntityIds.length, 'entity/entities from bundles had missing files and were skipped:', missingEntityIds.join(', '));
    console.warn('[SuperEntities] This indicates a data integrity issue - entities exist in bundles but their data files are missing');
  }
  if (entities.length > 0) {
    console.log('[SuperEntities] Entity IDs being exported:', entities.map(e => e.id));
    console.log('[SuperEntities] Entity names being exported:', entities.map(e => e.name));
  } else {
    console.log('[SuperEntities] WARNING: No entities found for type:', query.typeId);
  }
  
  return c.json({
    success: true,
    data: {
      entityType: {
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug,
        fields: entityType.fields,
        sections: entityType.sections
      },
      entities: entitiesWithOrgSlugs, // Include organization slugs in export
      exportedAt: new Date().toISOString()
    }
  });
});

/**
 * Resolve organization ID from slug or ID
 * Returns organization ID if found, null if global entity, or undefined if not found
 */
async function resolveOrganizationId(
  bucket: R2Bucket,
  orgValue: string | null | undefined,
  ability: AppAbility | null
): Promise<string | null | undefined> {
  console.log('[SuperEntities] Resolving organization ID from value:', orgValue);
  
  if (orgValue === null || orgValue === undefined || orgValue === '') {
    console.log('[SuperEntities] Organization value is null/undefined/empty - treating as global entity');
    return null; // Global entity
  }
  
  // If it's a valid ID format (7 chars alphanumeric), use as-is
  if (/^[a-z0-9]{7}$/.test(orgValue)) {
    console.log('[SuperEntities] Organization value looks like ID format, verifying existence:', orgValue);
    // Verify org exists by checking profile - CASL verifies access
    const orgPath = getOrgProfilePath(orgValue);
    const org = await readJSON<Organization>(bucket, orgPath, ability, 'read', 'Organization');
    if (org) {
      console.log('[SuperEntities] Organization ID verified:', orgValue, 'slug:', org.slug);
      return orgValue;
    }
    console.warn('[SuperEntities] Organization ID not found:', orgValue);
    return undefined;
  }
  
  // Try slug lookup
  console.log('[SuperEntities] Attempting slug lookup for:', orgValue);
  const org = await findOrgBySlug(bucket, orgValue);
  if (org) {
    console.log('[SuperEntities] Organization found by slug:', orgValue, '->', org.id);
    return org.id;
  }
  
  console.warn('[SuperEntities] Organization not found by slug:', orgValue);
  return undefined;
}

/**
 * Find entity by ID or slug
 * Returns entity and entityId if found, null values if not found
 */
async function findEntityByIdOrSlug(
  bucket: R2Bucket,
  entityTypeId: string,
  organizationId: string | null,
  entityValue: string,
  ability: AppAbility | null
): Promise<{ entity: Entity | null; entityId: string | null }> {
  console.log('[SuperEntities] Finding entity by ID or slug:', entityValue, 'type:', entityTypeId, 'org:', organizationId);
  
  // Try ID first (7 chars alphanumeric)
  if (/^[a-z0-9]{7}$/.test(entityValue)) {
    console.log('[SuperEntities] Entity value looks like ID format, checking stub:', entityValue);
    const stub = await readJSON<EntityStub>(bucket, getEntityStubPath(entityValue), ability, 'read', 'Entity');
    if (stub && stub.entityTypeId === entityTypeId) {
      // Load entity to verify org matches - CASL verifies access
      let latestPointer: EntityLatestPointer | null = null;
      if (stub.organizationId === null) {
        for (const visibility of ['public', 'authenticated'] as const) {
          const latestPath = getEntityLatestPath(visibility, entityValue, undefined);
          latestPointer = await readJSON<EntityLatestPointer>(bucket, latestPath, ability, 'read', 'Entity');
          if (latestPointer) break;
        }
      } else {
        const latestPath = getEntityLatestPath('members', entityValue, stub.organizationId);
        latestPointer = await readJSON<EntityLatestPointer>(bucket, latestPath, ability, 'read', 'Entity');
      }
      
      if (latestPointer) {
        const storageVisibility: VisibilityScope = stub.organizationId === null 
          ? latestPointer.visibility 
          : 'members';
        const entityPath = getEntityVersionPath(storageVisibility, entityValue, latestPointer.version, stub.organizationId || undefined);
        const entity = await readJSON<Entity>(bucket, entityPath, ability, 'read', 'Entity');
        if (entity && entity.organizationId === organizationId) {
          console.log('[SuperEntities] Entity found by ID:', entityValue, 'name:', entity.name);
          return { entity, entityId: entityValue };
        } else if (entity && entity.organizationId !== organizationId) {
          console.warn('[SuperEntities] Entity ID found but organization mismatch:', entityValue, 'expected org:', organizationId, 'actual org:', entity.organizationId);
        }
      }
    } else if (stub && stub.entityTypeId !== entityTypeId) {
      console.warn('[SuperEntities] Entity ID found but entity type mismatch:', entityValue, 'expected type:', entityTypeId, 'actual type:', stub.entityTypeId);
    }
  }
  
  // Try slug lookup using slug index (only for org entities - global entities don't have slug index)
  if (organizationId !== null && organizationId !== undefined) {
    console.log('[SuperEntities] Attempting slug lookup for org entity:', entityValue, 'org:', organizationId);
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId), ability, 'read', 'EntityType');
    if (entityType) {
      const slugIndex = await readSlugIndex(bucket, organizationId, entityType.slug, entityValue, ability);
      if (slugIndex && slugIndex.entityId) {
        console.log('[SuperEntities] Slug index found for:', entityValue, '-> entity ID:', slugIndex.entityId);
        // Load entity by ID from slug index - CASL verifies access
        const stub = await readJSON<EntityStub>(bucket, getEntityStubPath(slugIndex.entityId), ability, 'read', 'Entity');
        if (stub && stub.entityTypeId === entityTypeId && stub.organizationId === organizationId) {
          // Load full entity - CASL verifies access
          let latestPointer: EntityLatestPointer | null = null;
          const latestPath = getEntityLatestPath('members', slugIndex.entityId, organizationId);
          latestPointer = await readJSON<EntityLatestPointer>(bucket, latestPath, ability, 'read', 'Entity');
          
          if (latestPointer) {
            const entityPath = getEntityVersionPath('members', slugIndex.entityId, latestPointer.version, organizationId);
            const entity = await readJSON<Entity>(bucket, entityPath, ability, 'read', 'Entity');
            if (entity) {
              console.log('[SuperEntities] Entity found by slug:', entityValue, '-> entity ID:', slugIndex.entityId, 'name:', entity.name);
              return { entity, entityId: slugIndex.entityId };
            }
          }
        } else {
          console.warn('[SuperEntities] Slug index found but entity stub mismatch:', entityValue);
        }
      }
    }
  } else {
    console.log('[SuperEntities] Global entities do not support slug lookup (slug index only for org entities)');
  }
  
  console.log('[SuperEntities] Entity not found by ID or slug:', entityValue);
  return { entity: null, entityId: null };
}

/**
 * POST /entities/bulk-import
 * Bulk import entities (superadmin only)
 * Atomic operation: validates ALL entities first, only creates if ALL pass
 * Supports per-row organizationId, slug, and entity ID for versioning
 */
superEntityRoutes.post('/entities/bulk-import',
  requireAbility('create', 'Entity'),
  zValidator('json', bulkImportRequestSchema),
  async (c) => {
  console.log('[SuperEntities] Bulk importing entities');
  
  const { 
    entityTypeId, 
    organizationId: defaultOrgId, 
    importMode = 'add-new',
    updateMode = 'increment-version',
    entities: importEntities 
  } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[SuperEntities] Import mode:', importMode, 'Update mode:', updateMode);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity type definition - CASL verifies superadmin can read entity types
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(entityTypeId),
    ability,
    'read',
    'EntityType'
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Resolve default organization ID (if provided as slug or ID)
  let resolvedDefaultOrgId: string | null | undefined;
  if (defaultOrgId !== undefined) {
    resolvedDefaultOrgId = await resolveOrganizationId(c.env.R2_BUCKET, defaultOrgId, ability);
    if (resolvedDefaultOrgId === undefined) {
      console.warn('[SuperEntities] Default organization not found:', defaultOrgId, '- treating as null');
      resolvedDefaultOrgId = null;
    }
  }
  
  // Collect unique organization IDs from all entities for permission validation
  // Note: We'll resolve org slugs in the validation loop
  const uniqueOrgIds = new Set<string>();
  
  // Check organization permissions for all unique orgs - CASL verifies access
  for (const orgId of uniqueOrgIds) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(orgId),
      ability,
      'read',
      'Organization'
    );
    
    if (!permissions?.creatable.includes(entityTypeId)) {
      throw new ForbiddenError(`Organization ${orgId} cannot create entities of this type`);
    }
  }
  
  // Phase 1: Validate ALL entities and check which are creates vs updates
  const validationErrors: BulkImportError[] = [];
  
  // Categorize entities: create new, update existing, or create with specific ID
  type ValidatedEntity = {
    rowIndex: number;
    data: Record<string, unknown>; // Dynamic fields only (name and slug removed)
    name: string;
    visibility: VisibilityScope;
    slug: string;
    organizationId: string | null;
    mode: 'create' | 'update' | 'create-with-id';
    entityId?: string;
    existingEntity?: Entity;
    existingVersion?: number;
    updateMode: 'in-place' | 'increment-version'; // Update mode for this entity
  };
  
  const validatedEntities: ValidatedEntity[] = [];
  
  // Collect existing slugs for uniqueness validation (only for new entities)
  const existingSlugs = new Map<string, string>(); // key: "orgId|slug", value: entityId that owns it
  const batchNewSlugs = new Map<string, number>(); // key: "orgId|slug", value: row index
  
  // First pass: Load existing slugs for this entity type - CASL verifies access
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`, ability);
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile, ability, 'read', 'Entity');
    if (!stub || stub.entityTypeId !== entityTypeId) continue;
    
    // Get entity to read its slug - CASL verifies access
    let latestPointer: EntityLatestPointer | null = null;
    if (stub.organizationId === null) {
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        if (latestPointer) break;
      }
    } else {
      const latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
    }
    
    if (latestPointer) {
      const storageVisibility: VisibilityScope = stub.organizationId === null 
        ? latestPointer.visibility 
        : 'members';
      const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
      const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath, ability, 'read', 'Entity');
      if (entity) {
        // Slug is stored at top-level
        const entitySlug = entity.slug || '';
        const slugKey = `${stub.organizationId || 'global'}|${entitySlug}`;
        existingSlugs.set(slugKey, entity.id);
      }
    }
  }
  
  for (let i = 0; i < importEntities.length; i++) {
    const importEntity = importEntities[i];
    
    // Resolve organization ID (per-row takes precedence, support slug or ID)
    let entityOrgId: string | null | undefined;
    if (importEntity.organizationId !== undefined) {
      // Use organizationId if provided
      entityOrgId = await resolveOrganizationId(c.env.R2_BUCKET, importEntity.organizationId, ability);
    } else if (importEntity.organizationSlug !== undefined && importEntity.organizationSlug !== '') {
      // Use organizationSlug if provided and organizationId is not
      entityOrgId = await resolveOrganizationId(c.env.R2_BUCKET, importEntity.organizationSlug, ability);
    } else {
      // Use default
      entityOrgId = resolvedDefaultOrgId ?? null;
    }
    
    if (entityOrgId === undefined) {
      // Organization not found (only happens when orgSlug/orgId was provided but invalid)
      const orgValue = importEntity.organizationId || importEntity.organizationSlug;
      validationErrors.push({
        rowIndex: i,
        field: importEntity.organizationSlug ? 'organizationSlug' : 'organizationId',
        message: `Organization not found: ${orgValue}`
      });
      continue;
    }
    
    // Add to unique org IDs set for permission check
    if (entityOrgId !== null) {
      uniqueOrgIds.add(entityOrgId);
    }
    
    // Determine update mode for this entity (per-entity override or global default)
    const entityUpdateMode = importEntity.updateMode || updateMode;
    
    // Check if entity ID or slug is provided for lookup
    const providedId = importEntity.id;
    const providedSlug = importEntity.slug;
    let mode: 'create' | 'update' | 'create-with-id' = 'create';
    let existingEntity: Entity | undefined;
    let existingVersion: number | undefined;
    let resolvedEntityId: string | undefined;
    
    // Try to find entity by ID or slug
    if (providedId) {
      // Try ID first
      const { entity: foundEntity, entityId: foundId } = await findEntityByIdOrSlug(
        c.env.R2_BUCKET,
        entityTypeId,
        entityOrgId,
        providedId,
        ability
      );
      
      if (foundEntity && foundId) {
        // Entity exists - this is an update
        mode = 'update';
        existingEntity = foundEntity;
        resolvedEntityId = foundId;
        
        // Get current version - CASL verifies access
        let latestPointer: EntityLatestPointer | null = null;
        if (foundEntity.organizationId === null) {
          for (const visibility of ['public', 'authenticated'] as const) {
            const latestPath = getEntityLatestPath(visibility, foundId, undefined);
            latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
            if (latestPointer) break;
          }
        } else {
          const latestPath = getEntityLatestPath('members', foundId, foundEntity.organizationId);
          latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        }
        
        if (latestPointer) {
          existingVersion = latestPointer.version;
        }
      } else {
        // Entity doesn't exist - create with this specific ID
        mode = 'create-with-id';
        resolvedEntityId = providedId;
      }
    } else if (providedSlug && entityOrgId !== null) {
      // Try slug lookup (only for org entities - global entities don't support slug lookup)
      const { entity: foundEntity, entityId: foundId } = await findEntityByIdOrSlug(
        c.env.R2_BUCKET,
        entityTypeId,
        entityOrgId,
        providedSlug,
        ability
      );
      
      if (foundEntity && foundId) {
        // Entity exists - this is an update
        mode = 'update';
        existingEntity = foundEntity;
        resolvedEntityId = foundId;
        
        // Get current version - CASL verifies access
        const latestPath = getEntityLatestPath('members', foundId, entityOrgId);
        const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        if (latestPointer) {
          existingVersion = latestPointer.version;
        }
      }
    }
    
    // Handle import mode restrictions
    if (importMode === 'update' && mode !== 'update') {
      // Update mode requires entity to exist
      if (!providedId && !providedSlug) {
        validationErrors.push({
          rowIndex: i,
          field: 'id',
          message: 'Entity ID or slug is required in update mode'
        });
        continue;
      }
      validationErrors.push({
        rowIndex: i,
        field: providedId ? 'id' : 'slug',
        message: `Entity not found: ${providedId || providedSlug} (update mode requires existing entity)`
      });
      continue;
    }
    
    if (importMode === 'add-new' && mode === 'update') {
      // Add-new mode doesn't allow updates - check shouldUpdate flag
      if (!importEntity.shouldUpdate) {
        // Create new entity with different slug/ID
        mode = 'create';
        existingEntity = undefined;
        existingVersion = undefined;
        resolvedEntityId = undefined;
      } else {
        // shouldUpdate=true allows update even in add-new mode (mixed behavior)
        // Keep update mode
      }
    }
    
    // Handle mixed mode with shouldUpdate flag
    if (importMode === 'mixed') {
      if (importEntity.shouldUpdate && mode !== 'update') {
        // shouldUpdate=true but entity doesn't exist
        validationErrors.push({
          rowIndex: i,
          field: 'id',
          message: `Entity not found: ${providedId || providedSlug || 'N/A'} (shouldUpdate=true requires existing entity)`
        });
        continue;
      }
      if (!importEntity.shouldUpdate && mode === 'update') {
        // shouldUpdate=false but entity exists - create new instead
        mode = 'create';
        existingEntity = undefined;
        existingVersion = undefined;
        resolvedEntityId = undefined;
      }
    }
    
    try {
      // Validate each field individually
      const validatedData = validateEntityFields(importEntity.data, entityType);
      
      // Final validation to ensure required fields are present
      validateEntityData(validatedData, entityType);
      
      // Determine visibility
      let finalVisibility: VisibilityScope = importEntity.visibility || entityType.defaultVisibility;
      // Global entities cannot have 'members' visibility
      if (entityOrgId === null && finalVisibility === 'members') {
        finalVisibility = 'authenticated';
      }
      
      // Extract name and slug from validatedData (common properties, stored at top-level)
      // Name and slug can be provided at entity level or in data field
      let entityName: string;
      
      // Check validatedData.name first (from data.name)
      if (validatedData.name !== undefined && validatedData.name !== null) {
        const nameStr = String(validatedData.name).trim();
        if (nameStr === '') {
          // Name exists but is empty
          validationErrors.push({
            rowIndex: i,
            field: 'name',
            message: 'Name cannot be empty'
          });
          continue;
        }
        entityName = nameStr;
      } else if (mode === 'update' && existingEntity) {
        // For updates without name in data, keep existing name from top-level
        entityName = existingEntity.name || '';
        if (!entityName || entityName.trim() === '') {
          validationErrors.push({
            rowIndex: i,
            field: 'name',
            message: 'Name cannot be empty (existing entity has no name)'
          });
          continue;
        }
      } else {
        // Name is missing entirely
        validationErrors.push({
          rowIndex: i,
          field: 'name',
          message: 'Name is required and must be provided'
        });
        continue;
      }
      
      let slug: string;
      if (importEntity.slug) {
        // Slug provided at entity level (already validated by Zod schema)
        slug = importEntity.slug.trim();
      } else if (validatedData.slug && typeof validatedData.slug === 'string') {
        // Slug in data field
        slug = validatedData.slug.trim();
      } else if (mode === 'update' && existingEntity) {
        // For updates without slug, keep existing slug from top-level
        slug = existingEntity.slug || '';
      } else {
        // Slug is required for new entities
        validationErrors.push({
          rowIndex: i,
          field: 'slug',
          message: 'Slug is required for new entities'
        });
        continue;
      }
      
      // Validate slug is not empty
      if (!slug || slug.trim() === '') {
        validationErrors.push({
          rowIndex: i,
          field: 'slug',
          message: 'Slug cannot be empty'
        });
        continue;
      }
      
      // Remove name and slug from validatedData before storing in data
      // They are stored at top-level, not in the dynamic data object
      const { name: _, slug: __, ...entityData } = validatedData;
      
      // Validate slug uniqueness for new entities (create or create-with-id)
      if (mode !== 'update') {
        const slugKey = `${entityOrgId || 'global'}|${slug}`;
        
        // Check against existing slugs in database
        const existingOwner = existingSlugs.get(slugKey);
        if (existingOwner && existingOwner !== resolvedEntityId) {
          validationErrors.push({
            rowIndex: i,
            field: 'slug',
            message: `Slug '${slug}' already exists for this entity type and organization`
          });
          continue;
        }
        
        // Check against other new entities in this batch
        const batchDuplicate = batchNewSlugs.get(slugKey);
        if (batchDuplicate !== undefined) {
          validationErrors.push({
            rowIndex: i,
            field: 'slug',
            message: `Duplicate slug '${slug}' - already used in row ${batchDuplicate + 1} of this import`
          });
          continue;
        }
        
        // Track this slug for batch duplicate detection
        batchNewSlugs.set(slugKey, i);
      }
      
      validatedEntities.push({
        rowIndex: i,
        data: entityData, // Dynamic fields only (name and slug removed)
        name: entityName.trim(),
        visibility: finalVisibility,
        slug: slug.trim(),
        organizationId: entityOrgId,
        mode,
        entityId: resolvedEntityId,
        existingEntity,
        existingVersion,
        updateMode: entityUpdateMode
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        // Extract field-specific errors if available
        const details = error.details as { fields?: string[] } | undefined;
        if (details?.fields && Array.isArray(details.fields)) {
          for (const fieldError of details.fields) {
            validationErrors.push({
              rowIndex: i,
              message: fieldError
            });
          }
        } else {
          validationErrors.push({
            rowIndex: i,
            message: error.message
          });
        }
      } else {
        validationErrors.push({
          rowIndex: i,
          message: error instanceof Error ? error.message : 'Unknown validation error'
        });
      }
    }
  }
  
  // If any validation errors, return them all (atomic - no entities created/updated)
  if (validationErrors.length > 0) {
    console.log('[SuperEntities] Bulk import validation failed:', validationErrors.length, 'errors');
    return c.json({
      success: false,
      errors: validationErrors
    }, 400);
  }
  
  // Phase 2: Create/Update all entities (all validation passed)
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const now = new Date().toISOString();
  
  for (const validated of validatedEntities) {
    if (validated.mode === 'update' && validated.existingEntity && validated.existingVersion !== undefined) {
      // Update existing entity
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const entityId = validated.entityId!;
      
      if (validated.updateMode === 'in-place') {
        // Update in-place: overwrite existing version
        console.log('[SuperEntities] Updating entity in-place:', entityId, 'version:', validated.existingVersion);
        
        const updatedEntity: Entity = {
          ...validated.existingEntity,
          version: validated.existingVersion, // Keep same version
          visibility: validated.visibility,
          name: validated.name,
          slug: validated.slug,
          data: validated.data, // Dynamic fields only (name and slug removed)
          updatedAt: now, // Update timestamp
          updatedBy: userId
        };
        
        // Overwrite existing version file - CASL verifies superadmin can write entities
        const versionPath = getEntityVersionPath(storageVisibility, entityId, validated.existingVersion, validated.organizationId || undefined);
        await writeJSON(c.env.R2_BUCKET, versionPath, updatedEntity, ability);
        
        // Update latest pointer (version unchanged) - CASL verifies superadmin can write entities
        const latestPath = getEntityLatestPath(storageVisibility, entityId, validated.organizationId || undefined);
        const currentPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        const latestPointer: EntityLatestPointer = {
          ...currentPointer!,
          visibility: validated.visibility,
          updatedAt: now
        };
        await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer, ability);
      } else {
        // Increment version: create new version (current behavior)
        console.log('[SuperEntities] Updating entity with new version:', entityId, 'from version:', validated.existingVersion);
        const newVersion = validated.existingVersion + 1;
        
        const updatedEntity: Entity = {
          ...validated.existingEntity,
          version: newVersion,
          visibility: validated.visibility,
          name: validated.name,
          slug: validated.slug,
          data: validated.data, // Dynamic fields only (name and slug removed)
          updatedAt: now,
          updatedBy: userId
        };
        
        // Write new version - CASL verifies superadmin can write entities
        const versionPath = getEntityVersionPath(storageVisibility, entityId, newVersion, validated.organizationId || undefined);
        await writeJSON(c.env.R2_BUCKET, versionPath, updatedEntity, ability);
        
        // Update latest pointer - CASL verifies superadmin can write entities
        const latestPointer: EntityLatestPointer = {
          version: newVersion,
          status: validated.existingEntity.status, // Keep existing status
          visibility: validated.visibility,
          updatedAt: now
        };
        
        const latestPath = getEntityLatestPath(storageVisibility, entityId, validated.organizationId || undefined);
        await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer, ability);
      }
      
      updatedIds.push(entityId);
    } else {
      // Create new entity (with generated ID or specific ID)
      const entityId = validated.entityId || createEntityId();
      
      const entity: Entity = {
        id: entityId,
        entityTypeId,
        organizationId: validated.organizationId,
        version: 1,
        status: 'draft',
        visibility: validated.visibility,
        name: validated.name,
        slug: validated.slug,
        data: validated.data, // Dynamic fields only (name and slug removed)
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId
      };
      
      // Write entity stub
      const stub: EntityStub = {
        entityId,
        organizationId: validated.organizationId,
        entityTypeId,
        createdAt: now
      };
      
      // CASL verifies superadmin can write entities
      await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub, ability);
      
      // Write entity version - CASL verifies superadmin can write entities
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, versionPath, entity, ability);
      
      // Write latest pointer - CASL verifies superadmin can write entities
      const latestPointer: EntityLatestPointer = {
        version: 1,
        status: 'draft',
        visibility: validated.visibility,
        updatedAt: now
      };
      
      const latestPath = getEntityLatestPath(storageVisibility, entityId, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer, ability);
      
      createdIds.push(entityId);
    }
  }
  
  console.log('[SuperEntities] Bulk import complete - created:', createdIds.length, 'updated:', updatedIds.length);
  
  // Regenerate bundles for all affected orgs after bulk import
  const orgVisibilityCombos = new Map<string, Set<VisibilityScope>>();
  
  for (const validated of validatedEntities) {
    const key = validated.organizationId || 'global';
    if (!orgVisibilityCombos.has(key)) {
      orgVisibilityCombos.set(key, new Set());
    }
    orgVisibilityCombos.get(key)!.add(validated.visibility);
  }
  
  const config = await loadAppConfig(c.env.R2_BUCKET);
  for (const [orgKey, visibilities] of orgVisibilityCombos) {
    const orgId = orgKey === 'global' ? null : orgKey;
    for (const visibility of visibilities) {
      console.log('[SuperEntities] Regenerating bundles for bulk import - org:', orgKey, 'visibility:', visibility);
      await regenerateEntityBundles(c.env.R2_BUCKET, entityTypeId, orgId, config);
    }
  }
  
  return c.json({
    success: true,
    data: {
      created: createdIds,
      updated: updatedIds,
      count: createdIds.length + updatedIds.length
    }
  }, 201);
});

/**
 * POST /entities
 * Create entity (supports global entities with organizationId: null)
 * 
 * Request body:
 * - name: string (required) - entity name, stored at entity.name
 * - slug: string (required) - entity slug, stored at entity.slug
 * - entityTypeId: string (required) - the entity type ID
 * - data: object (optional) - dynamic fields only, stored at entity.data
 * - visibility: string (optional) - visibility scope
 * - organizationId: string | null (optional) - null for global entities
 */
superEntityRoutes.post('/entities',
  requireAbility('create', 'Entity'),
  zValidator('json', createEntityRequestSchema),
  async (c) => {
  const { entityTypeId, name, slug, data, visibility, organizationId: requestedOrgId } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[SuperEntities] Creating entity:', { name, slug, entityTypeId, orgId: requestedOrgId });
  
  // Superadmins can create global entities (null orgId) or entities in any org
  const targetOrgId: string | null = requestedOrgId ?? null;
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity type - CASL verifies superadmin can read entity types
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entityTypeId), ability, 'read', 'EntityType');
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate dynamic fields (name and slug are already validated by schema)
  const entityData = data ? validateEntityFields(data, entityType) : {};
  
  // Remove name and slug from entityData if accidentally included
  delete entityData.name;
  delete entityData.slug;
  
  // Determine visibility - global entities cannot be 'members' visibility
  let finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  if (targetOrgId === null && finalVisibility === 'members') {
    finalVisibility = 'authenticated';
    console.log('[SuperEntities] Global entity visibility changed from members to authenticated');
  }
  
  const entityId = createEntityId();
  
  // Check slug uniqueness (uses slug index - O(1) check)
  await checkSlugUniqueness(
    c.env.R2_BUCKET,
    entityTypeId,
    targetOrgId,
    slug.trim(),
    ability
  );
  
  const now = new Date().toISOString();
  
  // Create entity with name and slug at top-level
  const entity: Entity = {
    id: entityId,
    entityTypeId,
    organizationId: targetOrgId,
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    name: name.trim(),
    slug: slug.trim(),
    data: entityData, // Dynamic fields only
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId
  };
  
  const stub: EntityStub = {
    entityId,
    organizationId: targetOrgId,
    entityTypeId,
    createdAt: now
  };
  
  // CASL verifies superadmin can write entities
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub, ability);
  
  // For global entities, use visibility-based path; for org entities, use members path
  const storageVisibility: VisibilityScope = targetOrgId === null ? finalVisibility : 'members';
  const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity, ability);
  
  const latestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath(storageVisibility, entityId, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer, ability);
  
  // Create slug index for public entities
  if (finalVisibility === 'public') {
    await upsertSlugIndex(c.env.R2_BUCKET, targetOrgId, entityType.slug, slug.trim(), {
      entityId,
      visibility: finalVisibility,
      organizationId: targetOrgId,
      entityTypeId
    });
  }
  
  // Regenerate affected bundles synchronously
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    entityTypeId,
    targetOrgId,
    config
  );
  
  return c.json({ success: true, data: entity }, 201);
});

/**
 * GET /entities/:id
 * Get any entity by ID (superadmin can access global and org-scoped entities)
 * Falls back to searching bundles if stub lookup fails
 */
superEntityRoutes.get('/entities/:id', requireAbility('read', 'Entity'), async (c) => {
  const entityId = c.req.param('id');
  
  console.log('[SuperEntities] GET /entities/:id handler called for entity:', entityId);
  console.log('[SuperEntities] Request path:', c.req.path);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity stub to determine organization - CASL verifies superadmin can read entities
  const stubPath = getEntityStubPath(entityId);
  console.log('[SuperEntities] Checking stub at path:', stubPath);
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubPath, ability, 'read', 'Entity');
  
  if (!stub) {
    console.error('[SuperEntities] Entity stub not found at path:', stubPath, 'for entity:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  console.log('[SuperEntities] Found stub:', { entityId: stub.entityId, typeId: stub.entityTypeId, orgId: stub.organizationId });
  
  let entity: Entity | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  const orgId = stub.organizationId;
  
  if (orgId === null) {
    // Global entity - try authenticated (platform/) path first, then public/
    // CASL verifies superadmin can read entities
    console.log('[SuperEntities] Checking global entity paths for:', entityId);
    for (const visibility of ['authenticated', 'public'] as const) {
      const latestPath = getEntityLatestPath(visibility, entityId, undefined);
      console.log('[SuperEntities] Checking global path:', latestPath);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
      
      if (latestPointer) {
        const versionPath = getEntityVersionPath(visibility, entityId, latestPointer.version, undefined);
        console.log('[SuperEntities] Loading entity from version path:', versionPath);
        entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
        
        if (entity) {
          console.log('[SuperEntities] Global entity found in', visibility, 'path');
          break;
        }
      }
    }
  } else {
    // Org-scoped entity - try members path (most common for org entities)
    // CASL verifies superadmin can read org entities
    const latestPath = getEntityLatestPath('members', entityId, orgId!);
    console.log('[SuperEntities] Checking org entity path:', latestPath, 'for org:', orgId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
    
    if (latestPointer) {
      const versionPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
      console.log('[SuperEntities] Loading org entity from version path:', versionPath);
      entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
      if (entity) {
        console.log('[SuperEntities] Org entity found for org:', orgId);
      } else {
        console.error('[SuperEntities] Org entity file not found at path:', versionPath);
      }
    } else {
      console.error('[SuperEntities] No latest pointer found for org entity at path:', latestPath);
    }
  }
  
  if (!entity) {
    console.error('[SuperEntities] Entity file not found - checked paths:', {
      orgId,
      entityId,
      hasLatestPointer: !!latestPointer,
      latestPointerVersion: latestPointer?.version
    });
    throw new NotFoundError('Entity', entityId);
  }
  
  console.log('[SuperEntities] Successfully loaded entity:', entityId, 'name:', entity.name, 'orgId:', entity.organizationId, 'status:', entity.status);
  
  return c.json({
    success: true,
    data: entity
  });
});

/**
 * PATCH /entities/:id
 * Update any entity by ID (superadmin can update global and org-scoped entities)
 */
superEntityRoutes.patch('/entities/:id',
  requireAbility('update', 'Entity'),
  zValidator('json', updateEntityRequestSchema),
  async (c) => {
  const entityId = c.req.param('id');
  const updates = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[SuperEntities] PATCH /entities/:id -', entityId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity stub to determine organization - CASL verifies superadmin can read entities
  const stubPath = getEntityStubPath(entityId);
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubPath, ability, 'read', 'Entity');
  
  if (!stub) {
    console.log('[SuperEntities] Entity stub not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  const orgId = stub.organizationId;
  let entity: Entity | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  let storageVisibility: VisibilityScope = 'members';
  let latestPath: string;
  
  if (orgId === null) {
    // Global entity - try authenticated (platform/) path first, then public/
    // CASL verifies superadmin can read entities
    for (const visibility of ['authenticated', 'public'] as const) {
      latestPath = getEntityLatestPath(visibility, entityId, undefined);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
      
      if (latestPointer) {
        const versionPath = getEntityVersionPath(visibility, entityId, latestPointer.version, undefined);
        entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
        
        if (entity) {
          storageVisibility = visibility;
          console.log('[SuperEntities] Global entity found in', visibility, 'path');
          break;
        }
      }
    }
    // Re-set latestPath for global entity updates
    latestPath = getEntityLatestPath(storageVisibility, entityId, undefined);
  } else {
    // Org-scoped entity - try members path - CASL verifies superadmin can read org entities
    latestPath = getEntityLatestPath('members', entityId, orgId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
    
    if (latestPointer) {
      const versionPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
      entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
      storageVisibility = 'members';
      console.log('[SuperEntities] Org entity found for org:', orgId);
    }
  }
  
  if (!entity || !latestPointer) {
    console.log('[SuperEntities] Entity data not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only draft entities can be edited (superadmins can edit drafts)
  if (entity.status !== 'draft') {
    throw new AppError('INVALID_STATUS', 'Only draft entities can be edited', 400);
  }
  
  // Get entity type for validation - CASL verifies superadmin can read entity types
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entity.entityTypeId), ability, 'read', 'EntityType');
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', entity.entityTypeId);
  }
  
  // Get name and slug from top-level request (or keep existing values)
  const entityName = updates.name !== undefined ? updates.name : entity.name;
  const entitySlug = updates.slug !== undefined ? updates.slug : entity.slug;
  
  // Validate dynamic fields (name and slug are handled above)
  let entityData = entity.data;
  if (updates.data) {
    const validatedUpdates = validateEntityFields(updates.data, entityType);
    // Remove name and slug from validated updates if accidentally included
    delete validatedUpdates.name;
    delete validatedUpdates.slug;
    entityData = { ...entity.data, ...validatedUpdates };
    validateEntityData(entityData, entityType);
  }
  
  const newVersion = entity.version + 1;
  const now = new Date().toISOString();
  const newVisibility = updates.visibility || entity.visibility;
  
  // Create updated entity with name and slug at top-level
  const updatedEntity: Entity = {
    ...entity,
    version: newVersion,
    visibility: newVisibility,
    name: entityName.trim(),
    slug: entitySlug.trim(),
    data: entityData, // Dynamic fields only
    updatedAt: now,
    updatedBy: userId
  };
  
  // Write new version - CASL verifies superadmin can update entities
  const newVersionPath = getEntityVersionPath(storageVisibility, entityId, newVersion, orgId || undefined);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity, ability);
  
  // Update latest pointer - CASL verifies superadmin can update entities
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: updatedEntity.status,
    visibility: newVisibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer, ability);
  
  // Update slug index if visibility is public and slug changed
  const currentSlug = entity.slug;
  const newSlug = entitySlug.trim();
  if (newVisibility === 'public' && orgId !== null) {
    if (currentSlug !== newSlug && entity.visibility === 'public') {
      await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentSlug);
    }
    await upsertSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, newSlug, {
      entityId,
      visibility: newVisibility,
      organizationId: orgId,
      entityTypeId: entity.entityTypeId
    });
  } else if (entity.visibility === 'public' && newVisibility !== 'public' && orgId !== null) {
    await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentSlug);
  }
  
  console.log('[SuperEntities] Updated entity:', entityId, 'to v' + newVersion, 'orgId:', orgId);
  
  // Regenerate affected bundles synchronously
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    entity.entityTypeId,
    orgId,
    config
  );
  
  return c.json({
    success: true,
    data: updatedEntity
  });
});

/**
 * POST /entities/:id/transition
 * Handle status transitions for any entity (superadmin can transition global and org-scoped entities)
 * 
 * Standard Actions:
 * - submitForApproval: draft -> pending
 * - approve: pending -> published
 * - reject: pending -> draft
 * - archive: published -> archived
 * - restore: archived -> draft
 * - delete: draft -> deleted (soft delete)
 * 
 * Superadmin-only Actions:
 * - superDelete: Any status -> permanently removed (hard delete)
 *   Removes ALL entity files from R2: stub, latest pointer, all versions, slug index
 */
superEntityRoutes.post('/entities/:id/transition',
  requireAbility('approve', 'Entity'),
  zValidator('json', entityTransitionRequestSchema),
  async (c) => {
  const entityId = c.req.param('id');
  const { action, feedback } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[SuperEntities] POST /entities/:id/transition -', entityId, 'action:', action);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity stub to determine organization - CASL verifies superadmin can read entities
  const stubPath = getEntityStubPath(entityId);
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubPath, ability, 'read', 'Entity');
  
  if (!stub) {
    console.log('[SuperEntities] Entity stub not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  const orgId = stub.organizationId;
  let entity: Entity | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  let storageVisibility: VisibilityScope = 'members';
  let latestPath: string;
  
  if (orgId === null) {
    // Global entity - try authenticated (platform/) path first, then public/
    // CASL verifies superadmin can read entities
    for (const visibility of ['authenticated', 'public'] as const) {
      latestPath = getEntityLatestPath(visibility, entityId, undefined);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
      
      if (latestPointer) {
        const versionPath = getEntityVersionPath(visibility, entityId, latestPointer.version, undefined);
        entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
        
        if (entity) {
          storageVisibility = visibility;
          console.log('[SuperEntities] Global entity found in', visibility, 'path');
          break;
        }
      }
    }
    // Re-set latestPath for global entity updates
    latestPath = getEntityLatestPath(storageVisibility, entityId, undefined);
  } else {
    // Org-scoped entity - try members path - CASL verifies superadmin can read org entities
    latestPath = getEntityLatestPath('members', entityId, orgId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
    
    if (latestPointer) {
      const versionPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
      entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath, ability, 'read', 'Entity');
      storageVisibility = 'members';
      console.log('[SuperEntities] Org entity found for org:', orgId);
    }
  }
  
  if (!entity || !latestPointer) {
    console.log('[SuperEntities] Entity data not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  const currentStatus = latestPointer.status;
  
  // Handle superDelete action (hard delete - superadmin only)
  // This bypasses the normal state machine since it can be done from any state
  if (action === 'superDelete') {
    console.log('[SuperEntities] SUPER DELETE - Hard deleting entity:', entityId);
    
    // Get entity type for slug index deletion - CASL verifies superadmin can read entity types
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(stub.entityTypeId), ability, 'read', 'EntityType');
    
    // 1. Delete all version files
    // List all files in the entity directory - CASL verifies superadmin can list files
    const entityDir = orgId === null
      ? `${storageVisibility === 'public' ? 'public/' : 'platform/'}entities/${entityId}/`
      : `private/orgs/${orgId}/entities/${entityId}/`;
    
    console.log('[SuperEntities] Listing entity files in:', entityDir);
    const entityFiles = await listFiles(c.env.R2_BUCKET, entityDir, ability);
    
    for (const filePath of entityFiles) {
      console.log('[SuperEntities] Deleting version file:', filePath);
      // CASL verifies superadmin can delete entities
      await deleteFile(c.env.R2_BUCKET, filePath, ability);
    }
    
    // 2. Delete the entity stub - CASL verifies superadmin can delete entities
    console.log('[SuperEntities] Deleting entity stub:', stubPath);
    await deleteFile(c.env.R2_BUCKET, stubPath, ability);
    
    // 3. Delete slug index if entity was public
    if (entity.visibility === 'public' && entityType) {
      const entitySlug = entity.slug;
      if (entitySlug) {
        console.log('[SuperEntities] Deleting slug index for:', entitySlug);
        await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, entitySlug);
      }
    }
    
    // 4. Regenerate bundles to remove the entity from all bundles
    console.log('[SuperEntities] Regenerating bundles after hard delete');
    const config = await loadAppConfig(c.env.R2_BUCKET);
    await regenerateEntityBundles(
      c.env.R2_BUCKET,
      stub.entityTypeId,
      orgId,
      config
    );
    
    console.log('[SuperEntities] SUPER DELETE complete for entity:', entityId);
    
    return c.json({
      success: true,
      data: {
        deleted: true,
        entityId,
        action: 'superDelete',
        message: `Entity ${entityId} has been permanently deleted`
      }
    });
  }
  
  // Standard transition validation for non-superDelete actions
  if (!isValidTransition(currentStatus, action)) {
    throw new AppError(
      'INVALID_TRANSITION',
      `Cannot ${action} an entity with status '${currentStatus}'. Allowed actions: ${getAllowedTransitions(currentStatus).join(', ')}`,
      400
    );
  }
  
  // Determine new status
  const statusMap: Record<string, EntityStatus> = {
    submitForApproval: 'pending',
    approve: 'published',
    reject: 'draft',
    archive: 'archived',
    restore: 'draft',
    delete: 'deleted'
  };
  
  const newStatus = statusMap[action];
  const newVersion = entity.version + 1;
  const now = new Date().toISOString();
  
  // Create new version with updated status
  const updatedEntity: Entity = {
    ...entity,
    version: newVersion,
    status: newStatus,
    updatedAt: now,
    updatedBy: userId,
    ...((['approve', 'reject'].includes(action)) && {
      approvalFeedback: feedback || undefined,
      approvalActionAt: now,
      approvalActionBy: userId
    })
  };
  
  // Write new version - CASL verifies superadmin can update entities
  const newVersionPath = getEntityVersionPath(storageVisibility, entityId, newVersion, orgId || undefined);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity, ability);
  
  // Update latest pointer - CASL verifies superadmin can update entities
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: newStatus,
    visibility: entity.visibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer, ability);
  
  console.log('[SuperEntities] Transitioned entity:', entityId, currentStatus, '->', newStatus);
  
  // Regenerate affected bundles synchronously when publish status changes
  if (newStatus === 'published' || currentStatus === 'published') {
    console.log('[SuperEntities] Triggering bundle regeneration for type:', stub.entityTypeId);
    const config = await loadAppConfig(c.env.R2_BUCKET);
    await regenerateEntityBundles(
      c.env.R2_BUCKET,
      stub.entityTypeId,
      orgId,
      config
    );
  }
  
  return c.json({
    success: true,
    data: {
      entity: updatedEntity,
      transition: {
        from: currentStatus,
        to: newStatus,
        action,
        feedback
      }
    }
  });
});

/**
 * GET /entities
 * List entities (superadmin only - sees ALL entities from ALL organizations)
 * Aggregates entities from published bundles (public/platform) and organization bundles
 * Supports filtering by organizationId, typeId, status, visibility, search
 */
superEntityRoutes.get('/entities',
  requireAbility('read', 'Entity'),
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  const query = c.req.valid('query');
  
  console.log('[SuperEntities] Listing entities from bundles - filters:', query);
  
  if (!query.typeId) {
    return c.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'typeId is required' }
    }, 400);
  }
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  const items: EntityListItem[] = [];
  const seenEntityIds = new Set<string>(); // Track entities to avoid duplicates
  
  // Helper to convert BundleEntity to EntityListItem
  // Note: Only entities have versions, not bundles - EntityListItem doesn't include version
  function bundleEntityToListItem(bundleEntity: BundleEntity, organizationId: string | null): EntityListItem {
    // Extract description from dynamic data
    const descriptionValue = bundleEntity.data?.description as string | undefined;
    
    return {
      id: bundleEntity.id,
      entityTypeId: query.typeId!,
      organizationId: organizationId,
      slug: bundleEntity.slug,
      name: bundleEntity.name,
      status: bundleEntity.status,
      visibility: 'members', // Will be set correctly from entity if needed
      data: {
        ...(descriptionValue && { description: descriptionValue })
      },
      updatedAt: bundleEntity.updatedAt
    };
  }
  
  // 1. Load global bundles (public and platform) - CASL verifies superadmin can read bundles
  console.log('[SuperEntities] Loading global bundles for type:', query.typeId);
  
  const publicBundlePath = getBundlePath('public', query.typeId);
  const publicBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, publicBundlePath, ability, 'read', 'Entity');
  if (publicBundle) {
    console.log('[SuperEntities] Loaded public bundle with', publicBundle.entities.length, 'entities');
    for (const entity of publicBundle.entities) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        const listItem = bundleEntityToListItem(entity, null);
        listItem.visibility = 'public';
        items.push(listItem);
      }
    }
  }
  
  const platformBundlePath = getBundlePath('platform', query.typeId);
  const platformBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, platformBundlePath, ability, 'read', 'Entity');
  if (platformBundle) {
    console.log('[SuperEntities] Loaded platform bundle with', platformBundle.entities.length, 'entities');
    for (const entity of platformBundle.entities) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        const listItem = bundleEntityToListItem(entity, null);
        listItem.visibility = 'authenticated';
        items.push(listItem);
      }
    }
  }
  
  // Load global admin bundles (draft + deleted entities) for public and platform
  // Admin bundles include all draft/deleted entities regardless of visibility
  console.log('[SuperEntities] Loading global admin bundles for type:', query.typeId);
  
  const publicAdminBundlePath = getGlobalAdminBundlePath('public', query.typeId);
  const publicAdminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, publicAdminBundlePath, ability, 'read', 'Entity');
  if (publicAdminBundle) {
    console.log('[SuperEntities] Loaded public admin bundle with', publicAdminBundle.entities.length, 'entities');
    for (const entity of publicAdminBundle.entities) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        const listItem = bundleEntityToListItem(entity, null);
        // Global entities in admin bundles could be from public or platform paths
        // Default to 'authenticated' for draft/deleted (they're not truly public until published)
        listItem.visibility = 'authenticated';
        items.push(listItem);
      }
    }
  }
  
  const platformAdminBundlePath = getGlobalAdminBundlePath('platform', query.typeId);
  const platformAdminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, platformAdminBundlePath, ability, 'read', 'Entity');
  if (platformAdminBundle) {
    console.log('[SuperEntities] Loaded platform admin bundle with', platformAdminBundle.entities.length, 'entities');
    for (const entity of platformAdminBundle.entities) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        const listItem = bundleEntityToListItem(entity, null);
        listItem.visibility = 'authenticated';
        items.push(listItem);
      }
    }
  }
  
  // 2. Load all organization bundles
  console.log('[SuperEntities] Loading organization bundles for type:', query.typeId);
  
  // CASL verifies superadmin can list orgs
  const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`, ability);
  const orgIds = new Set<string>();
  
  // Extract organization IDs from file paths
  for (const file of orgFiles) {
    const match = file.match(/orgs\/([^\/]+)\//);
    if (match) {
      orgIds.add(match[1]);
    }
  }
  
  console.log('[SuperEntities] Found', orgIds.size, 'organizations');
  
  for (const orgId of orgIds) {
    // Filter by organization if specified
    if (query.organizationId !== undefined) {
      if (query.organizationId === null) continue; // Skip orgs if looking for global only
      if (query.organizationId !== orgId) continue; // Skip if not matching org
    }
    
    // Load member bundle (published entities) - CASL verifies superadmin can read org bundles
    const memberBundlePath = getOrgMemberBundlePath(orgId, query.typeId);
    const memberBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, memberBundlePath, ability, 'read', 'Entity');
    if (memberBundle) {
      console.log('[SuperEntities] Loaded member bundle for org', orgId, 'with', memberBundle.entities.length, 'entities');
      for (const entity of memberBundle.entities) {
        if (!seenEntityIds.has(entity.id)) {
          seenEntityIds.add(entity.id);
          const listItem = bundleEntityToListItem(entity, orgId);
          listItem.visibility = 'members'; // Org entities are members visibility
          items.push(listItem);
        }
      }
    }
    
    // Load admin bundle (draft + deleted entities) - superadmins can see these
    // CASL verifies superadmin can read org bundles
    const adminBundlePath = getOrgAdminBundlePath(orgId, query.typeId);
    const adminBundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, adminBundlePath, ability, 'read', 'Entity');
    if (adminBundle) {
      console.log('[SuperEntities] Loaded admin bundle for org', orgId, 'with', adminBundle.entities.length, 'entities');
      for (const entity of adminBundle.entities) {
        if (!seenEntityIds.has(entity.id)) {
          seenEntityIds.add(entity.id);
          const listItem = bundleEntityToListItem(entity, orgId);
          listItem.visibility = 'members'; // Org entities are members visibility
          items.push(listItem);
        }
      }
    }
  }
  
  // 3. Apply filters
  let filteredItems = items;
  
  // Filter by organization if specified
  if (query.organizationId !== undefined) {
    filteredItems = filteredItems.filter(item => {
      if (query.organizationId === null) {
        return item.organizationId === null;
      }
      return item.organizationId === query.organizationId;
    });
  }
  
  // Filter by status if specified
  if (query.status) {
    filteredItems = filteredItems.filter(item => item.status === query.status);
  }
  
  // Filter by visibility if specified
  if (query.visibility) {
    filteredItems = filteredItems.filter(item => item.visibility === query.visibility);
  }
  
  // Filter by search query
  if (query.search) {
    const searchLower = query.search.toLowerCase();
    filteredItems = filteredItems.filter(item => {
      const name = item.name.toLowerCase();
      const description = (item.data?.description as string || '').toLowerCase();
      return name.includes(searchLower) || description.includes(searchLower);
    });
  }
  
  console.log('[SuperEntities] Aggregated', items.length, 'entities from bundles,', filteredItems.length, 'after filters');
  
  let processedCount = 0;
  let skippedCount = 0;
  let addedCount = 0;
  
  processedCount = items.length;
  addedCount = filteredItems.length;
  skippedCount = items.length - filteredItems.length;
  
  // Sort by updatedAt descending
  filteredItems.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  // Pagination
  const start = (query.page - 1) * query.pageSize;
  const paginatedItems = filteredItems.slice(start, start + query.pageSize);
  
  console.log('[SuperEntities] Entity processing summary:', {
    loadedFromBundles: processedCount,
    afterFilters: addedCount,
    skippedByFilters: skippedCount,
    totalInList: filteredItems.length
  });
  console.log('[SuperEntities] Returning', paginatedItems.length, 'of', filteredItems.length, 'entities (page', query.page, 'of', Math.ceil(filteredItems.length / query.pageSize) + ')');
  
  return c.json({
    success: true,
    data: {
      items: paginatedItems,
      total: filteredItems.length,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: start + query.pageSize < filteredItems.length
    }
  });
});
