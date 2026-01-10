/**
 * Entity Type Routes
 * 
 * Handles entity type (schema) management:
 * - POST / - Create entity type (superadmin)
 * - GET / - List entity types
 * - GET /:id - Get entity type definition
 * - PATCH /:id - Update entity type
 * - DELETE /:id - Archive entity type
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { 
  createEntityTypeRequestSchema, 
  updateEntityTypeRequestSchema,
  entityTypeQueryParamsSchema 
} from '@1cc/shared';
import { readJSON, writeJSON, listFiles, getEntityTypePath, getOrgPermissionsPath } from '../lib/r2';
import { createEntityTypeId, createSlug } from '../lib/id';
import { requireSuperadmin } from '../middleware/auth';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { EntityType, EntityTypeListItem, FieldDefinition, FieldSection, EntityTypePermissions } from '@1cc/shared';

export const entityTypeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new entity type (superadmin only)
 */
entityTypeRoutes.post('/', requireSuperadmin, async (c) => {
  console.log('[EntityTypes] Creating entity type');
  
  const body = await c.req.json();
  const result = createEntityTypeRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid entity type data', { errors: result.error.errors });
  }
  
  const data = result.data;
  
  // Check if slug is unique
  const existingType = await findTypeBySlug(c.env.R2_BUCKET, data.slug);
  if (existingType) {
    throw new ConflictError(`Entity type with slug '${data.slug}' already exists`);
  }
  
  const typeId = createEntityTypeId();
  const now = new Date().toISOString();
  const userId = c.get('userId')!;
  
  // Generate IDs for fields and sections
  const fields: FieldDefinition[] = data.fields.map((field, index) => ({
    ...field,
    id: `field_${index}_${Date.now()}`
  }));
  
  const sections: FieldSection[] = data.sections.map((section, index) => ({
    ...section,
    id: `section_${index}_${Date.now()}`
  }));
  
  // Ensure all fields have valid section IDs
  const sectionIds = new Set(sections.map(s => s.id));
  for (const field of fields) {
    if (!sectionIds.has(field.sectionId)) {
      // Assign to first section if invalid
      field.sectionId = sections[0]?.id || 'default';
    }
  }
  
  const entityType: EntityType = {
    id: typeId,
    name: data.name,
    pluralName: data.pluralName,
    slug: data.slug,
    description: data.description,
    allowPublic: data.allowPublic,
    defaultVisibility: data.defaultVisibility,
    fields,
    sections,
    tableDisplayConfig: {
      showName: true,
      showStatus: true,
      showUpdated: true
    },
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    isActive: true
  };
  
  // Save entity type definition
  await writeJSON(c.env.R2_BUCKET, getEntityTypePath(typeId), entityType);
  
  console.log('[EntityTypes] Created entity type:', typeId);
  
  return c.json({
    success: true,
    data: entityType
  }, 201);
});

/**
 * GET /
 * List all entity types (filtered by permissions for non-superadmins)
 */
entityTypeRoutes.get('/', async (c) => {
  console.log('[EntityTypes] Listing entity types');
  
  const query = entityTypeQueryParamsSchema.parse(c.req.query());
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Get all entity types
  const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  let items: EntityTypeListItem[] = [];
  
  // Load viewable types for non-superadmins
  let viewableTypeIds: string[] | null = null;
  if (userRole !== 'superadmin' && userOrgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(userOrgId)
    );
    viewableTypeIds = permissions?.viewable || [];
  }
  
  for (const file of definitionFiles) {
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, file);
    if (!entityType) continue;
    
    // Skip inactive types unless requested
    if (!entityType.isActive && !query.includeInactive) continue;
    
    // Filter by permissions for non-superadmins
    if (viewableTypeIds !== null && !viewableTypeIds.includes(entityType.id)) {
      continue;
    }
    
    // Apply search filter
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      if (!entityType.name.toLowerCase().includes(searchLower) &&
          !entityType.pluralName.toLowerCase().includes(searchLower)) {
        continue;
      }
    }
    
    items.push({
      id: entityType.id,
      name: entityType.name,
      pluralName: entityType.pluralName,
      slug: entityType.slug,
      description: entityType.description,
      allowPublic: entityType.allowPublic,
      fieldCount: entityType.fields.length,
      entityCount: await countTypeEntities(c.env.R2_BUCKET, entityType.id),
      isActive: entityType.isActive
    });
  }
  
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  
  // Pagination
  const start = (query.page - 1) * query.pageSize;
  const paginatedItems = items.slice(start, start + query.pageSize);
  
  console.log('[EntityTypes] Found', items.length, 'entity types');
  
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
 * GET /:id
 * Get entity type definition
 */
entityTypeRoutes.get('/:id', async (c) => {
  const typeId = c.req.param('id');
  console.log('[EntityTypes] Getting entity type:', typeId);
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check permissions for non-superadmins
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  if (userRole !== 'superadmin' && userOrgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(userOrgId)
    );
    
    if (!permissions?.viewable.includes(typeId)) {
      throw new NotFoundError('Entity Type', typeId);
    }
  }
  
  return c.json({
    success: true,
    data: entityType
  });
});

/**
 * PATCH /:id
 * Update entity type (superadmin only)
 */
entityTypeRoutes.patch('/:id', requireSuperadmin, async (c) => {
  const typeId = c.req.param('id');
  console.log('[EntityTypes] Updating entity type:', typeId);
  
  const body = await c.req.json();
  const result = updateEntityTypeRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid entity type data', { errors: result.error.errors });
  }
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  const updates = result.data;
  
  // Check slug uniqueness if changing
  if (updates.slug && updates.slug !== entityType.slug) {
    const existingType = await findTypeBySlug(c.env.R2_BUCKET, updates.slug);
    if (existingType) {
      throw new ConflictError(`Entity type with slug '${updates.slug}' already exists`);
    }
  }
  
  // Merge updates
  const updatedType: EntityType = {
    ...entityType,
    name: updates.name ?? entityType.name,
    pluralName: updates.pluralName ?? entityType.pluralName,
    slug: updates.slug ?? entityType.slug,
    description: updates.description ?? entityType.description,
    allowPublic: updates.allowPublic ?? entityType.allowPublic,
    defaultVisibility: updates.defaultVisibility ?? entityType.defaultVisibility,
    fields: updates.fields ?? entityType.fields,
    sections: updates.sections ?? entityType.sections,
    tableDisplayConfig: updates.tableDisplayConfig ?? entityType.tableDisplayConfig,
    updatedAt: new Date().toISOString(),
    updatedBy: c.get('userId')!
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityTypePath(typeId), updatedType);
  
  console.log('[EntityTypes] Updated entity type:', typeId);
  
  return c.json({
    success: true,
    data: updatedType
  });
});

/**
 * DELETE /:id
 * Archive entity type (superadmin only)
 */
entityTypeRoutes.delete('/:id', requireSuperadmin, async (c) => {
  const typeId = c.req.param('id');
  console.log('[EntityTypes] Archiving entity type:', typeId);
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Soft delete - mark as inactive
  const updatedType: EntityType = {
    ...entityType,
    isActive: false,
    updatedAt: new Date().toISOString(),
    updatedBy: c.get('userId')!
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityTypePath(typeId), updatedType);
  
  console.log('[EntityTypes] Archived entity type:', typeId);
  
  return c.json({
    success: true,
    data: { message: 'Entity type archived successfully' }
  });
});

// Helper functions

/**
 * Find entity type by slug
 */
async function findTypeBySlug(bucket: R2Bucket, slug: string): Promise<EntityType | null> {
  const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  for (const file of definitionFiles) {
    const entityType = await readJSON<EntityType>(bucket, file);
    if (entityType && entityType.slug === slug) {
      return entityType;
    }
  }
  
  return null;
}

/**
 * Count entities of a specific type
 */
async function countTypeEntities(bucket: R2Bucket, typeId: string): Promise<number> {
  // Count from public, platform, and all orgs
  let count = 0;
  
  // Public entities
  const publicFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entities/`);
  count += countEntitiesOfType(publicFiles, typeId);
  
  // Platform entities  
  const platformFiles = await listFiles(bucket, `${R2_PATHS.PLATFORM}entities/`);
  count += countEntitiesOfType(platformFiles, typeId);
  
  // This is simplified - in production would need to check stubs
  return count;
}

/**
 * Count entities of a type in a file list
 */
function countEntitiesOfType(files: string[], typeId: string): number {
  // Count unique entity directories that have latest.json
  const latestFiles = files.filter(f => f.endsWith('/latest.json'));
  // In a real implementation, we'd check the entity's typeId
  return latestFiles.length;
}
