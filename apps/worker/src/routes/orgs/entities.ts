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
import { regenerateEntityBundles, loadAppConfig } from '../../lib/bundle-invalidation';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId } from '../../lib/id';
import { requireAbility } from '../../middleware/casl';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError, AppError } from '../../middleware/error';
import { validateEntityData, validateEntityFields, checkSlugUniqueness } from '../../lib/entity-validation';
import type { Entity, EntityStub, EntityLatestPointer, EntityType, EntityTypePermissions, VisibilityScope, EntityStatus } from '@1cc/shared';

export const orgEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /entities
 * Create entity in organization
 * 
 * Request body:
 * - name: string (required) - entity name, stored at entity.name
 * - slug: string (required) - entity slug, stored at entity.slug
 * - entityTypeId: string (required) - the entity type ID
 * - data: object (optional) - dynamic fields only, stored at entity.data
 * - visibility: string (optional) - visibility scope
 */
orgEntityRoutes.post('/entities',
  requireAbility('create', 'Entity'),
  zValidator('json', createEntityRequestSchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const { entityTypeId, name, slug, data, visibility } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[OrgEntities] Creating entity in org:', orgId, {
    entityTypeId,
    name,
    slug,
    dataKeys: Object.keys(data || {}),
    visibility
  });
  
  // Get CASL ability for file-level permission checks
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Check permissions
  const permissions = await readJSON<EntityTypePermissions>(c.env.R2_BUCKET, getOrgPermissionsPath(orgId), ability);
  if (!permissions?.creatable.includes(entityTypeId)) {
    throw new ForbiddenError('This organization cannot create entities of this type');
  }
  
  // Get entity type
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entityTypeId), ability);
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate dynamic fields (name and slug are already validated by schema)
  const entityData = data ? validateEntityFields(data, entityType) : {};
  
  // Remove name and slug from entityData if they were accidentally included
  // They should be at top-level, not in the dynamic data object
  delete entityData.name;
  delete entityData.slug;
  
  const finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  const entityId = createEntityId();
  
  // Check slug uniqueness within org and entity type (uses slug index - O(1) check)
  await checkSlugUniqueness(
    c.env.R2_BUCKET,
    entityTypeId,
    orgId,
    slug.trim(),
    ability
  );
  
  const now = new Date().toISOString();
  
  // Create entity with name and slug at top-level
  const entity: Entity = {
    id: entityId,
    entityTypeId,
    organizationId: orgId,
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
    organizationId: orgId,
    entityTypeId,
    createdAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub, ability);
  
  const versionPath = getEntityVersionPath('members', entityId, 1, orgId);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity, ability);
  
  const latestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer, ability);
  
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
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    entityTypeId,
    orgId,
    config
  );
  
  return c.json({ success: true, data: entity }, 201);
});

/**
 * GET /entities
 * List entities in organization
 */
orgEntityRoutes.get('/entities',
  requireAbility('read', 'Entity'),
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
  requireAbility('read', 'Entity'),
  zValidator('query', entityVersionQuerySchema),
  async (c) => {
  const orgId = c.req.param('orgId')!;
  const entityId = c.req.param('id');
  const versionQuery = c.req.valid('query');
  
  console.log('[OrgEntities] Getting entity:', entityId, 'for org:', orgId);
  
  // Get CASL ability for file-level permission checks
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity stub - CASL verifies user can access this entity
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId), ability, 'read', 'Entity');
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer - CASL verifies user can access this org's entities
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Determine version to fetch
  const version = versionQuery.version || latestPointer.version;
  
  // Get entity version - CASL verifies user can access this org's entities
  const entityPath = getEntityVersionPath('members', entityId, version, orgId);
  const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath, ability, 'read', 'Entity');
  
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
  
  // Get CASL ability for file-level permission checks
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get entity stub - CASL verifies user can access this entity
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId), ability, 'read', 'Entity');
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer - CASL verifies user can access this org's entities
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only draft entities can be edited
  if (latestPointer.status !== 'draft') {
    throw new AppError('INVALID_STATUS', 'Only draft entities can be edited', 400);
  }
  
  // Get current version - CASL verifies user can access this org's entities
  const currentPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
  const currentEntity = await readJSON<Entity>(c.env.R2_BUCKET, currentPath, ability, 'read', 'Entity');
  
  if (!currentEntity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get entity type for validation
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(currentEntity.entityTypeId), ability);
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', currentEntity.entityTypeId);
  }
  
  // Get name and slug from top-level request (or keep existing values)
  const entityName = updates.name !== undefined ? updates.name : currentEntity.name;
  const entitySlug = updates.slug !== undefined ? updates.slug : currentEntity.slug;
  
  // Validate dynamic fields (name and slug are already handled above)
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
  const newVisibility = updates.visibility || currentEntity.visibility;
  const newSlug = entitySlug.trim();
  
  // Create new version with name and slug at top-level
  const updatedEntity: Entity = {
    ...currentEntity,
    version: newVersion,
    visibility: newVisibility,
    name: entityName.trim(),
    slug: newSlug,
    data: entityData, // Dynamic fields only
    updatedAt: now,
    updatedBy: userId
  };
  
  // Write new version - CASL verifies user can write to this org's entities
  const newVersionPath = getEntityVersionPath('members', entityId, newVersion, orgId);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity, ability);
  
  // Update latest pointer - CASL verifies user can write to this org's entities
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: updatedEntity.status,
    visibility: newVisibility,
    updatedAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, latestPath, newPointer, ability);
  
  // Update slug index if visibility is public and slug changed
  const currentSlug = currentEntity.slug;
  if (newVisibility === 'public') {
    if (currentSlug !== newSlug && currentEntity.visibility === 'public') {
      await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentSlug);
    }
    await upsertSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, newSlug, {
      entityId,
      visibility: newVisibility,
      organizationId: orgId,
      entityTypeId: currentEntity.entityTypeId
    });
  } else if (currentEntity.visibility === 'public' && newVisibility !== 'public') {
    await deleteSlugIndex(c.env.R2_BUCKET, orgId, entityType.slug, currentSlug);
  }
  
  console.log('[OrgEntities] Updated entity:', entityId, 'to v' + newVersion);
  
  // Regenerate affected bundles synchronously
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateEntityBundles(
    c.env.R2_BUCKET,
    currentEntity.entityTypeId,
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
  const ability = c.get('ability');
  
  console.log('[OrgEntities] Processing transition for:', entityId, 'action:', action);
  
  // Get entity stub - CASL verifies user can access this entity
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId), ability, 'read', 'Entity');
  
  if (!stub || stub.organizationId !== orgId) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Get latest pointer - CASL verifies user can access this org's entities
  const latestPath = getEntityLatestPath('members', entityId, orgId);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check permissions for the action
  const currentStatus = latestPointer.status;
  
  // CASL permission checks for approve/reject actions
  if (['approve', 'reject'].includes(action)) {
    if (!ability?.can('approve', 'Entity')) {
      throw new ForbiddenError('Only superadmins can approve or reject entities');
    }
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
  // Org entities: drafts/pending/members visibility use 'members', published public/authenticated use visibility-based paths
  let storageVisibility: VisibilityScope;
  if (latestPointer.status === 'draft' || latestPointer.status === 'pending') {
    // Drafts and pending entities are always in the org's private space
    storageVisibility = 'members';
  } else if (latestPointer.visibility === 'members') {
    // Published entities with members visibility
    storageVisibility = 'members';
  } else {
    // Published entities with public/authenticated visibility are in visibility-based paths
    storageVisibility = latestPointer.visibility;
  }
  
  // Get current entity version - CASL verifies user can access this org's entities
  const currentPath = getEntityVersionPath(storageVisibility, entityId, latestPointer.version, storageVisibility === 'members' ? orgId : undefined);
  const currentEntity = await readJSON<Entity>(c.env.R2_BUCKET, currentPath, ability, 'read', 'Entity');
  
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
  
  // Determine storage location based on new status and visibility
  // For org entities, use 'members' for drafts/pending, visibility-based for published
  let targetVisibility: VisibilityScope;
  
  // Org entity - use 'members' for drafts/pending, visibility-based for published
  targetVisibility = newStatus === 'published' ? currentEntity.visibility : 'members';
  
  // Write new version to appropriate location
  const newVersionPath = getEntityVersionPath(targetVisibility, entityId, newVersion, 
    targetVisibility === 'members' ? orgId : undefined);
  await writeJSON(c.env.R2_BUCKET, newVersionPath, updatedEntity, ability, undefined, 'update', 'Entity');
  
  // Update latest pointer
  const newPointer: EntityLatestPointer = {
    version: newVersion,
    status: newStatus,
    visibility: currentEntity.visibility,
    updatedAt: now
  };
  
  // Determine latest pointer location
  // For org entities, use members path for drafts/pending, visibility-based for published
  let newLatestPath: string;
  if (newStatus === 'published' && targetVisibility !== 'members') {
    newLatestPath = getEntityLatestPath(targetVisibility, entityId, undefined);
  } else {
    newLatestPath = latestPath;
  }
  
  // Update latest pointer at the appropriate location
  await writeJSON(c.env.R2_BUCKET, newLatestPath, newPointer, ability, undefined, 'update', 'Entity');
  
  // For org entities publishing to public/authenticated, also keep latest pointer in members path for reference
  if (newStatus === 'published' && targetVisibility !== 'members') {
    await writeJSON(c.env.R2_BUCKET, latestPath, newPointer, ability, undefined, 'update', 'Entity');
  }
  
  console.log('[OrgEntities] Transitioned entity:', entityId, currentStatus, '->', newStatus);
  
  // Regenerate affected bundles synchronously when publish status changes
  if (newStatus === 'published' || currentStatus === 'published') {
    console.log('[OrgEntities] Triggering bundle regeneration for type:', stub.entityTypeId);
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
