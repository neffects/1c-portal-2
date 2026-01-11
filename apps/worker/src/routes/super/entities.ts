/**
 * Superadmin Entity Routes
 * 
 * CRUD /api/super/entities - Superadmin entity management (including global entities)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { createEntityRequestSchema, updateEntityRequestSchema, entityQueryParamsSchema } from '@1cc/shared';
import { readJSON, writeJSON, listFiles, getEntityVersionPath, getEntityLatestPath, getEntityStubPath, getEntityTypePath } from '../../lib/r2';
import { upsertSlugIndex, deleteSlugIndex } from '../../lib/slug-index';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId, createSlug } from '../../lib/id';
import { NotFoundError, ForbiddenError, ValidationError } from '../../middleware/error';
import { validateEntityData, validateEntityFields } from '../../lib/entity-validation';
import type { Entity, EntityStub, EntityType, VisibilityScope } from '@1cc/shared';

export const superEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /entities
 * Create entity (supports global entities with organizationId: null)
 */
superEntityRoutes.post('/entities',
  zValidator('json', createEntityRequestSchema),
  async (c) => {
  const { entityTypeId, data, visibility, organizationId: requestedOrgId } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  console.log('[SuperEntities] Creating entity, orgId:', requestedOrgId);
  
  // Superadmins can create global entities (null orgId) or entities in any org
  const targetOrgId: string | null = requestedOrgId ?? null;
  
  // Get entity type
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entityTypeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Validate fields
  const validatedData = validateEntityFields(data, entityType);
  validateEntityData(validatedData, entityType);
  
  // Determine visibility - global entities cannot be 'members' visibility
  let finalVisibility: VisibilityScope = visibility || entityType.defaultVisibility;
  if (targetOrgId === null && finalVisibility === 'members') {
    finalVisibility = 'authenticated';
    console.log('[SuperEntities] Global entity visibility changed from members to authenticated');
  }
  
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
  
  const stub: EntityStub = {
    entityId,
    organizationId: targetOrgId,
    entityTypeId,
    createdAt: now
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
  
  // For global entities, use visibility-based path; for org entities, use members path
  const storageVisibility: VisibilityScope = targetOrgId === null ? finalVisibility : 'members';
  const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, versionPath, entity);
  
  const latestPointer = {
    version: 1,
    status: 'draft',
    visibility: finalVisibility,
    updatedAt: now
  };
  
  const latestPath = getEntityLatestPath(storageVisibility, entityId, targetOrgId || undefined);
  await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
  
  // Create slug index for public entities
  if (finalVisibility === 'public') {
    await upsertSlugIndex(c.env.R2_BUCKET, targetOrgId, entityType.slug, slug, {
      entityId,
      visibility: finalVisibility,
      organizationId: targetOrgId,
      entityTypeId
    });
  }
  
  return c.json({ success: true, data: entity }, 201);
});

/**
 * GET /entities
 * List entities (supports filtering by organizationId, including null for global entities)
 */
superEntityRoutes.get('/entities',
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  const query = c.req.valid('query');
  
  // Implementation similar to existing entity listing
  // TODO: Implement full listing logic for superadmin view
  
  return c.json({
    success: true,
    data: { items: [], total: 0, page: query.page, pageSize: query.pageSize, hasMore: false }
  });
});
