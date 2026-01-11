/**
 * Org Entity Routes
 * 
 * CRUD /api/orgs/:orgId/entities - Org-scoped entity management
 * Note: Middleware ensures user is member of org before these routes execute
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { createEntityRequestSchema, updateEntityRequestSchema, entityQueryParamsSchema, entityVersionQuerySchema, entityTransitionRequestSchema } from '@1cc/shared';
import { isValidTransition, getAllowedTransitions } from '@1cc/xstate-machines';
import { readJSON, writeJSON, listFiles, getEntityVersionPath, getEntityLatestPath, getEntityStubPath, getEntityTypePath, getOrgPermissionsPath } from '../../lib/r2';
import { upsertSlugIndex, deleteSlugIndex } from '../../lib/slug-index';
import { regenerateEntityBundles } from '../../lib/bundle-invalidation';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId, createSlug } from '../../lib/id';
import { requireAbility } from '../../middleware/casl';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError, AppError } from '../../middleware/error';
import { validateEntityData, validateEntityFields } from '../../lib/entity-validation';
import type { Entity, EntityStub, EntityLatestPointer, EntityType, EntityTypePermissions, VisibilityScope, EntityStatus } from '@1cc/shared';

export const orgEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /entities
 * Create entity in organization
 */
orgEntityRoutes.post('/entities',
  requireAbility('create', 'Entity'),
  zValidator('json', createEntityRequestSchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const { entityTypeId, data, visibility } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[OrgEntities] Creating entity in org:', orgId);
  
  // Check permissions
  const permissions = await readJSON<EntityTypePermissions>(c.env.R2_BUCKET, getOrgPermissionsPath(orgId));
  if (!permissions?.creatable.includes(entityTypeId)) {
    throw new ForbiddenError('This organization cannot create entities of this type');
  }
  
  // Get entity type
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entityTypeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate fields
  const validatedData = validateEntityFields(data, entityType);
  validateEntityData(validatedData, entityType);
  
  const finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  const entityId = createEntityId();
  const entityName = (data.name as string) || `Entity ${entityId}`;
  
  let slug: string;
  if (validatedData.slug && typeof validatedData.slug === 'string') {
    slug = validatedData.slug;
    delete validatedData.slug;
  } else {
    slug = createSlug(entityName);
  }
  
  // Check slug uniqueness within org and entity type
  // Scan actual entities in R2 (more reliable than potentially stale bundle)
  console.log('[OrgEntities] Checking slug uniqueness for:', slug, 'in org:', orgId, 'type:', entityTypeId);
  
  const entityPrefix = `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`;
  const entityFiles = await listFiles(c.env.R2_BUCKET, entityPrefix);
  const latestFiles = entityFiles.filter(f => f.endsWith('/latest.json'));
  
  console.log('[OrgEntities] Found', latestFiles.length, 'entities in org to check');
  
  for (const latestFile of latestFiles) {
    // Extract entity ID from path
    const entityIdMatch = latestFile.match(/entities\/([^\/]+)\/latest\.json/);
    if (!entityIdMatch) continue;
    
    const existingEntityId = entityIdMatch[1];
    
    // Read latest pointer
    const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestFile);
    if (!latestPointer) continue;
    
    // Read actual entity
    const versionPath = latestFile.replace('latest.json', `v${latestPointer.version}.json`);
    const existingEntity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath);
    
    if (!existingEntity) continue;
    
    // Skip if different entity type
    if (existingEntity.entityTypeId !== entityTypeId) continue;
    
    // Check slug match
    if (existingEntity.slug === slug) {
      console.log('[OrgEntities] Slug conflict detected:', slug, 'belongs to entity:', existingEntityId);
      throw new ConflictError(
        `Slug '${slug}' already exists for this entity type in this organization`,
        { existingEntityId: existingEntityId, existingEntityName: existingEntity.data?.name }
      );
    }
  }
  
  console.log('[OrgEntities] Slug is unique, proceeding with creation');
  
  const now = new Date().toISOString();
  
  const entity: Entity = {
    id: entityId,
    entityTypeId,
    organizationId: orgId,
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
  
  const stub: EntityStub = {
    entityId,
    organizationId: orgId,
    entityTypeId,
    createdAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
  
  const versionPath = getEntityVersionPath('members', entityId, 1, orgId);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity);
  
  const latestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
  
  // Create slug index for public entities
  if (finalVisibility === 'public') {
    await upsertSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, slug, {
      entityId,
      visibility: finalVisibility,
      organizationId: orgId,
      entityTypeId
    });
  }
  
  console.log('[OrgEntities] Created entity:', entityId);
  
  // Regenerate affected bundles synchronously
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    entityTypeId,
    orgId,
    finalVisibility
  );
  
  return c.json({ success: true, data: entity }, 201);
});

/**
 * GET /entities
 * List entities in organization
 */
orgEntityRoutes.get('/entities',
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const query = c.req.valid('query');
  
  // Implementation similar to existing entity listing but filtered to orgId
  // TODO: Implement full listing logic
  
  return c.json({
    success: true,
    data: { items: [], total: 0, page: query.page, pageSize: query.pageSize, hasMore: false }
  });
});

/**
 * GET /entities/:id
 * Get entity by ID within organization
 */
orgEntityRoutes.get('/entities/:id',
  zValidator('query', entityVersionQuerySchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const entityId = c.req.param('id');
  const versionQuery = c.req.valid('query');
  
  console.log('[OrgEntities] Getting entity:', entityId, 'for org:', orgId);
  
  // Get entity stub
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Determine version to fetch
  const version = versionQuery.version || latestPointer.version;
  
  // Get entity version
  const entityPath = getEntityVersionPath('members', entityId, version, orgId);
  const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
  
  if (!entity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  return c.json({
    success: true,
    data: entity
  });
});

/**
 * PATCH /entities/:id
 * Update entity within organization
 */
orgEntityRoutes.patch('/entities/:id',
  requireAbility('update', 'Entity'),
  zValidator('json', updateEntityRequestSchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const entityId = c.req.param('id');
  const updates = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[OrgEntities] Updating entity:', entityId, 'in org:', orgId);
  
  // Get entity stub
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only draft entities can be edited
  if (latestPointer.status !== 'draft') {
    throw new AppError('INVALID_STATUS', 'Only draft entities can be edited', 400);
  }
  
  // Get current version
  const currentPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
  const currentEntity = await readJSON<Entity>(c.env.R2_BUCKET, currentPath);
  
  if (!currentEntity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get entity type for validation
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(currentEntity.entityTypeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', currentEntity.entityTypeId);
  }
  
  // Validate each field individually before merging
  let newData = currentEntity.data;
  if (updates.data) {
    const validatedUpdates = validateEntityFields(updates.data, entityType);
    newData = { ...currentEntity.data, ...validatedUpdates };
    validateEntityData(newData, entityType);
  }
  
  const newVersion = currentEntity.version + 1;
  const now = new Date().toISOString();
  const newVisibility = updates.visibility || currentEntity.visibility;
  
  // Extract slug from data if provided
  let newSlug = currentEntity.slug;
  if (newData.slug && typeof newData.slug === 'string') {
    newSlug = newData.slug;
    delete newData.slug;
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
  
  // Write new version
  const newVersionPath = getEntityVersionPath('members', entityId, newVersion, orgId);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity);
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: updatedEntity.status,
    visibility: newVisibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer);
  
  // Update slug index if visibility is public and slug changed
  if (newVisibility === 'public') {
    if (currentEntity.slug !== newSlug && currentEntity.visibility === 'public') {
      await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentEntity.slug);
    }
    await upsertSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, newSlug, {
      entityId,
      visibility: newVisibility,
      organizationId: orgId,
      entityTypeId: currentEntity.entityTypeId
    });
  } else if (currentEntity.visibility === 'public' && newVisibility !== 'public') {
    await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentEntity.slug);
  }
  
  console.log('[OrgEntities] Updated entity:', entityId, 'to v' + newVersion);
  
  // Regenerate affected bundles synchronously
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    currentEntity.entityTypeId,
    orgId,
    newVisibility
  );
  
  // If visibility changed, also regenerate old visibility bundle
  if (currentEntity.visibility !== newVisibility) {
    await regenerateEntityBundles(
      c.env.R2_BUCKET,
      currentEntity.entityTypeId,
      orgId,
      currentEntity.visibility
    );
  }
  
  return c.json({
    success: true,
    data: updatedEntity
  });
});

/**
 * POST /entities/:id/transition
 * Handle status transitions for entity within organization
 */
orgEntityRoutes.post('/entities/:id/transition',
  zValidator('json', entityTransitionRequestSchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const entityId = c.req.param('id');
  const { action, feedback } = c.req.valid('json');
  const userId = c.get('userId')!;
  const userRole = c.get('userRole');
  
  console.log('[OrgEntities] Processing transition for:', entityId, 'action:', action);
  
  // Get entity stub
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer
  const latestPath = getEntityLatestPath('members', entityId, orgId);
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
  const currentPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
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
    ...((['approve', 'reject'].includes(action)) && {
      approvalFeedback: feedback || undefined,
      approvalActionAt: now,
      approvalActionBy: userId
    })
  };
  
  // Write new version
  const newVersionPath = getEntityVersionPath('members', entityId, newVersion, orgId);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity);
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: newStatus,
    visibility: currentEntity.visibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer);
  
  console.log('[OrgEntities] Transitioned entity:', entityId, currentStatus, '->', newStatus);
  
  // Regenerate affected bundles synchronously when publish status changes
  if (newStatus === 'published' || currentStatus === 'published') {
    console.log('[OrgEntities] Triggering bundle regeneration for type:', stub.entityTypeId);
    await regenerateEntityBundles(
      c.env.R2_BUCKET,
      stub.entityTypeId,
      orgId,
      currentEntity.visibility
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
