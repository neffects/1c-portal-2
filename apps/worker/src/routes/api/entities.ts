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
import { projectFieldsForKey, getUserHighestMembershipKey, loadAppConfig } from '../../lib/bundle-invalidation';
import { requireAbility } from '../../middleware/casl';
import { NotFoundError } from '../../middleware/error';
import type { Entity, EntityStub, EntityLatestPointer, EntityListItem, EntityType, VisibilityScope } from '@1cc/shared';

export const apiEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entities
 * List entities (authenticated platform content)
 */
apiEntityRoutes.get('/entities',
  requireAbility('read', 'Entity'),
  zValidator('query', entityQueryParamsSchema),
  async (c) => {
  console.log('[API] Listing entities');
  
  const query = c.req.valid('query');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = userRole === 'superadmin';
  
  console.log('[API] Query params:', query, 'userRole:', userRole, 'isSuperadmin:', isSuperadmin, 'userOrgId:', userOrgId);
  
  const items: EntityListItem[] = [];
  
  // Cache entity types
  const entityTypeCache = new Map<string, EntityType>();
  
  // Get CASL ability for file-level permission checks
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  async function getEntityType(typeId: string): Promise<EntityType | null> {
    if (entityTypeCache.has(typeId)) {
      return entityTypeCache.get(typeId)!;
    }
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId), ability);
    if (entityType) {
      entityTypeCache.set(typeId, entityType);
    }
    return entityType;
  }
  
  // Get all entity stubs - CASL verifies user can list entities
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`, ability);
  console.log('[API] Found', stubFiles.length, 'entity stubs');
  console.log('[API] Listing entities - filters:', {
    typeId: query.typeId,
    organizationId: query.organizationId,
    status: query.status,
    visibility: query.visibility,
    search: query.search,
    userRole,
    userOrgId
  });
  
  let processedCount = 0;
  let skippedCount = 0;
  let addedCount = 0;
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile, ability, 'read', 'Entity');
    if (!stub) {
      skippedCount++;
      continue;
    }
    
    processedCount++;
    
    // Filter by entity type if specified
    if (query.typeId && stub.entityTypeId !== query.typeId) {
      skippedCount++;
      continue;
    }
    
    console.log('[API] Processing stub for entity:', stub.entityId, 'type:', stub.entityTypeId, 'orgId:', stub.organizationId);
    
    // Filter by organization if specified
    if (query.organizationId !== undefined) {
      if (query.organizationId === null && stub.organizationId !== null) {
        skippedCount++;
        console.log('[API] Skipping org entity (looking for global)');
        continue;
      }
      if (query.organizationId !== null && stub.organizationId !== query.organizationId) {
        skippedCount++;
        console.log('[API] Skipping entity (orgId mismatch)');
        continue;
      }
    }
    
    // Access control: authenticated users can see published public/platform entities
    let latestPath: string | null = null;
    let latestPointer: EntityLatestPointer | null = null;
    
    if (stub.organizationId === null) {
      // Global entity - try public and authenticated paths - CASL verifies access
      for (const visibility of ['public', 'authenticated'] as const) {
        latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
        if (latestPointer) break;
      }
    } else {
      // Org entity - superadmins can see entities from ALL organizations
      // Regular users can only see entities from their own organization
      if (!isSuperadmin && userOrgId !== stub.organizationId) {
        skippedCount++;
        console.log('[API] Skipping org entity (not member, userRole:', userRole, 'userOrgId:', userOrgId, 'entityOrgId:', stub.organizationId, ')');
        continue;
      }
      // For superadmins viewing org entities, check members path for that organization
      // CASL verifies user can access this org's entities
      latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      console.log('[API] Checking latest pointer for org entity:', stub.entityId, 'in org:', stub.organizationId, 'at path:', latestPath);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath, ability, 'read', 'Entity');
    }
    
    if (!latestPointer) {
      skippedCount++;
      console.log('[API] No latest pointer found for entity:', stub.entityId);
      continue;
    }
    
    // Filter by status if specified
    if (query.status && latestPointer.status !== query.status) {
      skippedCount++;
      console.log('[API] Status filter mismatch:', latestPointer.status, '!=', query.status);
      continue;
    }
    
    // Filter by visibility if specified
    if (query.visibility && latestPointer.visibility !== query.visibility) {
      skippedCount++;
      console.log('[API] Visibility filter mismatch:', latestPointer.visibility, '!=', query.visibility);
      continue;
    }
    
    // Superadmins can see ALL entities regardless of status or visibility
    // Regular users can only see published entities with public/authenticated visibility
    if (!isSuperadmin) {
      // Only show published entities for authenticated users
      if (latestPointer.status !== 'published') {
        skippedCount++;
        console.log('[API] Skipping non-published entity (status:', latestPointer.status, ')');
        continue;
      }
      
      // Only show public or authenticated visibility (not members-only)
      if (latestPointer.visibility === 'members') {
        skippedCount++;
        console.log('[API] Skipping members-only entity');
        continue;
      }
    } else {
      // Superadmin: log but don't filter - show all entities
      console.log('[API] Superadmin access - including entity:', stub.entityId, 'status:', latestPointer.status, 'visibility:', latestPointer.visibility);
    }
    
    // Get full entity - CASL verifies user can access this entity file
    const storageVisibility: VisibilityScope = stub.organizationId === null 
      ? latestPointer.visibility 
      : 'members';
    const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
    const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath, ability, 'read', 'Entity');
    
    if (!entity) {
      skippedCount++;
      console.log('[API] Entity file not found at path:', entityPath);
      continue;
    }
    
    // Get entity type
    const entityType = await getEntityType(entity.entityTypeId);
    
    // Name is stored at top-level (common property)
    const nameValue = entity.name || `Entity ${entity.id}`;
    console.log('[API] Entity', entity.id, 'name:', nameValue);
    
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
    
    // Slug is stored at top-level (common property)
    const slugValue = entity.slug || '';
    
    const listItem: EntityListItem = {
      id: entity.id,
      entityTypeId: entity.entityTypeId,
      organizationId: entity.organizationId,
      slug: slugValue, // Top-level property
      name: nameValue, // Top-level property
      status: entity.status,
      visibility: entity.visibility,
      data: {
        // Only dynamic fields (description, etc.)
        ...(descriptionValue && { description: descriptionValue })
      },
      updatedAt: entity.updatedAt
    };
    
    items.push(listItem);
    addedCount++;
    console.log('[API] Added entity to list:', entity.id, 'name:', nameValue, '(total so far:', items.length, ')');
  }
  
  console.log('[API] Entity processing summary:', {
    processed: processedCount,
    skipped: skippedCount,
    added: addedCount,
    totalInList: items.length
  });
  
  // Sort by updatedAt descending
  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  // Pagination
  const start = (query.page - 1) * query.pageSize;
  const paginatedItems = items.slice(start, start + query.pageSize);
  
  console.log('[API] Returning', paginatedItems.length, 'of', items.length, 'entities (page', query.page, 'of', Math.ceil(items.length / query.pageSize) + ')');
  
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
 * GET /entities/:id
 * Get a global/platform entity by ID
 * 
 * This endpoint handles global entities (organizationId: null) stored in platform/ or public/ paths.
 * For org-scoped entities, use /api/orgs/:orgId/entities/:id instead.
 */
apiEntityRoutes.get('/entities/:id', requireAbility('read', 'Entity'), async (c) => {
  const entityId = c.req.param('id');
  const userRole = c.get('userRole');
  
  console.log('[API] GET /entities/:id -', entityId, 'userRole:', userRole);
  
  // Get entity stub to determine organization
  const stubPath = getEntityStubPath(entityId);
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubPath);
  
  if (!stub) {
    console.log('[API] Entity stub not found:', entityId);
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entity not found' }
    }, 404);
  }
  
  // This endpoint is for global entities only
  // Org-scoped entities should use /api/orgs/:orgId/entities/:id
  if (stub.organizationId !== null) {
    console.log('[API] Entity is org-scoped, use /api/orgs/:orgId/entities/:id instead');
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entity not found. Use /api/orgs/:orgId/entities/:id for organization entities.' }
    }, 404);
  }
  
  // Global entity - try authenticated (platform/) path first, then public/
  let entity: Entity | null = null;
  
  for (const visibility of ['authenticated', 'public'] as const) {
    const latestPath = getEntityLatestPath(visibility, entityId, undefined);
    const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    
    if (latestPointer) {
      const versionPath = getEntityVersionPath(visibility, entityId, latestPointer.version, undefined);
      entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath);
      
      if (entity) {
        console.log('[API] Entity found in', visibility, 'path');
        break;
      }
    }
  }
  
  if (!entity) {
    console.log('[API] Entity data not found:', entityId);
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entity not found' }
    }, 404);
  }
  
  // Non-superadmins can only view published entities
  if (userRole !== 'superadmin' && entity.status !== 'published') {
    console.log('[API] Entity not published, access denied for non-superadmin');
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entity not found' }
    }, 404);
  }
  
  // Project fields based on user's highest membership key
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(entity.entityTypeId));
  if (!entityType) {
    throw new NotFoundError('Entity Type', entity.entityTypeId);
  }
  
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const isSuperadmin = c.get('isSuperadmin') || false;
  
  let projectedEntity = entity;
  
  if (userId) {
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const highestKey = await getUserHighestMembershipKey(c.env.R2_BUCKET, userOrgId || null, isSuperadmin, config);
    
    // Check if type is visible to this key
    if (entityType.visibleTo?.includes(highestKey)) {
      projectedEntity = projectFieldsForKey(entity, entityType, highestKey, config);
    } else {
      // Fallback: return with public fields only
      projectedEntity = projectFieldsForKey(entity, entityType, 'public', config);
    }
  } else {
    // Unauthenticated: return with public fields only
    const config = await loadAppConfig(c.env.R2_BUCKET);
    projectedEntity = projectFieldsForKey(entity, entityType, 'public', config);
  }
  
  console.log('[API] Returning global entity:', entityId, 'status:', entity.status);
  
  return c.json({
    success: true,
    data: projectedEntity
  });
});
