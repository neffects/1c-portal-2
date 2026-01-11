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
  
  // Get current entity
  const latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only draft entities can be edited
  if (latestPointer.status !== 'draft') {
    throw new AppError('INVALID_STATUS', 'Only draft entities can be edited', 400);
  }
  
  // Get current version
  const currentPath = getEntityVersionPath('members', entityId, latestPointer.version, stub.organizationId);
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
  
  // Use slug from request data if provided, otherwise keep existing slug
  // Slug should NOT auto-update from name changes after entity has been saved
  const newSlug = (newData.slug as string) || currentEntity.slug;
  
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
  
  // Write new version
  const newVersionPath = getEntityVersionPath('members', entityId, newVersion, stub.organizationId);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity);
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: updatedEntity.status,
    visibility: newVisibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer);
  
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
  
  // Get current entity state
  const latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
  if (!latestPointer) {
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
  
  // Get current entity version
  const currentPath = getEntityVersionPath('members', entityId, latestPointer.version, stub.organizationId);
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
  let targetVisibility: 'public' | 'authenticated' | 'members' = 'members';
  
  if (newStatus === 'published') {
    targetVisibility = currentEntity.visibility;
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
  
  // Latest pointer stays in private for org reference
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer);
  
  // If publishing to public/authenticated, also write latest there
  if (newStatus === 'published' && targetVisibility !== 'members') {
    const publicLatestPath = getEntityLatestPath(targetVisibility, entityId);
    await writeJSON(c.env.R2_BUCKET, publicLatestPath, newPointer);
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
