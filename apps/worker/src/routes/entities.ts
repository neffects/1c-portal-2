/**
 * Entity Routes
 * 
 * Handles entity CRUD operations with versioning:
 * - POST / - Create entity
 * - GET / - List entities (with filters)
 * - GET /:id - Get entity (latest or specific version)
 * - PATCH /:id - Update entity (atomic field merge)
 * - POST /:id/transition - Status transitions
 * - DELETE /:id - Soft delete entity
 * 
 * Note: Export and bulk-import routes are in /api/super/entities (superadmin only)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { 
  createEntityRequestSchema, 
  updateEntityRequestSchema,
  entityTransitionRequestSchema,
  entityQueryParamsSchema,
  entityVersionQuerySchema
} from '@1cc/shared';
import { 
  readJSON, writeJSON, deleteFile, fileExists, listFiles,
  getEntityVersionPath, getEntityLatestPath, getEntityStubPath,
  getEntityTypePath, getOrgPermissionsPath, getUserMembershipPath
} from '../lib/r2';
import { regenerateEntityBundles, loadAppConfig, getUserHighestMembershipKey, projectFieldsForKey } from '../lib/bundle-invalidation';
import { upsertSlugIndex, deleteSlugIndex } from '../lib/slug-index';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId } from '../lib/id';
import { requireOrgAdmin } from '../middleware/auth';
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '../middleware/error';
import { isValidTransition, getAllowedTransitions } from '@1cc/xstate-machines';
import { validateEntityData, validateEntityFields } from '../lib/entity-validation';
import type { 
  Entity, EntityStub, EntityLatestPointer, EntityListItem,
  EntityType, EntityTypePermissions, VisibilityScope, EntityStatus,
  OrganizationMembership
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
  
  const { entityTypeId, name, slug, data, visibility, organizationId: requestedOrgId } = c.req.valid('json');
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
  
  // Validate dynamic fields (name and slug are already validated by schema)
  const entityData = data ? validateEntityFields(data, entityType) : {};
  
  // Remove name and slug from entityData if accidentally included
  delete entityData.name;
  delete entityData.slug;
  
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
  
  const now = new Date().toISOString();
  
  // Create entity with name and slug at top-level (from request body)
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
  
  // Create slug index for deep linking (only for public visibility entities)
  if (finalVisibility === 'public') {
    await upsertSlugIndex(
      c.env.R2_BUCKET,
      targetOrgId,
      entityType.slug,
      slug.trim(),
      {
        entityId,
        visibility: finalVisibility,
        organizationId: targetOrgId,
        entityTypeId
      }
    );
  }
  
  console.log('[Entities] Created entity:', entityId);
  
  // Regenerate affected bundles synchronously
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    entityTypeId,
    targetOrgId,
    config
  );
  
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
    
    // Name is stored at top-level (common property)
    const nameValue = entity.name || `Entity ${entity.id}`;
    
    // Extract description from dynamic data
    let descriptionValue: string | undefined;
    if (entity.data.description) {
      descriptionValue = entity.data.description as string;
    } else if (entityType && entityType.fields.length > 0) {
      // Try to find description field
      const descField = entityType.fields.find(f => f.id === 'description' || f.name?.toLowerCase() === 'description');
      if (descField) {
        descriptionValue = entity.data[descField.id] as string | undefined;
      }
    }
    
    // Filter by search query
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      const name = nameValue.toLowerCase();
      const description = (descriptionValue || '').toLowerCase();
      
      if (!name.includes(searchLower) && !description.includes(searchLower)) continue;
    }
    
    const listItem: EntityListItem = {
      id: entity.id,
      entityTypeId: entity.entityTypeId,
      organizationId: entity.organizationId,
      name: nameValue, // Top-level property
      slug: entity.slug, // Top-level property
      status: entity.status,
      visibility: entity.visibility,
      data: {
        // Only dynamic fields (name is at top-level, not in data)
        ...(descriptionValue && { description: descriptionValue })
      },
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
  } else if (latestPointer.status === 'draft' || latestPointer.status === 'pending') {
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
  
  // Apply field projection based on user's membership key
  // Skip projection for:
  // 1. Superadmins (see all fields)
  // 2. Users viewing their own org's entities (see all fields)
  const isOwnOrgEntity = userOrgId === stub.organizationId;
  const isSuperadmin = userRole === 'superadmin';
  
  if (!isSuperadmin && !isOwnOrgEntity) {
    // Get entity type for field visibility config
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entity.entityTypeId));
    
    if (entityType) {
      // Get user's highest membership key and project fields
      const config = await loadAppConfig(c.env.R2_BUCKET);
      const highestKey = await getUserHighestMembershipKey(
        c.env.R2_BUCKET,
        userOrgId || null,
        false, // not superadmin (already checked above)
        config
      );
      
      console.log('[Entities] Projecting fields for key:', highestKey);
      const projectedEntity = projectFieldsForKey(entity, entityType, highestKey, config);
      
      return c.json({
        success: true,
        data: projectedEntity
      });
    }
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
  
  // Get name and slug from top-level request (or keep existing values)
  const entityName = updates.name !== undefined ? updates.name : currentEntity.name;
  const entitySlug = updates.slug !== undefined ? updates.slug : currentEntity.slug;
  
  // Validate dynamic fields (name and slug are handled above)
  let entityData = currentEntity.data;
  if (updates.data) {
    const validatedUpdates = validateEntityFields(updates.data, entityType);
    // Remove name and slug from validated updates if accidentally included
    delete validatedUpdates.name;
    delete validatedUpdates.slug;
    entityData = { ...currentEntity.data, ...validatedUpdates };
    validateEntityData(entityData, entityType);
  }
  
  const newVersion = currentEntity.version + 1;
  const now = new Date().toISOString();
  
  // Get the new visibility for the entity
  const newVisibility = updates.visibility || currentEntity.visibility;
  const trimmedSlug = entitySlug.trim();
  
  // Create new version with name and slug at top-level
  const updatedEntity: Entity = {
    ...currentEntity,
    version: newVersion,
    visibility: newVisibility,
    name: entityName.trim(),
    slug: trimmedSlug,
    data: entityData, // Dynamic fields only
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
  
  // Update slug index if visibility is public and slug or visibility changed
  const currentSlug = currentEntity.slug;
  if (newVisibility === 'public') {
    // Delete old slug index if slug changed
    if (currentSlug !== trimmedSlug && currentEntity.visibility === 'public') {
      await deleteSlugIndex(c.env.R2_BUCKET, stub.organizationId, entityType.slug, currentSlug);
    }
    // Create/update slug index
    await upsertSlugIndex(c.env.R2_BUCKET, stub.organizationId, entityType.slug, trimmedSlug, {
      entityId,
      visibility: newVisibility,
      organizationId: stub.organizationId,
      entityTypeId: currentEntity.entityTypeId
    });
  } else if (currentEntity.visibility === 'public' && newVisibility !== 'public') {
    // Visibility changed from public to non-public - delete slug index
    await deleteSlugIndex(c.env.R2_BUCKET, stub.organizationId, entityType.slug, currentSlug);
  }
  
  console.log('[Entities] Updated entity:', entityId, 'to v' + newVersion);
  
  // Regenerate affected bundles synchronously
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    currentEntity.entityTypeId,
    stub.organizationId,
    config
  );
  
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
  } else if (latestPointer.status === 'draft' || latestPointer.status === 'pending') {
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
  
  // Regenerate affected bundles synchronously for consistency
  // This affects bundles when entities become published or are unpublished
  if (newStatus === 'published' || currentStatus === 'published') {
    console.log('[Entities] Triggering bundle regeneration for type:', stub.entityTypeId);
    const config = await loadAppConfig(c.env.R2_BUCKET);
    await regenerateEntityBundles(
      c.env.R2_BUCKET,
      stub.entityTypeId,
      stub.organizationId,
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

// Note: Bundle regeneration is now handled by the centralized bundle-invalidation.ts service
