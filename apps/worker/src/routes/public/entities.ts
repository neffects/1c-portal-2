/**
 * Public Entity Routes
 * 
 * GET /public/entities/:id - Get public entity by ID
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getEntityLatestPath, getEntityVersionPath, getEntityStubPath, getEntityTypePath } from '../../lib/r2';
import { NotFoundError } from '../../middleware/error';
import { projectFieldsForKey, loadAppConfig } from '../../lib/bundle-invalidation';
import type { Entity, EntityStub, EntityLatestPointer, VisibilityScope, EntityType } from '@1cc/shared';

export const publicEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entities/:id
 * Get public entity by ID (no auth required, but only returns public entities)
 */
publicEntityRoutes.get('/entities/:id', async (c) => {
  const entityId = c.req.param('id');
  console.log('[Public] Getting entity:', entityId);
  
  // Get entity stub to determine organization
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Try public visibility first
  let latestPointer: EntityLatestPointer | null = null;
  let latestPath: string | null = null;
  
  // For global entities (null orgId), try public path
  if (stub.organizationId === null) {
    latestPath = getEntityLatestPath('public', entityId);
    latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  }
  
  if (!latestPointer) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Only return if visibility is public
  if (latestPointer.visibility !== 'public') {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Read entity version
  const storageVisibility: VisibilityScope = stub.organizationId === null ? 'public' : 'public';
  const entityPath = getEntityVersionPath(storageVisibility, entityId, latestPointer.version, stub.organizationId || undefined);
  const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
  
  if (!entity) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Project fields for 'public' membership key
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entity.entityTypeId));
  if (!entityType) {
    throw new NotFoundError('Entity Type', entity.entityTypeId);
  }
  
  const config = await loadAppConfig(c.env.R2_BUCKET);
  const projectedEntity = projectFieldsForKey(entity, entityType, 'public', config);
  
  return c.json({
    success: true,
    data: projectedEntity
  });
});
