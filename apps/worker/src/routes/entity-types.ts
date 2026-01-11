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
import { zValidator } from '@hono/zod-validator';
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
entityTypeRoutes.post('/',
  requireSuperadmin,
  zValidator('json', createEntityTypeRequestSchema),
  async (c) => {
  console.log('[EntityTypes] Creating entity type');
  
  const data = c.req.valid('json');
  
  // Check if slug is unique
  const existingType = await findTypeBySlug(c.env.R2_BUCKET, data.slug);
  if (existingType) {
    throw new ConflictError(`Entity type with slug '${data.slug}' already exists`);
  }
  
  const typeId = createEntityTypeId();
  const now = new Date().toISOString();
  const userId = c.get('userId')!;
  
  // Generate IDs for fields and sections
  // Preserve hard-coded IDs for 'name' and 'slug' fields (required fields)
  const fields: FieldDefinition[] = data.fields.map((field, index) => ({
    ...field,
    // Keep 'name' and 'slug' IDs as-is, generate IDs for other fields
    id: field.id === 'name' || field.id === 'slug' 
      ? field.id 
      : `field_${index}_${Date.now()}`
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
  
  // Auto-grant permissions to all existing organizations
  await grantTypeToAllOrganizations(c.env.R2_BUCKET, typeId, userId);
  
  return c.json({
    success: true,
    data: entityType
  }, 201);
});

/**
 * GET /
 * List all entity types (filtered by permissions for non-superadmins)
 * 
 * Query params:
 * - permission: 'viewable' (default) or 'creatable'
 *   - viewable: types the org can view (for browsing entities)
 *   - creatable: types the org can create (for entity creation forms)
 */
entityTypeRoutes.get('/',
  zValidator('query', entityTypeQueryParamsSchema),
  async (c) => {
  console.log('[EntityTypes] Listing entity types');
  
  const query = c.req.valid('query');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  console.log('[EntityTypes] User role:', userRole, 'Org:', userOrgId, 'Permission filter:', query.permission);
  
  // Get all entity types
  const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  let items: EntityTypeListItem[] = [];
  
  // Load permitted types for non-superadmins based on permission filter
  let allowedTypeIds: string[] | null = null;
  if (userRole !== 'superadmin' && userOrgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(userOrgId)
    );
    
    // Filter by viewable or creatable based on query param
    if (query.permission === 'creatable') {
      allowedTypeIds = permissions?.creatable || [];
      console.log('[EntityTypes] Filtering by creatable permissions:', allowedTypeIds);
    } else {
      allowedTypeIds = permissions?.viewable || [];
      console.log('[EntityTypes] Filtering by viewable permissions:', allowedTypeIds);
    }
  }
  
  for (const file of definitionFiles) {
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, file);
    if (!entityType) continue;
    
    // Skip inactive types unless requested
    if (!entityType.isActive && !query.includeInactive) continue;
    
    // Filter by permissions for non-superadmins
    if (allowedTypeIds !== null && !allowedTypeIds.includes(entityType.id)) {
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
      defaultVisibility: entityType.defaultVisibility,
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
  // Allow access if type is viewable OR creatable (you can create entities of a type you can't view)
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  if (userRole !== 'superadmin' && userOrgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(userOrgId)
    );
    
    const canView = permissions?.viewable.includes(typeId) || false;
    const canCreate = permissions?.creatable.includes(typeId) || false;
    
    if (!canView && !canCreate) {
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
entityTypeRoutes.patch('/:id',
  requireSuperadmin,
  zValidator('json', updateEntityTypeRequestSchema),
  async (c) => {
  const typeId = c.req.param('id');
  console.log('[EntityTypes] Updating entity type:', typeId);
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  const updates = c.req.valid('json');
  
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
 * POST /migrate-permissions
 * Grant all existing entity types to all organizations (superadmin only)
 * One-time migration endpoint
 */
entityTypeRoutes.post('/migrate-permissions', requireSuperadmin, async (c) => {
  console.log('[EntityTypes] Running permissions migration...');
  
  const userId = c.get('userId')!;
  
  // Get all entity types
  const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
  const typeIds: string[] = [];
  
  for (const file of typeFiles) {
    if (file.endsWith('.json')) {
      const type = await readJSON<EntityType>(c.env.R2_BUCKET, file);
      if (type && type.isActive) {
        typeIds.push(type.id);
      }
    }
  }
  
  console.log('[EntityTypes] Found', typeIds.length, 'active entity types');
  
  // Grant each type to all organizations
  for (const typeId of typeIds) {
    await grantTypeToAllOrganizations(c.env.R2_BUCKET, typeId, userId);
  }
  
  return c.json({
    success: true,
    data: {
      message: 'Permissions migrated successfully',
      typesProcessed: typeIds.length
    }
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

/**
 * Grant permissions for a new entity type to all existing organizations
 */
async function grantTypeToAllOrganizations(
  bucket: R2Bucket,
  typeId: string,
  updatedBy: string
): Promise<void> {
  console.log('[EntityTypes] Granting type permissions to all organizations:', typeId);
  
  try {
    // Find all organizations
    const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    
    for (const file of profileFiles) {
      // Extract org ID from path: private/orgs/{orgId}/profile.json
      const pathParts = file.split('/');
      const orgId = pathParts[pathParts.length - 2];
      
      if (!orgId) continue;
      
      // Load existing permissions or create new
      const permissionsPath = getOrgPermissionsPath(orgId);
      let permissions = await readJSON<EntityTypePermissions>(bucket, permissionsPath);
      
      if (!permissions) {
        permissions = {
          organizationId: orgId,
          viewable: [typeId],
          creatable: [typeId],
          updatedAt: new Date().toISOString(),
          updatedBy
        };
      } else {
        // Add type if not already present
        if (!permissions.viewable.includes(typeId)) {
          permissions.viewable.push(typeId);
        }
        if (!permissions.creatable.includes(typeId)) {
          permissions.creatable.push(typeId);
        }
        permissions.updatedAt = new Date().toISOString();
        permissions.updatedBy = updatedBy;
      }
      
      await writeJSON(bucket, permissionsPath, permissions);
      console.log('[EntityTypes] Granted permissions to org:', orgId);
    }
  } catch (error) {
    console.error('[EntityTypes] Error granting permissions:', error);
    // Don't fail the type creation if permissions fail
  }
}
