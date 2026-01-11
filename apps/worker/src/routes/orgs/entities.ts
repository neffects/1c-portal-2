/**
 * Org Entity Routes
 * 
 * CRUD /api/orgs/:orgId/entities - Org-scoped entity management
 * Note: Middleware ensures user is member of org before these routes execute
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { createEntityRequestSchema, updateEntityRequestSchema, entityQueryParamsSchema, entityVersionQuerySchema } from '@1cc/shared';
import { readJSON, writeJSON, listFiles, getEntityVersionPath, getEntityLatestPath, getEntityStubPath, getEntityTypePath, getOrgPermissionsPath } from '../../lib/r2';
import { upsertSlugIndex, deleteSlugIndex } from '../../lib/slug-index';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId, createSlug } from '../../lib/id';
import { requireAbility } from '../../middleware/casl';
import { NotFoundError, ForbiddenError, ValidationError } from '../../middleware/error';
import { validateEntityData, validateEntityFields } from '../../lib/entity-validation';
import type { Entity, EntityStub, EntityLatestPointer, EntityType, EntityTypePermissions, VisibilityScope } from '@1cc/shared';

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
