/**
 * Superadmin Entity Routes
 * 
 * CRUD /api/super/entities - Superadmin entity management (including global entities)
 * 
 * Routes:
 * - GET /entities/export - Export entities for a type
 * - POST /entities/bulk-import - Atomic bulk import with versioning
 * - POST /entities - Create entity (global or any org)
 * - GET /entities - List entities
 * - GET /entities/:id - Get entity by ID
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { 
  createEntityRequestSchema, 
  updateEntityRequestSchema, 
  entityQueryParamsSchema,
  exportQuerySchema,
  bulkImportRequestSchema
} from '@1cc/shared';
import type { BulkImportError } from '@1cc/shared';
import { 
  readJSON, writeJSON, listFiles, 
  getEntityVersionPath, getEntityLatestPath, getEntityStubPath, 
  getEntityTypePath, getOrgPermissionsPath 
} from '../../lib/r2';
import { regenerateEntityBundles } from '../../lib/bundle-invalidation';
import { upsertSlugIndex, deleteSlugIndex } from '../../lib/slug-index';
import { R2_PATHS } from '@1cc/shared';
import { createEntityId, createSlug } from '../../lib/id';
import { NotFoundError, ForbiddenError, ValidationError } from '../../middleware/error';
import { validateEntityData, validateEntityFields } from '../../lib/entity-validation';
import type { 
  Entity, EntityStub, EntityLatestPointer, EntityType, 
  EntityTypePermissions, VisibilityScope 
} from '@1cc/shared';

export const superEntityRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entities/export
 * Export entities for a type (superadmin only)
 * Returns entities with the entity type schema for CSV template generation
 */
superEntityRoutes.get('/entities/export',
  zValidator('query', exportQuerySchema),
  async (c) => {
  console.log('[SuperEntities] Export handler called');
  
  const query = c.req.valid('query');
  console.log('[SuperEntities] Exporting entities for type:', query.typeId);
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(query.typeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', query.typeId);
  }
  
  // Collect all entities for this type
  const entities: Entity[] = [];
  
  // Get all entity stubs to find entities
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub || stub.entityTypeId !== query.typeId) continue;
    
    // Filter by organization if specified
    if (query.organizationId !== undefined) {
      if (query.organizationId === null && stub.organizationId !== null) continue;
      if (query.organizationId !== null && stub.organizationId !== query.organizationId) continue;
    }
    
    // Get latest pointer
    let latestPointer: EntityLatestPointer | null = null;
    
    if (stub.organizationId === null) {
      // Global entity - try public and authenticated paths
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        if (latestPointer) break;
      }
    } else {
      // Org entity - use members path
      const latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (!latestPointer) continue;
    
    // Filter by status if specified
    if (query.status && latestPointer.status !== query.status) continue;
    
    // Get full entity
    const storageVisibility: VisibilityScope = stub.organizationId === null 
      ? latestPointer.visibility 
      : 'members';
    const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
    const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
    
    if (entity) {
      entities.push(entity);
    }
  }
  
  // Sort by createdAt
  entities.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  console.log('[SuperEntities] Exporting', entities.length, 'entities for type:', query.typeId);
  
  return c.json({
    success: true,
    data: {
      entityType: {
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug,
        fields: entityType.fields,
        sections: entityType.sections
      },
      entities,
      exportedAt: new Date().toISOString()
    }
  });
});

/**
 * POST /entities/bulk-import
 * Bulk import entities (superadmin only)
 * Atomic operation: validates ALL entities first, only creates if ALL pass
 * Supports per-row organizationId, slug, and entity ID for versioning
 */
superEntityRoutes.post('/entities/bulk-import',
  zValidator('json', bulkImportRequestSchema),
  async (c) => {
  console.log('[SuperEntities] Bulk importing entities');
  
  const { entityTypeId, organizationId: defaultOrgId, entities: importEntities } = c.req.valid('json');
  const userId = c.get('userId')!;
  
  // Get entity type definition
  const entityType = await readJSON<EntityType>(
    c.env.R2_BUCKET,
    getEntityTypePath(entityTypeId)
  );
  
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', entityTypeId);
  }
  
  // Collect unique organization IDs from all entities for permission validation
  const uniqueOrgIds = new Set<string>();
  for (const entity of importEntities) {
    // Per-row organizationId takes precedence over default
    const orgId = entity.organizationId !== undefined ? entity.organizationId : defaultOrgId;
    if (orgId !== null && orgId !== undefined) {
      uniqueOrgIds.add(orgId);
    }
  }
  
  // Check organization permissions for all unique orgs
  for (const orgId of uniqueOrgIds) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(orgId)
    );
    
    if (!permissions?.creatable.includes(entityTypeId)) {
      throw new ForbiddenError(`Organization ${orgId} cannot create entities of this type`);
    }
  }
  
  // Phase 1: Validate ALL entities and check which are creates vs updates
  const validationErrors: BulkImportError[] = [];
  
  // Categorize entities: create new, update existing, or create with specific ID
  type ValidatedEntity = {
    rowIndex: number;
    data: Record<string, unknown>;
    visibility: VisibilityScope;
    slug: string;
    organizationId: string | null;
    mode: 'create' | 'update' | 'create-with-id';
    entityId?: string;
    existingEntity?: Entity;
    existingVersion?: number;
  };
  
  const validatedEntities: ValidatedEntity[] = [];
  
  // Collect existing slugs for uniqueness validation (only for new entities)
  const existingSlugs = new Map<string, string>(); // key: "orgId|slug", value: entityId that owns it
  const batchNewSlugs = new Map<string, number>(); // key: "orgId|slug", value: row index
  
  // First pass: Load existing slugs for this entity type
  const stubFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.STUBS}`);
  for (const stubFile of stubFiles) {
    if (!stubFile.endsWith('.json')) continue;
    const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubFile);
    if (!stub || stub.entityTypeId !== entityTypeId) continue;
    
    // Get entity to read its slug
    let latestPointer: EntityLatestPointer | null = null;
    if (stub.organizationId === null) {
      for (const visibility of ['public', 'authenticated'] as const) {
        const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
        latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        if (latestPointer) break;
      }
    } else {
      const latestPath = getEntityLatestPath('members', stub.entityId, stub.organizationId);
      latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
    }
    
    if (latestPointer) {
      const storageVisibility: VisibilityScope = stub.organizationId === null 
        ? latestPointer.visibility 
        : 'members';
      const entityPath = getEntityVersionPath(storageVisibility, stub.entityId, latestPointer.version, stub.organizationId || undefined);
      const entity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath);
      if (entity) {
        const slugKey = `${stub.organizationId || 'global'}|${entity.slug}`;
        existingSlugs.set(slugKey, entity.id);
      }
    }
  }
  
  for (let i = 0; i < importEntities.length; i++) {
    const importEntity = importEntities[i];
    
    // Determine organization for this entity (per-row takes precedence)
    const entityOrgId = importEntity.organizationId !== undefined 
      ? importEntity.organizationId 
      : (defaultOrgId ?? null);
    
    // Check if entity ID is provided
    const providedId = importEntity.id;
    let mode: 'create' | 'update' | 'create-with-id' = 'create';
    let existingEntity: Entity | undefined;
    let existingVersion: number | undefined;
    
    if (providedId) {
      // Check if entity exists
      const existingStub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(providedId));
      
      if (existingStub) {
        // Entity exists - this is an update
        mode = 'update';
        
        // Verify entity type matches
        if (existingStub.entityTypeId !== entityTypeId) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} belongs to a different entity type`
          });
          continue;
        }
        
        // Get current entity for update
        let latestPointer: EntityLatestPointer | null = null;
        if (existingStub.organizationId === null) {
          for (const visibility of ['public', 'authenticated'] as const) {
            const latestPath = getEntityLatestPath(visibility, providedId, undefined);
            latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
            if (latestPointer) break;
          }
        } else {
          const latestPath = getEntityLatestPath('members', providedId, existingStub.organizationId);
          latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
        }
        
        if (!latestPointer) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} not found (corrupted state)`
          });
          continue;
        }
        
        existingVersion = latestPointer.version;
        
        // Get current entity data
        const storageVisibility: VisibilityScope = existingStub.organizationId === null 
          ? latestPointer.visibility 
          : 'members';
        const entityPath = getEntityVersionPath(storageVisibility, providedId, latestPointer.version, existingStub.organizationId || undefined);
        existingEntity = await readJSON<Entity>(c.env.R2_BUCKET, entityPath) || undefined;
        
        if (!existingEntity) {
          validationErrors.push({
            rowIndex: i,
            field: 'id',
            message: `Entity ${providedId} version ${latestPointer.version} not found`
          });
          continue;
        }
      } else {
        // Entity doesn't exist - create with this specific ID
        mode = 'create-with-id';
      }
    }
    
    try {
      // Validate each field individually
      const validatedData = validateEntityFields(importEntity.data, entityType);
      
      // Final validation to ensure required fields are present
      validateEntityData(validatedData, entityType);
      
      // Determine visibility
      let finalVisibility: VisibilityScope = importEntity.visibility || entityType.defaultVisibility;
      // Global entities cannot have 'members' visibility
      if (entityOrgId === null && finalVisibility === 'members') {
        finalVisibility = 'authenticated';
      }
      
      // Handle slug: use provided slug, or from data, or auto-generate from name
      const entityName = (validatedData.name as string) || `Entity ${i + 1}`;
      let slug: string;
      
      if (importEntity.slug) {
        // Slug provided at entity level (already validated by Zod schema)
        slug = importEntity.slug;
      } else if (validatedData.slug && typeof validatedData.slug === 'string') {
        // Slug in data field
        slug = validatedData.slug;
        delete validatedData.slug;
      } else if (mode === 'update' && existingEntity) {
        // For updates without slug, keep existing slug
        slug = existingEntity.slug;
      } else {
        // Auto-generate from name
        slug = createSlug(entityName);
      }
      
      // Validate slug uniqueness for new entities (create or create-with-id)
      if (mode !== 'update') {
        const slugKey = `${entityOrgId || 'global'}|${slug}`;
        
        // Check against existing slugs in database
        const existingOwner = existingSlugs.get(slugKey);
        if (existingOwner && existingOwner !== providedId) {
          validationErrors.push({
            rowIndex: i,
            field: 'slug',
            message: `Slug '${slug}' already exists for this entity type and organization`
          });
          continue;
        }
        
        // Check against other new entities in this batch
        const batchDuplicate = batchNewSlugs.get(slugKey);
        if (batchDuplicate !== undefined) {
          validationErrors.push({
            rowIndex: i,
            field: 'slug',
            message: `Duplicate slug '${slug}' - already used in row ${batchDuplicate + 1} of this import`
          });
          continue;
        }
        
        // Track this slug for batch duplicate detection
        batchNewSlugs.set(slugKey, i);
      }
      
      validatedEntities.push({
        rowIndex: i,
        data: validatedData,
        visibility: finalVisibility,
        slug,
        organizationId: entityOrgId,
        mode,
        entityId: providedId,
        existingEntity,
        existingVersion
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        // Extract field-specific errors if available
        const details = error.details as { fields?: string[] } | undefined;
        if (details?.fields && Array.isArray(details.fields)) {
          for (const fieldError of details.fields) {
            validationErrors.push({
              rowIndex: i,
              message: fieldError
            });
          }
        } else {
          validationErrors.push({
            rowIndex: i,
            message: error.message
          });
        }
      } else {
        validationErrors.push({
          rowIndex: i,
          message: error instanceof Error ? error.message : 'Unknown validation error'
        });
      }
    }
  }
  
  // If any validation errors, return them all (atomic - no entities created/updated)
  if (validationErrors.length > 0) {
    console.log('[SuperEntities] Bulk import validation failed:', validationErrors.length, 'errors');
    return c.json({
      success: false,
      errors: validationErrors
    }, 400);
  }
  
  // Phase 2: Create/Update all entities (all validation passed)
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const now = new Date().toISOString();
  
  for (const validated of validatedEntities) {
    if (validated.mode === 'update' && validated.existingEntity && validated.existingVersion !== undefined) {
      // Update existing entity - create new version
      const newVersion = validated.existingVersion + 1;
      
      const updatedEntity: Entity = {
        ...validated.existingEntity,
        version: newVersion,
        visibility: validated.visibility,
        slug: validated.slug,
        data: validated.data,
        updatedAt: now,
        updatedBy: userId
      };
      
      // Write new version
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const versionPath = getEntityVersionPath(storageVisibility, validated.entityId!, newVersion, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, versionPath, updatedEntity);
      
      // Update latest pointer
      const latestPointer: EntityLatestPointer = {
        version: newVersion,
        status: validated.existingEntity.status, // Keep existing status
        visibility: validated.visibility,
        updatedAt: now
      };
      
      const latestPath = getEntityLatestPath(storageVisibility, validated.entityId!, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
      
      updatedIds.push(validated.entityId!);
    } else {
      // Create new entity (with generated ID or specific ID)
      const entityId = validated.entityId || createEntityId();
      
      const entity: Entity = {
        id: entityId,
        entityTypeId,
        organizationId: validated.organizationId,
        version: 1,
        status: 'draft',
        visibility: validated.visibility,
        slug: validated.slug,
        data: validated.data,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId
      };
      
      // Write entity stub
      const stub: EntityStub = {
        entityId,
        organizationId: validated.organizationId,
        entityTypeId,
        createdAt: now
      };
      
      await writeJSON(c.env.R2_BUCKET, getEntityStubPath(entityId), stub);
      
      // Write entity version
      const storageVisibility: VisibilityScope = validated.organizationId === null ? validated.visibility : 'members';
      const versionPath = getEntityVersionPath(storageVisibility, entityId, 1, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, versionPath, entity);
      
      // Write latest pointer
      const latestPointer: EntityLatestPointer = {
        version: 1,
        status: 'draft',
        visibility: validated.visibility,
        updatedAt: now
      };
      
      const latestPath = getEntityLatestPath(storageVisibility, entityId, validated.organizationId || undefined);
      await writeJSON(c.env.R2_BUCKET, latestPath, latestPointer);
      
      createdIds.push(entityId);
    }
  }
  
  console.log('[SuperEntities] Bulk import complete - created:', createdIds.length, 'updated:', updatedIds.length);
  
  // Regenerate bundles for all affected orgs after bulk import
  const orgVisibilityCombos = new Map<string, Set<VisibilityScope>>();
  
  for (const validated of validatedEntities) {
    const key = validated.organizationId || 'global';
    if (!orgVisibilityCombos.has(key)) {
      orgVisibilityCombos.set(key, new Set());
    }
    orgVisibilityCombos.get(key)!.add(validated.visibility);
  }
  
  for (const [orgKey, visibilities] of orgVisibilityCombos) {
    const orgId = orgKey === 'global' ? null : orgKey;
    for (const visibility of visibilities) {
      console.log('[SuperEntities] Regenerating bundles for bulk import - org:', orgKey, 'visibility:', visibility);
      await regenerateEntityBundles(c.env.R2_BUCKET, entityTypeId, orgId, visibility);
    }
  }
  
  return c.json({
    success: true,
    data: {
      created: createdIds,
      updated: updatedIds,
      count: createdIds.length + updatedIds.length
    }
  }, 201);
});

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
 * GET /entities/:id
 * Get any entity by ID (superadmin can access global and org-scoped entities)
 */
superEntityRoutes.get('/entities/:id', async (c) => {
  const entityId = c.req.param('id');
  
  console.log('[SuperEntities] GET /entities/:id -', entityId);
  
  // Get entity stub to determine organization
  const stubPath = getEntityStubPath(entityId);
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, stubPath);
  
  if (!stub) {
    console.log('[SuperEntities] Entity stub not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  let entity: Entity | null = null;
  const orgId = stub.organizationId;
  
  if (orgId === null) {
    // Global entity - try authenticated (platform/) path first, then public/
    for (const visibility of ['authenticated', 'public'] as const) {
      const latestPath = getEntityLatestPath(visibility, entityId, undefined);
      const latestPointer = await readJSON<{ version: number }>(c.env.R2_BUCKET, latestPath);
      
      if (latestPointer) {
        const versionPath = getEntityVersionPath(visibility, entityId, latestPointer.version, undefined);
        entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath);
        
        if (entity) {
          console.log('[SuperEntities] Global entity found in', visibility, 'path');
          break;
        }
      }
    }
  } else {
    // Org-scoped entity - try members path (most common for org entities)
    const latestPath = getEntityLatestPath('members', entityId, orgId);
    const latestPointer = await readJSON<{ version: number }>(c.env.R2_BUCKET, latestPath);
    
    if (latestPointer) {
      const versionPath = getEntityVersionPath('members', entityId, latestPointer.version, orgId);
      entity = await readJSON<Entity>(c.env.R2_BUCKET, versionPath);
      console.log('[SuperEntities] Org entity found for org:', orgId);
    }
  }
  
  if (!entity) {
    console.log('[SuperEntities] Entity data not found:', entityId);
    throw new NotFoundError('Entity', entityId);
  }
  
  console.log('[SuperEntities] Returning entity:', entityId, 'orgId:', entity.organizationId, 'status:', entity.status);
  
  return c.json({
    success: true,
    data: entity
  });
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
