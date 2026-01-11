/**
 * Entity Routes
 * 
 * Handles entity CRUD operations with versioning:
 * - POST / - Create entity
 * - GET / - List entities (with filters)
 * - GET /export - Export entities for a type (superadmin)
 * - POST /bulk-import - Bulk import entities (superadmin, atomic)
 * - GET /:id - Get entity (latest or specific version)
 * - PATCH /:id - Update entity (atomic field merge)
 * - POST /:id/transition - Status transitions
 * - DELETE /:id - Soft delete entity
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { 
  createEntityRequestSchema, 
  updateEntityRequestSchema,
  entityTransitionRequestSchema,
  entityQueryParamsSchema,
  entityVersionQuerySchema,
  exportQuerySchema,
  bulkImportRequestSchema
} from '@1cc/shared';
import type { BulkImportError } from '@1cc/shared';
import { 
  readJSON, writeJSON, deleteFile, fileExists, listFiles,
  getEntityVersionPath, getEntityLatestPath, getEntityStubPath,
  getEntityTypePath, getOrgPermissionsPath, getUserMembershipPath,
  getBundlePath, getManifestPath
} from '../lib/r2';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId, createSlug } from '../lib/id';
import { requireOrgAdmin, requireSuperadmin } from '../middleware/auth';
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '../middleware/error';
import { isValidTransition, getAllowedTransitions } from '@1cc/xstate-machines';
import { validateEntityData, validateEntityFields } from '../lib/entity-validation';
import type { 
  Entity, EntityStub, EntityLatestPointer, EntityListItem,
  EntityType, EntityTypePermissions, VisibilityScope, EntityStatus,
  OrganizationMembership, EntityBundle, BundleEntity, SiteManifest, ManifestEntityType
} from '@1cc/shared';

export const entityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new entity
 */
entityRoutes.post('/',
  requireOrgAdmin(),
  zValidator('json', createEntityRequestSchema),
  async (c) => {
  console.log('[Entities] Creating entity');
  
  const { entityTypeId, data, visibility, organizationId: requestedOrgId } = c.req.valid('json');
  const userId = c.get('userId')!;
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Determine which organization to use
  let targetOrgId: string | null;
  
  // Handle global entities (null organizationId) - superadmin only
  if (requestedOrgId === null) {
    if (userRole !== 'superadmin') {
      throw new ForbiddenError('Only superadmins can create global entities');
    }
    targetOrgId = null;
  } else if (requestedOrgId) {
    // Verify user is an admin of the requested organization
    if (userRole !== 'superadmin') {
      // Check if user is an admin of the requested org
      const membership = await readJSON<OrganizationMembership>(
        c.env.R2_BUCKET,
        getUserMembershipPath(requestedOrgId, userId)
      );
      
      if (!membership || membership.role !== 'org_admin') {
        throw new ForbiddenError('You are not an admin of the requested organization');
      }
    }
    targetOrgId = requestedOrgId;
  } else {
    // Use user's default organization
    if (!userOrgId) {
      throw new ForbiddenError('You must belong to an organization to create entities');
    }
    targetOrgId = userOrgId;
  }
  
  // Check if user can create this entity type for the target organization
  // Skip permission check for global entities (null organizationId)
  if (targetOrgId !== null) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(targetOrgId)
    );
    
    if (!permissions?.creatable.includes(entityTypeId)) {
      throw new ForbiddenError('This organization cannot create entities of this type');
    }
  }
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(entityTypeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate each field individually before creating entity
  const validatedData = validateEntityFields(data, entityType);
  
  // Final validation to ensure required fields are present
  validateEntityData(validatedData, entityType);
  
  // Determine visibility (public, authenticated, members)
  // For global entities, force visibility to 'public' or 'authenticated' (not 'members')
  let finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  if (targetOrgId === null && finalVisibility === 'members') {
    // Global entities cannot be 'members' visibility - default to 'authenticated'
    finalVisibility = 'authenticated';
    console.log('[Entities] Global entity visibility changed from members to authenticated');
  }
  
  // Generate entity ID
  const entityId = createEntityId();
  const entityName = (data.name as string) || `Entity ${entityId}`;
  
  // Use provided slug if valid, otherwise auto-generate from name
  // Slug is stored at entity.slug (top-level), not in entity.data
  let slug: string;
  if (validatedData.slug && typeof validatedData.slug === 'string') {
    // User provided a slug - use it and remove it from data
    slug = validatedData.slug;
    delete validatedData.slug;
  } else {
    // No slug provided - auto-generate from name
    slug = createSlug(entityName);
  }
  
  const now = new Date().toISOString();
  
  // Create entity
  const entity: Entity = {
    id: entityId,
    entityTypeId,
    organizationId: targetOrgId,
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    slug,
    data: validatedData,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId
  };
  
  // Write entity stub for ownership lookup
  const stub: EntityStub = {
    entityId,
    organizationId: targetOrgId,
    entityTypeId,
    createdAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
  
  // Write entity version
  // For global entities (null orgId), use visibility-based path (not org-specific)
  // For org entities, use members/orgs/{orgId}/ path for drafts
  const storageVisibility: VisibilityScope = targetOrgId === null ? finalVisibility : 'members';
  const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity);
  
  // Write latest pointer
  const latestPointer: EntityLatestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath(storageVisibility, entityId, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
  
  console.log('[Entities] Created entity:', entityId);
  
  return c.json({
    success: true,
    data: entity
  }, 201);
});

/**
 * GET /
 * List entities with filtering
 */
entityRoutes.get('/',
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  console.log('[Entities] Listing entities');
  
  const query = c.req.valid('query');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  console.log('[Entities] Query params:', query, 'userRole:', userRole, 'userOrgId:', userOrgId);
  
  const items: EntityListItem[] = [];
  
  // Cache entity types to avoid multiple reads (keyed by entityTypeId)
  const entityTypeCache = new Map<string, EntityType>();
  
  // Helper to get entity type (with caching)
  async function getEntityType(typeId: string): Promise<EntityType | null> {
    if (entityTypeCache.has(typeId)) {
      return entityTypeCache.get(typeId)!;
    }
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
    if (entityType) {
      entityTypeCache.set(typeId, entityType);
    }
    return entityType;
  }
  
  // Get all entity stubs to find entities
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  console.log('[Entities] Found', stubFiles.length, 'entity stubs');
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub) continue;
    
    // Filter by entity type if specified
    if (query.typeId && stub.entityTypeId !== query.typeId) continue;
    
    // Filter by organization if specified
    // null organizationId means global entity - only match if query.organizationId is explicitly null
    if (query.organizationId !== undefined) {
      if (query.organizationId === null && stub.organizationId !== null) continue;
      if (query.organizationId !== null && stub.organizationId !== query.organizationId) continue;
    }
    
    // Access control: non-superadmins can only see their own org's entities
    // or published public/platform entities
    // For global entities (null orgId), try visibility-based paths first
    let latestPath: string | null = null;
    let latestPointer: EntityLatestPointer | null = null;
    
    if (stub.organizationId === null) {
      // Global entity - try public and authenticated paths
      for (const visibility of ['public', 'authenticated'] as const) {
        latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        if (latestPointer) break;
      }
    } else {
      // Org entity - use members path
      latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (!latestPointer) continue;
    
    // Filter by status if specified
    if (query.status && latestPointer.status !== query.status) continue;
    
    // Filter by visibility if specified
    if (query.visibility && latestPointer.visibility !== query.visibility) continue;
    
    // Access control for non-superadmins
    if (userRole !== 'superadmin') {
      const isOwnOrg = userOrgId === stub.organizationId;
      const isPublished = latestPointer.status === 'published';
      const isPublicOrPlatform = latestPointer.visibility === 'public' || latestPointer.visibility === 'authenticated';
      
      // Can only see: own org entities OR published public/platform entities (including global entities)
      if (!isOwnOrg && !(isPublished && isPublicOrPlatform)) continue;
    }
    
    // Get full entity for display data
    // Determine storage visibility based on entity type
    const storageVisibility: VisibilityScope = stub.organizationId === null 
      ? latestPointer.visibility 
      : 'members';
    const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
    const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
    
    if (!entity) continue;
    
    // Get entity type to find the name field
    const entityType = await getEntityType(entity.entityTypeId);
    
    // Extract name field value - try multiple strategies:
    // 1. Direct entity.data.name (if field ID is 'name')
    // 2. First field in entity type (typically the name field)
    // 3. Fallback to entity ID
    let nameValue: string | undefined;
    if (entity.data.name) {
      nameValue = entity.data.name as string;
    } else if (entityType && entityType.fields.length > 0) {
      // Use the first field's ID (typically the name field)
      const nameFieldId = entityType.fields[0].id;
      nameValue = entity.data[nameFieldId] as string | undefined;
    }
    
    // Extract description field value similarly
    let descriptionValue: string | undefined;
    if (entity.data.description) {
      descriptionValue = entity.data.description as string;
    } else if (entityType && entityType.fields.length > 1) {
      // Try second field as description (common pattern)
      const descFieldId = entityType.fields[1].id;
      descriptionValue = entity.data[descFieldId] as string | undefined;
    }
    
    // Filter by search query
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      const name = (nameValue || '').toLowerCase();
      const description = (descriptionValue || '').toLowerCase();
      
      if (!name.includes(searchLower) && !description.includes(searchLower)) continue;
    }
    
    const listItem = {
      id: entity.id,
      entityTypeId: entity.entityTypeId,
      organizationId: entity.organizationId,
      slug: entity.slug,
      status: entity.status,
      visibility: entity.visibility,
      data: {
        name: nameValue || `Entity ${entity.id}`,
        description: descriptionValue
      },
      version: entity.version,
      updatedAt: entity.updatedAt
    };
    
    items.push(listItem);
  }
  
  // Sort by updatedAt descending
  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  // Pagination
  const start = (query.page - 1) * query.pageSize;
  const paginatedItems = items.slice(start, start + query.pageSize);
  
  console.log('[Entities] Returning', paginatedItems.length, 'of', items.length, 'entities');
  
  return c.json({
    success: true,
    data: {
      items: paginatedItems,
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: start + query.pageSize < items.length
    }
  });
});

/**
 * GET /search
 * Full-text search across entities
 */
entityRoutes.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const typeId = c.req.query('typeId');
  const visibility = c.req.query('visibility');
  const status = c.req.query('status');
  const sortBy = c.req.query('sortBy') || 'relevance';
  const sortOrder = c.req.query('sortOrder') || 'desc';
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');
  
  console.log('[Entities] Search:', { q, typeId, visibility, status, sortBy, sortOrder, limit, offset });
  
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // In a production system, this would use a proper search index (like Algolia, Elasticsearch, or D1 FTS)
  // For now, implement basic in-memory search
  
  const results: Array<{ entity: EntityListItem; score: number; highlights?: string[] }> = [];
  
  // TODO: Implement proper search with indexing
  // This would:
  // 1. Query a search index with the search term
  // 2. Filter by typeId, visibility, status
  // 3. Apply access controls based on userRole and userOrgId
  // 4. Sort by relevance or other fields
  // 5. Return paginated results with highlights
  
  return c.json({
    success: true,
    data: {
      results,
      total: results.length,
      limit,
      offset
    }
  });
});

/**
 * GET /export
 * Export entities for a type (superadmin only)
 * Returns entities with the entity type schema for CSV template generation
 */
entityRoutes.get('/export',
  requireSuperadmin(),
  zValidator('query', exportQuerySchema),
  async (c) => {
  console.log('[Entities] Export handler called');
  console.log('[Entities] Request path:', c.req.path);
  console.log('[Entities] Request query:', c.req.query());
  
  const query = c.req.valid('query');
  console.log('[Entities] Validated query:', query);
  console.log('[Entities] Exporting entities for type:', query.typeId);
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(query.typeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', query.typeId);
  }
  
  // Collect all entities for this type
  const entities: Entity[] = [];
  
  // Get all entity stubs to find entities
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub || stub.entityTypeId !== query.typeId) continue;
    
    // Filter by organization if specified
    if (query.organizationId !== undefined) {
      if (query.organizationId === null && stub.organizationId !== null) continue;
      if (query.organizationId !== null && stub.organizationId !== query.organizationId) continue;
    }
    
    // Get latest pointer
    let latestPointer: EntityLatestPointer | null = null;
    
    if (stub.organizationId === null) {
      // Global entity - try public and authenticated paths
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        if (latestPointer) break;
      }
    } else {
      // Org entity - use members path
      const latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (!latestPointer) continue;
    
    // Filter by status if specified
    if (query.status && latestPointer.status !== query.status) continue;
    
    // Get full entity
    const storageVisibility: VisibilityScope = stub.organizationId === null 
      ? latestPointer.visibility 
      : 'members';
    const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
    const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
    
    if (entity) {
      entities.push(entity);
    }
  }
  
  // Sort by createdAt
  entities.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  console.log('[Entities] Exporting', entities.length, 'entities for type:', query.typeId);
  
  const responseData = {
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
      entities,
      exportedAt: new Date().toISOString()
    }
  };
  
  // Log response size for debugging
  try {
    const responseString = JSON.stringify(responseData);
    console.log('[Entities] Export response size:', responseString.length, 'bytes');
    if (responseString.length > 1000000) {
      console.warn('[Entities] Large export response:', responseString.length, 'bytes');
    }
  } catch (serializeError) {
    console.error('[Entities] Failed to serialize export response:', serializeError);
    throw new Error('Failed to serialize export data');
  }
  
  console.log('[Entities] Returning export response');
  
  // Ensure we're returning a proper response
  try {
    const response = c.json(responseData);
    console.log('[Entities] Response created successfully');
    return response;
  } catch (responseError) {
    console.error('[Entities] Error creating response:', responseError);
    // Fallback: return plain JSON without pretty formatting
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});

/**
 * POST /bulk-import
 * Bulk import entities (superadmin only)
 * Atomic operation: validates ALL entities first, only creates if ALL pass
 * Supports per-row organizationId and slug
 */
entityRoutes.post('/bulk-import',
  requireSuperadmin(),
  zValidator('json', bulkImportRequestSchema),
  async (c) => {
  console.log('[Entities] Bulk importing entities');
  
  const { entityTypeId, organizationId: defaultOrgId, entities: importEntities } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(entityTypeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Collect unique organization IDs from all entities for permission validation
  const uniqueOrgIds = new Set<string>();
  for (const entity of importEntities) {
    // Per-row organizationId takes precedence over default
    const orgId = entity.organizationId !== undefined ? entity.organizationId : defaultOrgId;
    if (orgId !== null && orgId !== undefined) {
      uniqueOrgIds.add(orgId);
    }
  }
  
  // Check organization permissions for all unique orgs
  for (const orgId of uniqueOrgIds) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(orgId)
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
    data: Record<string, unknown>;
    visibility: VisibilityScope;
    slug: string;
    organizationId: string | null;
    mode: 'create' | 'update' | 'create-with-id';
    entityId?: string; // For update or create-with-id
    existingEntity?: Entity; // For updates
    existingVersion?: number; // For updates
  };
  
  const validatedEntities: ValidatedEntity[] = [];
  
  // Collect existing slugs for uniqueness validation (only for new entities)
  // We'll validate within batch and against existing entities
  const existingSlugs = new Map<string, string>(); // key: "orgId|slug", value: entityId that owns it
  const batchNewSlugs = new Map<string, number>(); // key: "orgId|slug", value: row index
  
  // First pass: Load existing slugs for this entity type
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub || stub.entityTypeId !== entityTypeId) continue;
    
    // Get entity to read its slug
    let latestPointer: EntityLatestPointer | null = null;
    if (stub.organizationId === null) {
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        if (latestPointer) break;
      }
    } else {
      const latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (latestPointer) {
      const storageVisibility: VisibilityScope = stub.organizationId === null 
        ? latestPointer.visibility 
        : 'members';
      const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
      const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
      if (entity) {
        const slugKey = `${stub.organizationId || 'global'}|${entity.slug}`;
        existingSlugs.set(slugKey, entity.id);
      }
    }
  }
  
  for (let i = 0; i < importEntities.length; i++) {
    const importEntity = importEntities[i];
    
    // Determine organization for this entity (per-row takes precedence)
    const entityOrgId = importEntity.organizationId !== undefined 
      ? importEntity.organizationId 
      : (defaultOrgId ?? null);
    
    // Check if entity ID is provided
    const providedId = importEntity.id;
    let mode: 'create' | 'update' | 'create-with-id' = 'create';
    let existingEntity: Entity | undefined;
    let existingVersion: number | undefined;
    
    if (providedId) {
      // Check if entity exists
      const existingStub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(providedId));
      
      if (existingStub) {
        // Entity exists - this is an update
        mode = 'update';
        
        // Verify entity type matches
        if (existingStub.entityTypeId !== entityTypeId) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} belongs to a different entity type`
          });
          continue;
        }
        
        // Get current entity for update
        let latestPointer: EntityLatestPointer | null = null;
        if (existingStub.organizationId === null) {
          for (const visibility of ['public', 'authenticated'] as const) {
            const latestPath = getEntityLatestPath(visibility, providedId, undefined);
            latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
            if (latestPointer) break;
          }
        } else {
          const latestPath = getEntityLatestPath('members', providedId, existingStub.organizationId);
          latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        }
        
        if (!latestPointer) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} not found (corrupted state)`
          });
          continue;
        }
        
        existingVersion = latestPointer.version;
        
        // Get current entity data
        const storageVisibility: VisibilityScope = existingStub.organizationId === null 
          ? latestPointer.visibility 
          : 'members';
        const entityPath = getEntityVersionPath(storageVisibility, providedId, latestPointer.version, existingStub.organizationId || undefined);
        existingEntity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath) || undefined;
        
        if (!existingEntity) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} version ${latestPointer.version} not found`
          });
          continue;
        }
      } else {
        // Entity doesn't exist - create with this specific ID
        mode = 'create-with-id';
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
      
      // Handle slug: use provided slug, or from data, or auto-generate from name
      const entityName = (validatedData.name as string) || `Entity ${i + 1}`;
      let slug: string;
      
      if (importEntity.slug) {
        // Slug provided at entity level (already validated by Zod schema)
        slug = importEntity.slug;
      } else if (validatedData.slug && typeof validatedData.slug === 'string') {
        // Slug in data field
        slug = validatedData.slug;
        delete validatedData.slug;
      } else if (mode === 'update' && existingEntity) {
        // For updates without slug, keep existing slug
        slug = existingEntity.slug;
      } else {
        // Auto-generate from name
        slug = createSlug(entityName);
      }
      
      // Validate slug uniqueness for new entities (create or create-with-id)
      if (mode !== 'update') {
        const slugKey = `${entityOrgId || 'global'}|${slug}`;
        
        // Check against existing slugs in database
        const existingOwner = existingSlugs.get(slugKey);
        if (existingOwner && existingOwner !== providedId) {
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
        data: validatedData,
        visibility: finalVisibility,
        slug,
        organizationId: entityOrgId,
        mode,
        entityId: providedId,
        existingEntity,
        existingVersion
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
    console.log('[Entities] Bulk import validation failed:', validationErrors.length, 'errors');
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
      // Update existing entity - create new version
      const newVersion = validated.existingVersion + 1;
      
      const updatedEntity: Entity = {
        ...validated.existingEntity,
        version: newVersion,
        visibility: validated.visibility,
        slug: validated.slug,
        data: validated.data,
        updatedAt: now,
        updatedBy: userId
      };
      
      // Write new version
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const versionPath = getEntityVersionPath(storageVisibility, validated.entityId!, newVersion, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, versionPath, updatedEntity);
      
      // Update latest pointer
      const latestPointer: EntityLatestPointer = {
        version: newVersion,
        status: validated.existingEntity.status, // Keep existing status
        visibility: validated.visibility,
        updatedAt: now
      };
      
      const latestPath = getEntityLatestPath(storageVisibility, validated.entityId!, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
      
      updatedIds.push(validated.entityId!);
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
        slug: validated.slug,
        data: validated.data,
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
      
      await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
      
      // Write entity version
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, versionPath, entity);
      
      // Write latest pointer
      const latestPointer: EntityLatestPointer = {
        version: 1,
        status: 'draft',
        visibility: validated.visibility,
        updatedAt: now
      };
      
      const latestPath = getEntityLatestPath(storageVisibility, entityId, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
      
      createdIds.push(entityId);
    }
  }
  
  console.log('[Entities] Bulk import complete - created:', createdIds.length, 'updated:', updatedIds.length);
  
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
 * GET /:id
 * Get entity by ID (latest or specific version)
 */
entityRoutes.get('/:id',
  zValidator('query', entityVersionQuerySchema),
  async (c) => {
  const entityId = c.req.param('id');
  const versionQuery = c.req.valid('query');
  
  console.log('[Entities] Getting entity:', entityId, versionQuery.version ? `v${versionQuery.version}` : 'latest');
  
  // Get entity stub for ownership info
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check access permissions
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Get latest pointer to determine visibility
  // For global entities (null orgId), try visibility-based paths
  let latestPath: string | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  
  if (stub.organizationId === null) {
    // Global entity - try public and authenticated paths
    for (const visibility of ['public', 'authenticated'] as const) {
      latestPath = getEntityLatestPath(visibility, entityId, undefined);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
      if (latestPointer) break;
    }
  } else {
    // Org entity - use members path
    latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  }
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Access control
  if (userRole !== 'superadmin') {
    if (latestPointer.visibility === 'members' && userOrgId !== stub.organizationId) {
      throw new ForbiddenError('You do not have access to this entity');
    }
    
    // Draft entities only visible to org admins
    if (latestPointer.status === 'draft' && userOrgId !== stub.organizationId) {
      throw new NotFoundError('Entity', entityId);
    }
  }
  
  // Determine which version to fetch
  const version = versionQuery.version || latestPointer.version;
  
  // Determine storage location based on status and visibility
  // Draft/pending entities are always stored in members (private) location for org entities
  // Global entities use visibility-based paths
  let versionPath: string;
  if (stub.organizationId === null) {
    // Global entity - use visibility-based path
    versionPath = getEntityVersionPath(latestPointer.visibility, entityId, version);
  } else if (latestPointer.status === 'draft' || latestPointer.status === 'pending_approval') {
    // Drafts and pending entities are always in the org's private space
    versionPath = getEntityVersionPath('members', entityId, version, stub.organizationId);
  } else if (latestPointer.visibility === 'members') {
    versionPath = getEntityVersionPath('members', entityId, version, stub.organizationId);
  } else {
    versionPath = getEntityVersionPath(latestPointer.visibility, entityId, version);
  }
  
  const entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath);
  
  if (!entity) {
    throw new NotFoundError('Entity version', `${entityId} v${version}`);
  }
  
  return c.json({
    success: true,
    data: entity
  });
});

/**
 * PATCH /:id
 * Update entity with atomic field merge
 */
entityRoutes.patch('/:id',
  requireOrgAdmin(),
  zValidator('json', updateEntityRequestSchema),
  async (c) => {
  const entityId = c.req.param('id');
  console.log('[Entities] Updating entity:', entityId);
  
  const updates = c.req.valid('json');
  const userId = c.get('userId')!;
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Get entity stub
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check ownership
  if (userRole !== 'superadmin' && userOrgId !== stub.organizationId) {
    throw new ForbiddenError('You can only edit entities from your organization');
  }
  
  // Get latest pointer - handle global entities (null orgId) vs org entities
  // For global entities, try visibility-based paths (public, authenticated)
  // For org entities, use members path
  let latestPath: string | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  
  if (stub.organizationId === null) {
    // Global entity - try public and authenticated paths
    for (const visibility of ['public', 'authenticated'] as const) {
      latestPath = getEntityLatestPath(visibility, entityId, undefined);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
      if (latestPointer) break;
    }
  } else {
    // Org entity - use members path
    latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  }
  
  if (!latestPointer || !latestPath) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only draft entities can be edited
  if (latestPointer.status !== 'draft') {
    throw new AppError('INVALID_STATUS', 'Only draft entities can be edited', 400);
  }
  
  // Determine storage visibility based on entity type
  // Global entities use visibility-based paths, org entities use 'members'
  const storageVisibility: VisibilityScope = stub.organizationId === null 
    ? latestPointer.visibility 
    : 'members';
  
  // Get current version
  const currentPath = getEntityVersionPath(storageVisibility, entityId, latestPointer.version, stub.organizationId || undefined);
  const currentEntity = await readJSON<Entity>(c.env.R2_BUCKET, currentPath);
  
  if (!currentEntity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get entity type for validation
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(currentEntity.entityTypeId)
  );
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', currentEntity.entityTypeId);
  }
  
  // Validate each field individually before merging
  let newData = currentEntity.data;
  if (updates.data) {
    const validatedUpdates = validateEntityFields(updates.data, entityType);
    // Merge only validated fields
    newData = { ...currentEntity.data, ...validatedUpdates };
    // Final validation to ensure required fields are still present
    validateEntityData(newData, entityType);
  }
  
  const newVersion = currentEntity.version + 1;
  const now = new Date().toISOString();
  
  // Get the new visibility for the entity
  const newVisibility = updates.visibility || currentEntity.visibility;
  
  // Extract slug from data if provided (slug is top-level, not in entity.data)
  // Slug should NOT auto-update from name changes after entity has been saved
  let newSlug = currentEntity.slug;
  if (newData.slug && typeof newData.slug === 'string') {
    newSlug = newData.slug;
    delete newData.slug; // Remove slug from data (it's stored at top level)
  }
  
  // Create new version
  const updatedEntity: Entity = {
    ...currentEntity,
    version: newVersion,
    visibility: newVisibility,
    slug: newSlug,
    data: newData,
    updatedAt: now,
    updatedBy: userId
  };
  
  // Determine storage visibility for new version
  // Global entities use visibility-based paths, org entities use 'members'
  const newStorageVisibility: VisibilityScope = stub.organizationId === null 
    ? newVisibility 
    : 'members';
  
  // Write new version
  const newVersionPath = getEntityVersionPath(newStorageVisibility, entityId, newVersion, stub.organizationId || undefined);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity);
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: updatedEntity.status,
    visibility: newVisibility,
    updatedAt: now
  };
  
  // Determine latest pointer location
  // For global entities, if visibility changed, update to new location
  // For org entities, always use members path
  let newLatestPath: string;
  if (stub.organizationId === null) {
    // Global entity - use new visibility location
    newLatestPath = getEntityLatestPath(newVisibility, entityId, undefined);
  } else {
    // Org entity - always use members path
    newLatestPath = latestPath!;
  }
  
  // Update latest pointer at the new location
  await writeJSON(c.env.R2_BUCKET, newLatestPath, newPointer);
  
  console.log('[Entities] Updated entity:', entityId, 'to v' + newVersion);
  
  return c.json({
    success: true,
    data: updatedEntity
  });
});

/**
 * POST /:id/transition
 * Handle status transitions (submit, approve, reject, archive, restore, delete)
 */
entityRoutes.post('/:id/transition',
  zValidator('json', entityTransitionRequestSchema),
  async (c) => {
  const entityId = c.req.param('id');
  console.log('[Entities] Processing transition for:', entityId);
  
  const { action, feedback } = c.req.valid('json');
  const userId = c.get('userId')!;
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Get entity stub
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get current entity state - handle global entities (null orgId) vs org entities
  // For global entities, try visibility-based paths (public, authenticated)
  // For org entities, use members path
  let latestPath: string | null = null;
  let latestPointer: EntityLatestPointer | null = null;
  
  if (stub.organizationId === null) {
    // Global entity - try public and authenticated paths
    for (const visibility of ['public', 'authenticated'] as const) {
      latestPath = getEntityLatestPath(visibility, entityId, undefined);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
      if (latestPointer) break;
    }
  } else {
    // Org entity - use members path
    latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  }
  
  if (!latestPointer || !latestPath) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check permissions for the action
  const currentStatus = latestPointer.status;
  
  // Role-based action permissions
  if (['approve', 'reject'].includes(action) && userRole !== 'superadmin') {
    throw new ForbiddenError('Only superadmins can approve or reject entities');
  }
  
  if (action === 'submitForApproval' && userRole !== 'superadmin' && userOrgId !== stub.organizationId) {
    throw new ForbiddenError('You can only submit entities from your organization');
  }
  
  // Validate transition
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
  
  // Determine storage visibility for current entity version
  // Global entities use visibility-based paths
  // Org entities: drafts/pending/members visibility use 'members', published public/authenticated use visibility-based paths
  let storageVisibility: VisibilityScope;
  if (stub.organizationId === null) {
    // Global entity - use visibility-based path
    storageVisibility = latestPointer.visibility;
  } else if (latestPointer.status === 'draft' || latestPointer.status === 'pending_approval') {
    // Drafts and pending entities are always in the org's private space
    storageVisibility = 'members';
  } else if (latestPointer.visibility === 'members') {
    // Published entities with members visibility
    storageVisibility = 'members';
  } else {
    // Published entities with public/authenticated visibility
    storageVisibility = latestPointer.visibility;
  }
  
  // Get current entity version
  const currentPath = getEntityVersionPath(storageVisibility, entityId, latestPointer.version, stub.organizationId || undefined);
  const currentEntity = await readJSON<Entity>(c.env.R2_BUCKET, currentPath);
  
  if (!currentEntity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  const newVersion = currentEntity.version + 1;
  const now = new Date().toISOString();
  
  // Create new version with updated status
  const updatedEntity: Entity = {
    ...currentEntity,
    version: newVersion,
    status: newStatus,
    updatedAt: now,
    updatedBy: userId,
    // Store approval feedback for approve/reject actions
    ...((['approve', 'reject'].includes(action)) && {
      approvalFeedback: feedback || undefined,
      approvalActionAt: now,
      approvalActionBy: userId
    })
  };
  
  // Determine storage location based on new status and visibility
  // For global entities, use visibility-based paths; for org entities, use 'members' for drafts/pending
  let targetVisibility: VisibilityScope;
  
  if (stub.organizationId === null) {
    // Global entity - always use visibility-based paths
    targetVisibility = currentEntity.visibility;
  } else {
    // Org entity - use 'members' for drafts/pending, visibility-based for published
    targetVisibility = newStatus === 'published' ? currentEntity.visibility : 'members';
  }
  
  // Write new version to appropriate location
  const newVersionPath = getEntityVersionPath(targetVisibility, entityId, newVersion, 
    targetVisibility === 'members' ? stub.organizationId : undefined);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity);
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: newStatus,
    visibility: currentEntity.visibility,
    updatedAt: now
  };
  
  // Determine latest pointer location
  // For global entities, always use visibility-based path
  // For org entities, use 'members' path for drafts/pending, visibility-based for published
  let newLatestPath: string;
  if (stub.organizationId === null) {
    // Global entity - use visibility-based path
    newLatestPath = getEntityLatestPath(currentEntity.visibility, entityId, undefined);
  } else {
    // Org entity - use members path for drafts/pending, visibility-based for published
    if (newStatus === 'published' && targetVisibility !== 'members') {
      newLatestPath = getEntityLatestPath(targetVisibility, entityId, undefined);
    } else {
      newLatestPath = latestPath!;
    }
  }
  
  // Update latest pointer at the appropriate location
  await writeJSON(c.env.R2_BUCKET, newLatestPath, newPointer);
  
  // For org entities publishing to public/authenticated, also keep latest pointer in members path for reference
  if (stub.organizationId !== null && newStatus === 'published' && targetVisibility !== 'members') {
    await writeJSON(c.env.R2_BUCKET, latestPath, newPointer);
  }
  
  console.log('[Entities] Transitioned entity:', entityId, currentStatus, '->', newStatus);
  
  // Trigger bundle regeneration for published/unpublished entities
  // This is async but we don't await it to avoid blocking the response
  if (newStatus === 'published' || currentStatus === 'published') {
    console.log('[Entities] Triggering bundle regeneration for type:', stub.entityTypeId);
    regenerateTypeBundle(c.env.R2_BUCKET, stub.entityTypeId, targetVisibility, 
      targetVisibility === 'members' ? stub.organizationId : undefined)
      .catch(err => console.error('[Entities] Bundle regeneration failed:', err));
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
 * DELETE /:id
 * Soft delete entity
 */
entityRoutes.delete('/:id', requireOrgAdmin(), async (c) => {
  const entityId = c.req.param('id');
  
  // Redirect to transition endpoint with delete action
  const body = { action: 'delete' };
  
  // This is a shortcut - in production would call the transition logic directly
  return c.json({
    success: true,
    data: { message: 'Use POST /:id/transition with action "delete" instead' }
  });
});

// Helper functions

/**
 * Regenerate entity bundle for a specific type
 * Called after entity status changes (publish/unpublish)
 */
async function regenerateTypeBundle(
  bucket: R2Bucket,
  typeId: string,
  visibility: 'public' | 'authenticated' | 'members',
  orgId?: string
): Promise<void> {
  console.log('[Entities] Regenerating bundle for type:', typeId, visibility, orgId || '');
  
  // Get entity type
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  if (!entityType) {
    console.error('[Entities] Entity type not found:', typeId);
    return;
  }
  
  // Determine entity path prefix based on visibility
  let entityPrefix: string;
  if (visibility === 'members' && orgId) {
    entityPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
  } else if (visibility === 'authenticated') {
    entityPrefix = `${R2_PATHS.PLATFORM}entities/`;
  } else {
    entityPrefix = `${R2_PATHS.PUBLIC}entities/`;
  }
  
  // List all entity directories
  const entityFiles = await listFiles(bucket, entityPrefix);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  const entities: BundleEntity[] = [];
  
  for (const latestFile of latestFiles) {
    // Get entity ID from path
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const entityId = entityIdMatch[1];
    
    // Read latest pointer
    const latestPointer = await readJSON<EntityLatestPointer>(bucket, latestFile);
    if (!latestPointer) continue;
    
    // Only include published entities in bundles
    if (latestPointer.status !== 'published') continue;
    
    // Read entity version
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const entity = await readJSON<Entity>(bucket, versionPath);
    
    if (!entity || entity.entityTypeId !== typeId) continue;
    
    entities.push({
      id: entity.id,
      version: entity.version,
      status: entity.status,
      slug: entity.slug,
      data: entity.data,
      updatedAt: entity.updatedAt
    });
  }
  
  const bundle: EntityBundle = {
    typeId,
    typeName: entityType.pluralName,
    generatedAt: new Date().toISOString(),
    version: Date.now(),
    entityCount: entities.length,
    entities
  };
  
  // Save bundle
  const bundlePath = getBundlePath(visibility, typeId, orgId);
  await writeJSON(bucket, bundlePath, bundle);
  
  console.log('[Entities] Generated bundle with', entities.length, 'entities');
  
  // Also update the manifest
  await updateManifest(bucket, visibility, typeId, bundle, orgId);
}

/**
 * Update the site manifest after bundle regeneration
 */
async function updateManifest(
  bucket: R2Bucket,
  visibility: 'public' | 'authenticated' | 'members',
  typeId: string,
  bundle: EntityBundle,
  orgId?: string
): Promise<void> {
  console.log('[Entities] Updating manifest for:', visibility, orgId || '');
  
  const manifestPath = getManifestPath(visibility, orgId);
  let manifest = await readJSON<SiteManifest>(bucket, manifestPath);
  
  if (!manifest) {
    manifest = {
      generatedAt: new Date().toISOString(),
      version: Date.now(),
      entityTypes: []
    };
  }
  
  // Get entity type for manifest entry
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId));
  if (!entityType) return;
  
  // Update or add the entity type entry
  const existingIndex = manifest.entityTypes.findIndex(t => t.id === typeId);
  const typeEntry: ManifestEntityType = {
    id: entityType.id,
    name: entityType.name,
    pluralName: entityType.pluralName,
    slug: entityType.slug,
    description: entityType.description,
    entityCount: bundle.entityCount,
    bundleVersion: bundle.version,
    lastUpdated: bundle.generatedAt
  };
  
  if (existingIndex >= 0) {
    manifest.entityTypes[existingIndex] = typeEntry;
  } else {
    manifest.entityTypes.push(typeEntry);
  }
  
  manifest.generatedAt = new Date().toISOString();
  manifest.version = Date.now();
  
  await writeJSON(bucket, manifestPath, manifest);
  console.log('[Entities] Manifest updated');
}
