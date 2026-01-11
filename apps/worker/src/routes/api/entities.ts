/**
 * API Entity Routes
 * 
 * GET /api/entities - List entities (authenticated users can see platform content)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { entityQueryParamsSchema } from '@1cc/shared';
import { readJSON, listFiles, getEntityLatestPath, getEntityVersionPath, getEntityStubPath, getEntityTypePath } from '../../lib/r2';
import { R2_PATHS } from '@1cc/shared';
import type { Entity, EntityStub, EntityLatestPointer, EntityListItem, EntityType, VisibilityScope } from '@1cc/shared';

export const apiEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entities
 * List entities (authenticated platform content)
 */
apiEntityRoutes.get('/entities',
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  console.log('[API] Listing entities');
  
  const query = c.req.valid('query');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  console.log('[API] Query params:', query, 'userRole:', userRole, 'userOrgId:', userOrgId);
  
  const items: EntityListItem[] = [];
  
  // Cache entity types
  const entityTypeCache = new Map<string, EntityType>();
  
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
  
  // Get all entity stubs
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  console.log('[API] Found', stubFiles.length, 'entity stubs');
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub) continue;
    
    // Filter by entity type if specified
    if (query.typeId && stub.entityTypeId !== query.typeId) continue;
    
    // Filter by organization if specified
    if (query.organizationId !== undefined) {
      if (query.organizationId === null && stub.organizationId !== null) continue;
      if (query.organizationId !== null && stub.organizationId !== query.organizationId) continue;
    }
    
    // Access control: authenticated users can see published public/platform entities
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
      // Org entity - only show if user is member or superadmin
      if (userRole !== 'superadmin' && userOrgId !== stub.organizationId) {
        continue;
      }
      latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (!latestPointer) continue;
    
    // Filter by status if specified
    if (query.status && latestPointer.status !== query.status) continue;
    
    // Filter by visibility if specified
    if (query.visibility && latestPointer.visibility !== query.visibility) continue;
    
    // Only show published entities for authenticated users (unless superadmin)
    if (userRole !== 'superadmin' && latestPointer.status !== 'published') continue;
    
    // Only show public or authenticated visibility (not members-only)
    if (userRole !== 'superadmin' && latestPointer.visibility === 'members') continue;
    
    // Get full entity
    const storageVisibility: VisibilityScope = stub.organizationId === null 
      ? latestPointer.visibility 
      : 'members';
    const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
    const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
    
    if (!entity) continue;
    
    // Get entity type
    const entityType = await getEntityType(entity.entityTypeId);
    
    // Extract name
    let nameValue: string | undefined;
    if (entity.data.name) {
      nameValue = entity.data.name as string;
    } else if (entityType && entityType.fields.length > 0) {
      const nameFieldId = entityType.fields[0].id;
      nameValue = entity.data[nameFieldId] as string | undefined;
    }
    
    // Extract description
    let descriptionValue: string | undefined;
    if (entity.data.description) {
      descriptionValue = entity.data.description as string;
    } else if (entityType && entityType.fields.length > 1) {
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
    
    const listItem: EntityListItem = {
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
  
  console.log('[API] Returning', paginatedItems.length, 'of', items.length, 'entities');
  
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
