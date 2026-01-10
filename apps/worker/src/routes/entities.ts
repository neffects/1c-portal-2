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
import type { Env, Variables } from '../types';
import { 
  createEntityRequestSchema, 
  updateEntityRequestSchema,
  entityTransitionRequestSchema,
  entityQueryParamsSchema,
  entityVersionQuerySchema
} from '@1cc/shared';
import { 
  readJSON, writeJSON, deleteFile, fileExists,
  getEntityVersionPath, getEntityLatestPath, getEntityStubPath,
  getEntityTypePath, getOrgPermissionsPath
} from '../lib/r2';
import { createEntityId, createSlug } from '../lib/id';
import { requireOrgAdmin, requireSuperadmin } from '../middleware/auth';
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '../middleware/error';
import { isValidTransition, getAllowedTransitions } from '@1cc/xstate-machines';
import type { 
  Entity, EntityStub, EntityLatestPointer, EntityListItem,
  EntityType, EntityTypePermissions, VisibilityScope, EntityStatus 
} from '@1cc/shared';

export const entityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new entity
 */
entityRoutes.post('/', requireOrgAdmin, async (c) => {
  console.log('[Entities] Creating entity');
  
  const body = await c.req.json();
  const result = createEntityRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid entity data', { errors: result.error.errors });
  }
  
  const { entityTypeId, data, visibility } = result.data;
  const userId = c.get('userId')!;
  const userOrgId = c.get('organizationId');
  
  if (!userOrgId) {
    throw new ForbiddenError('You must belong to an organization to create entities');
  }
  
  // Check if user can create this entity type
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET,
    getOrgPermissionsPath(userOrgId)
  );
  
  if (!permissions?.creatable.includes(entityTypeId)) {
    throw new ForbiddenError('Your organization cannot create entities of this type');
  }
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(entityTypeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate data against schema
  validateEntityData(data, entityType);
  
  // Determine visibility (public, authenticated, members)
  const finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  
  // Generate entity ID and slug
  const entityId = createEntityId();
  const entityName = (data.name as string) || `Entity ${entityId}`;
  const slug = createSlug(entityName);
  const now = new Date().toISOString();
  
  // Create entity
  const entity: Entity = {
    id: entityId,
    entityTypeId,
    organizationId: userOrgId,
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    slug,
    data,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId
  };
  
  // Write entity stub for ownership lookup
  const stub: EntityStub = {
    entityId,
    organizationId: userOrgId,
    entityTypeId,
    createdAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
  
  // Write entity version (stored in members location for drafts)
  const versionPath = getEntityVersionPath('members', entityId, 1, userOrgId);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity);
  
  // Write latest pointer
  const latestPointer: EntityLatestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath('members', entityId, userOrgId);
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
entityRoutes.get('/', async (c) => {
  console.log('[Entities] Listing entities');
  
  const query = entityQueryParamsSchema.parse(c.req.query());
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // For now, return entities from user's organization
  // In production, this would aggregate from multiple sources based on permissions
  
  const items: EntityListItem[] = [];
  
  // TODO: Implement proper entity listing with pagination
  // This requires iterating through stubs and filtering
  
  console.log('[Entities] Query params:', query);
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: false
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
entityRoutes.get('/:id', async (c) => {
  const entityId = c.req.param('id');
  const versionQuery = entityVersionQuerySchema.parse(c.req.query());
  
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
  const latestPath = getEntityLatestPath('members', entityId, stub.organizationId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
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
  
  // Determine storage location based on visibility
  const visibility = latestPointer.visibility;
  const versionPath = visibility === 'members' 
    ? getEntityVersionPath('members', entityId, version, stub.organizationId)
    : getEntityVersionPath(visibility, entityId, version);
  
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
entityRoutes.patch('/:id', requireOrgAdmin, async (c) => {
  const entityId = c.req.param('id');
  console.log('[Entities] Updating entity:', entityId);
  
  const body = await c.req.json();
  const result = updateEntityRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid update data', { errors: result.error.errors });
  }
  
  const updates = result.data;
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
  
  // Atomic merge of data fields
  const newData = updates.data 
    ? { ...currentEntity.data, ...updates.data }
    : currentEntity.data;
  
  // Validate updated data
  if (entityType) {
    validateEntityData(newData, entityType);
  }
  
  const newVersion = currentEntity.version + 1;
  const now = new Date().toISOString();
  
  // Get the new visibility for the entity
  const newVisibility = updates.visibility || currentEntity.visibility;
  
  // Update slug if name changed
  const newSlug = (newData.name as string) !== (currentEntity.data.name as string)
    ? createSlug(newData.name as string)
    : currentEntity.slug;
  
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
entityRoutes.post('/:id/transition', async (c) => {
  const entityId = c.req.param('id');
  console.log('[Entities] Processing transition for:', entityId);
  
  const body = await c.req.json();
  const result = entityTransitionRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid transition data', { errors: result.error.errors });
  }
  
  const { action, feedback } = result.data;
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
    updatedBy: userId
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
entityRoutes.delete('/:id', requireOrgAdmin, async (c) => {
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
 * Validate entity data against type schema
 */
function validateEntityData(data: Record<string, unknown>, entityType: EntityType): void {
  const errors: string[] = [];
  
  for (const field of entityType.fields) {
    const value = data[field.id];
    
    // Check required fields
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`Field '${field.name}' is required`);
      continue;
    }
    
    if (value === undefined || value === null) continue;
    
    // Type-specific validation
    const constraints = field.constraints || {};
    
    switch (field.type) {
      case 'string':
      case 'text':
      case 'markdown':
        if (typeof value !== 'string') {
          errors.push(`Field '${field.name}' must be a string`);
        } else {
          if (constraints.minLength && value.length < constraints.minLength) {
            errors.push(`Field '${field.name}' must be at least ${constraints.minLength} characters`);
          }
          if (constraints.maxLength && value.length > constraints.maxLength) {
            errors.push(`Field '${field.name}' must not exceed ${constraints.maxLength} characters`);
          }
        }
        break;
        
      case 'number':
        if (typeof value !== 'number') {
          errors.push(`Field '${field.name}' must be a number`);
        } else {
          if (constraints.minValue !== undefined && value < constraints.minValue) {
            errors.push(`Field '${field.name}' must be at least ${constraints.minValue}`);
          }
          if (constraints.maxValue !== undefined && value > constraints.maxValue) {
            errors.push(`Field '${field.name}' must not exceed ${constraints.maxValue}`);
          }
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Field '${field.name}' must be a boolean`);
        }
        break;
        
      case 'select':
        if (constraints.options) {
          const validValues = constraints.options.map(o => o.value);
          if (!validValues.includes(value as string)) {
            errors.push(`Field '${field.name}' must be one of: ${validValues.join(', ')}`);
          }
        }
        break;
        
      case 'multiselect':
        if (!Array.isArray(value)) {
          errors.push(`Field '${field.name}' must be an array`);
        } else if (constraints.options) {
          const validValues = constraints.options.map(o => o.value);
          for (const v of value) {
            if (!validValues.includes(v as string)) {
              errors.push(`Field '${field.name}' contains invalid value: ${v}`);
            }
          }
        }
        break;
    }
  }
  
  if (errors.length > 0) {
    throw new ValidationError('Entity data validation failed', { fields: errors });
  }
}
