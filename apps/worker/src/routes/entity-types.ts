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
import { readJSON, writeJSON, listFiles, deleteFile, getEntityTypePath, getOrgPermissionsPath, getEntityLatestPath, getEntityStubPath, getEntityVersionPath } from '../lib/r2';
import { regenerateEntityBundles } from '../lib/bundle-invalidation';
import { deleteSlugIndex } from '../lib/slug-index';
import { regenerateManifestsForType, regenerateAllManifests, loadAppConfig, validateVisibleTo, validateFieldVisibility } from '../lib/bundle-invalidation';
import { createEntityTypeId, createSlug } from '../lib/id';
import { requireSuperadmin } from '../middleware/auth';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { EntityType, EntityTypeListItem, FieldDefinition, FieldSection, EntityTypePermissions, EntityStub, EntityLatestPointer, VisibilityScope, Entity, Organization } from '@1cc/shared';

export const entityTypeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new entity type (superadmin only)
 */
entityTypeRoutes.post('/',
  requireSuperadmin(),
  zValidator('json', createEntityTypeRequestSchema),
  async (c) => {
  console.log('[EntityTypes] Creating entity type');
  
  const data = c.req.valid('json');
  
  // Load config and validate membership key references
  const config = await loadAppConfig(c.env.R2_BUCKET);
  
  // Validate visibleTo contains valid membership key IDs
  const visibleToError = validateVisibleTo(data.visibleTo, config);
  if (visibleToError) {
    throw new ValidationError(visibleToError);
  }
  
  // Validate fieldVisibility if provided
  if (data.fieldVisibility) {
    const fieldVisError = validateFieldVisibility(data.fieldVisibility, config);
    if (fieldVisError) {
      throw new ValidationError(fieldVisError);
    }
  }
  
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
    visibleTo: data.visibleTo,
    fieldVisibility: data.fieldVisibility,
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
  
  console.log('[EntityTypes] Created entity type:', typeId, 'visibleTo:', entityType.visibleTo);
  
  // Auto-grant permissions to all existing organizations
  await grantTypeToAllOrganizations(c.env.R2_BUCKET, typeId, userId);
  
  // Regenerate all manifests to include the new type (config already loaded above)
  console.log('[EntityTypes] Regenerating manifests for newly created type:', typeId);
  await regenerateManifestsForType(c.env.R2_BUCKET, typeId, config);
  console.log('[EntityTypes] Manifest regeneration complete for new type:', typeId);
  
  // Generate bundles for this new entity type (even if empty)
  // This ensures bundles exist immediately when the type is created
  if (entityType.visibleTo && Array.isArray(entityType.visibleTo) && entityType.visibleTo.length > 0) {
    console.log('[EntityTypes] Generating bundles for newly created type:', typeId);
    try {
      // Generate global bundles (for each key in visibleTo)
      await regenerateEntityBundles(c.env.R2_BUCKET, typeId, null, config);
      
      // Generate org bundles for all existing organizations
      const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`);
      const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
      
      for (const file of profileFiles) {
        const org = await readJSON<Organization>(c.env.R2_BUCKET, file);
        if (org && org.isActive) {
          try {
            await regenerateEntityBundles(c.env.R2_BUCKET, typeId, org.id, config);
          } catch (error) {
            console.error('[EntityTypes] Error generating bundles for org', org.id, ':', error);
            // Continue with other orgs even if one fails
          }
        }
      }
      console.log('[EntityTypes] Bundle generation complete for new type:', typeId);
    } catch (error) {
      console.error('[EntityTypes] Error generating bundles for new type:', typeId, error);
      // Don't fail type creation if bundle generation fails - log and continue
    }
  } else {
    console.log('[EntityTypes] Skipping bundle generation - entity type has no visibleTo configured');
  }
  
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
  
  try {
    const query = c.req.valid('query');
    const userRole = c.get('userRole');
    const userOrgId = c.get('organizationId');
    
    console.log('[EntityTypes] User role:', userRole, 'Org:', userOrgId, 'Permission filter:', query.permission);
    
    // Get all entity types
    const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    
    console.log('[EntityTypes] Found', definitionFiles.length, 'entity type definition files');
    
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
    
    // Collect all entity types first
    const typeData: Array<{ type: EntityType; countPromise: Promise<number> }> = [];
    
    for (const file of definitionFiles) {
      try {
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
        
        // Start counting entities in parallel (don't await yet)
        typeData.push({
          type: entityType,
          countPromise: countTypeEntities(c.env.R2_BUCKET, entityType.id)
        });
      } catch (err) {
        console.error('[EntityTypes] Error reading entity type file', file, ':', err);
        continue;
      }
    }
    
    console.log('[EntityTypes] Processing', typeData.length, 'entity types');
    
    // Wait for all entity counts to complete in parallel (with timeout protection)
    console.log('[EntityTypes] Counting entities for', typeData.length, 'types...');
    let counts: number[] = [];
    try {
      const countPromises = typeData.map(td => 
        Promise.race([
          td.countPromise,
          new Promise<number>((resolve) => setTimeout(() => {
            console.warn('[EntityTypes] Entity count timeout for type, returning 0');
            resolve(0);
          }, 3000)) // 3 second timeout per count
        ]).catch(() => {
          console.warn('[EntityTypes] Entity count error, returning 0');
          return 0;
        })
      );
      counts = await Promise.all(countPromises);
    } catch (countError) {
      console.error('[EntityTypes] Error during entity counting, using 0 for all:', countError);
      // Use 0 for all counts if counting fails
      counts = new Array(typeData.length).fill(0);
    }
    
    // Build items with counts
    for (let i = 0; i < typeData.length; i++) {
      const { type: entityType } = typeData[i];
      items.push({
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug,
        description: entityType.description,
        visibleTo: entityType.visibleTo,
        fieldCount: entityType.fields.length,
        entityCount: counts[i] || 0,
        isActive: entityType.isActive
      });
    }
    
    // Sort by name
    items.sort((a, b) => a.name.localeCompare(b.name));
    
    // Pagination
    const start = (query.page - 1) * query.pageSize;
    const paginatedItems = items.slice(start, start + query.pageSize);
    
    console.log('[EntityTypes] Found', items.length, 'entity types, returning', paginatedItems.length, 'items');
    
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
  } catch (error) {
    console.error('[EntityTypes] Error listing entity types:', error);
    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list entity types'
      }
    }, 500);
  }
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
    
    const canView = permissions?.viewable?.includes(typeId) || false;
    const canCreate = permissions?.creatable?.includes(typeId) || false;
    
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
  requireSuperadmin(),
  zValidator('json', updateEntityTypeRequestSchema),
  async (c) => {
  const typeId = c.req.param('id');
  console.log('[EntityTypes] Updating entity type:', typeId);
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  const updates = c.req.valid('json');
  
  // Load config for validation and manifest regeneration
  const config = await loadAppConfig(c.env.R2_BUCKET);
  
  // Validate visibleTo if provided
  if (updates.visibleTo) {
    const visibleToError = validateVisibleTo(updates.visibleTo, config);
    if (visibleToError) {
      throw new ValidationError(visibleToError);
    }
  }
  
  // Validate fieldVisibility if provided
  if (updates.fieldVisibility) {
    const fieldVisError = validateFieldVisibility(updates.fieldVisibility, config);
    if (fieldVisError) {
      throw new ValidationError(fieldVisError);
    }
  }
  
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
    visibleTo: updates.visibleTo ?? entityType.visibleTo,
    fieldVisibility: updates.fieldVisibility ?? entityType.fieldVisibility,
    fields: updates.fields ?? entityType.fields,
    sections: updates.sections ?? entityType.sections,
    tableDisplayConfig: updates.tableDisplayConfig ?? entityType.tableDisplayConfig,
    updatedAt: new Date().toISOString(),
    updatedBy: c.get('userId')!
  };
  
  await writeJSON(c.env.R2_BUCKET, getEntityTypePath(typeId), updatedType);
  
  console.log('[EntityTypes] Updated entity type:', typeId);
  
  // Check if visibleTo actually changed (compare arrays)
  const visibleToChanged = updates.visibleTo !== undefined && 
    JSON.stringify(updates.visibleTo?.sort()) !== JSON.stringify(entityType.visibleTo?.sort());
  
  // Check if fieldVisibility actually changed
  const fieldVisibilityChanged = updates.fieldVisibility !== undefined &&
    JSON.stringify(updates.fieldVisibility) !== JSON.stringify(entityType.fieldVisibility);
  
  // Regenerate manifests if metadata that appears in manifests changed
  // or visibility settings changed (affects which keys see this type)
  const metadataChanged = 
    updates.name !== undefined ||
    updates.pluralName !== undefined ||
    updates.slug !== undefined ||
    updates.description !== undefined ||
    visibleToChanged ||
    fieldVisibilityChanged;
    
  if (metadataChanged) {
    if (visibleToChanged) {
      console.log('[EntityTypes] visibleTo changed from', entityType.visibleTo, 'to', updates.visibleTo, '- regenerating manifests');
    } else {
      console.log('[EntityTypes] Metadata changed, regenerating manifests');
    }
    await regenerateManifestsForType(c.env.R2_BUCKET, typeId, config);
    console.log('[EntityTypes] Manifest regeneration complete for type:', typeId);
  } else {
    console.log('[EntityTypes] No manifest-affecting changes detected, skipping manifest regeneration');
  }
  
  // Regenerate bundles if visibleTo changed (affects which bundles should exist)
  if (visibleToChanged) {
    console.log('[EntityTypes] visibleTo changed - regenerating bundles for type:', typeId);
    try {
      // Regenerate global bundles (for each key in visibleTo)
      await regenerateEntityBundles(c.env.R2_BUCKET, typeId, null, config);
      
      // Regenerate org bundles for all existing organizations
      const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`);
      const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
      
      for (const file of profileFiles) {
        const org = await readJSON<Organization>(c.env.R2_BUCKET, file);
        if (org && org.isActive) {
          try {
            await regenerateEntityBundles(c.env.R2_BUCKET, typeId, org.id, config);
          } catch (error) {
            console.error('[EntityTypes] Error regenerating bundles for org', org.id, ':', error);
            // Continue with other orgs even if one fails
          }
        }
      }
      console.log('[EntityTypes] Bundle regeneration complete for type:', typeId);
    } catch (error) {
      console.error('[EntityTypes] Error regenerating bundles for type:', typeId, error);
      // Don't fail type update if bundle regeneration fails - log and continue
    }
  }
  
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
entityTypeRoutes.post('/migrate-permissions', requireSuperadmin(), async (c) => {
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
entityTypeRoutes.delete('/:id', requireSuperadmin(), async (c) => {
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
  
  // Regenerate manifests to remove the archived type
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateManifestsForType(c.env.R2_BUCKET, typeId, config);
  
  return c.json({
    success: true,
    data: { message: 'Entity type archived successfully' }
  });
});

/**
 * DELETE /:id/hard
 * Permanently delete entity type (superadmin only)
 * 
 * WARNING: This is a destructive operation that cannot be undone!
 * 
 * Query parameters:
 * - deleteEntities: boolean (optional) - If true, also deletes all entities of this type
 * 
 * Requirements:
 * - If deleteEntities is false/omitted: Entity type must have NO entities associated with it
 * - If deleteEntities is true: All entities of this type will be permanently deleted first
 * - Removes the type definition file from R2
 * - Removes the type from all organization permissions
 * - Regenerates manifests to reflect the deletion
 */
entityTypeRoutes.delete('/:id/hard', requireSuperadmin(), async (c) => {
  const typeId = c.req.param('id');
  const deleteEntities = c.req.query('deleteEntities') === 'true';
  console.log('[EntityTypes] HARD DELETE - Starting permanent deletion of entity type:', typeId, 'deleteEntities:', deleteEntities);
  
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  
  if (!entityType) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check if there are any entities of this type
  const entityCount = await countTypeEntities(c.env.R2_BUCKET, typeId);
  
  if (entityCount > 0 && !deleteEntities) {
    console.log('[EntityTypes] HARD DELETE blocked - type has', entityCount, 'entities');
    throw new ValidationError(
      `Cannot permanently delete entity type "${entityType.name}" because it has ${entityCount} associated entity/entities. ` +
      `Please delete or migrate all entities of this type before performing a hard delete, or use deleteEntities=true to delete them.`
    );
  }
  
  // If deleteEntities is true, delete all entities of this type first
  if (deleteEntities && entityCount > 0) {
    console.log('[EntityTypes] HARD DELETE - Deleting', entityCount, 'entities of type:', typeId);
    await deleteAllEntitiesOfType(c.env.R2_BUCKET, typeId, entityType);
    console.log('[EntityTypes] HARD DELETE - All entities deleted, proceeding with type deletion');
  } else {
    console.log('[EntityTypes] HARD DELETE - No entities found, proceeding with deletion');
  }
  
  // 1. Clean up any orphaned stubs (stubs without entity data)
  console.log('[EntityTypes] HARD DELETE - Cleaning up orphaned stubs');
  await cleanupOrphanedStubs(c.env.R2_BUCKET, typeId);
  
  // 2. Delete the entity type definition file
  const typePath = getEntityTypePath(typeId);
  console.log('[EntityTypes] HARD DELETE - Deleting definition file:', typePath);
  await deleteFile(c.env.R2_BUCKET, typePath);
  
  // 3. Remove this type from all organization permissions
  console.log('[EntityTypes] HARD DELETE - Removing from org permissions');
  await removeTypeFromAllOrganizations(c.env.R2_BUCKET, typeId);
  
  // 4. Regenerate all manifests (type will be excluded since it no longer exists)
  // We can't use regenerateManifestsForType because the type file is already deleted
  // Instead, regenerate all manifests which will list files and exclude deleted types
  console.log('[EntityTypes] HARD DELETE - Regenerating all manifests');
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateAllManifests(c.env.R2_BUCKET, config);
  
  console.log('[EntityTypes] HARD DELETE - Completed permanent deletion of entity type:', typeId, entityType.name);
  
  return c.json({
    success: true,
    data: { 
      message: `Entity type "${entityType.name}" has been permanently deleted`,
      typeId,
      typeName: entityType.name
    }
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
 * Only counts entities that actually have data (not orphaned stubs)
 */
async function countTypeEntities(bucket: R2Bucket, typeId: string): Promise<number> {
  try {
    // Use stubs for faster counting (more efficient than listing all entity files)
    const stubFiles = await listFiles(bucket, `${R2_PATHS.STUBS}`);
    let count = 0;
    
    // Count stubs that match this entity type AND have actual entity data
    // Stub files are directly in stubs/ like stubs/abc1234.json
    // Skip slug-index subdirectory
    for (const stubFile of stubFiles) {
      if (!stubFile.endsWith('.json')) continue;
      const filename = stubFile.replace(`${R2_PATHS.STUBS}`, '');
      // Skip files in subdirectories (like slug-index)
      if (filename.includes('/')) continue;
      
      try {
        const stub = await readJSON<EntityStub>(bucket, stubFile);
        if (!stub || stub.entityTypeId !== typeId) continue;
        
        // Verify entity actually has data (not just an orphaned stub)
        // Check if latest pointer exists
        const orgId = stub.organizationId;
        let hasData = false;
        
        if (orgId === null) {
          // Global entity - check both authenticated and public paths
          for (const visibility of ['authenticated', 'public'] as const) {
            const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
            const latestPointer = await readJSON<{ version?: number }>(bucket, latestPath);
            if (latestPointer) {
              hasData = true;
              break;
            }
          }
        } else {
          // Org entity - check members path
          const latestPath = getEntityLatestPath('members', stub.entityId, orgId);
          const latestPointer = await readJSON<{ version?: number }>(bucket, latestPath);
          if (latestPointer) {
            hasData = true;
          }
        }
        
        // Only count if entity has actual data
        if (hasData) {
          count++;
        } else {
          console.log('[EntityTypes] Found orphaned stub (no entity data):', stub.entityId);
        }
      } catch (err) {
        // Skip invalid stub files
        continue;
      }
    }
    
    return count;
  } catch (error) {
    console.error('[EntityTypes] Error counting entities for type', typeId, ':', error);
    return 0; // Return 0 on error rather than failing the entire request
  }
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
        // Ensure arrays exist before using includes/push
        if (!permissions.viewable) permissions.viewable = [];
        if (!permissions.creatable) permissions.creatable = [];
        
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

/**
 * Remove permissions for an entity type from all organizations
 * Called during hard delete to clean up org permission references
 */
async function removeTypeFromAllOrganizations(
  bucket: R2Bucket,
  typeId: string
): Promise<void> {
  console.log('[EntityTypes] Removing type permissions from all organizations:', typeId);
  
  try {
    // Find all organizations
    const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    
    for (const file of profileFiles) {
      // Extract org ID from path: private/orgs/{orgId}/profile.json
      const pathParts = file.split('/');
      const orgId = pathParts[pathParts.length - 2];
      
      if (!orgId) continue;
      
      // Load existing permissions
      const permissionsPath = getOrgPermissionsPath(orgId);
      const permissions = await readJSON<EntityTypePermissions>(bucket, permissionsPath);
      
      if (!permissions) continue;
      
      // Remove type from viewable and creatable arrays
      let modified = false;
      
      if (permissions.viewable && permissions.viewable.includes(typeId)) {
        permissions.viewable = permissions.viewable.filter(id => id !== typeId);
        modified = true;
      }
      
      if (permissions.creatable && permissions.creatable.includes(typeId)) {
        permissions.creatable = permissions.creatable.filter(id => id !== typeId);
        modified = true;
      }
      
      // Only write back if we made changes
      if (modified) {
        permissions.updatedAt = new Date().toISOString();
        await writeJSON(bucket, permissionsPath, permissions);
        console.log('[EntityTypes] Removed type from org permissions:', orgId);
      }
    }
  } catch (error) {
    console.error('[EntityTypes] Error removing type from permissions:', error);
    // Don't fail the hard delete if permissions cleanup fails - log and continue
  }
}

/**
 * Clean up orphaned stubs (stubs without corresponding entity data)
 * Called during hard delete to remove any leftover stub files
 */
async function cleanupOrphanedStubs(
  bucket: R2Bucket,
  typeId: string
): Promise<void> {
  console.log('[EntityTypes] Cleaning up orphaned stubs for type:', typeId);
  
  try {
    const stubFiles = await listFiles(bucket, `${R2_PATHS.STUBS}`);
    let cleanedCount = 0;
    
    for (const stubFile of stubFiles) {
      if (!stubFile.endsWith('.json')) continue;
      const filename = stubFile.replace(`${R2_PATHS.STUBS}`, '');
      // Skip files in subdirectories (like slug-index)
      if (filename.includes('/')) continue;
      
      try {
        const stub = await readJSON<EntityStub>(bucket, stubFile);
        if (!stub || stub.entityTypeId !== typeId) continue;
        
        // Check if entity actually has data
        const orgId = stub.organizationId;
        let hasData = false;
        
        if (orgId === null) {
          // Global entity - check both authenticated and public paths
          for (const visibility of ['authenticated', 'public'] as const) {
            const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
            const latestPointer = await readJSON<{ version?: number }>(bucket, latestPath);
            if (latestPointer) {
              hasData = true;
              break;
            }
          }
        } else {
          // Org entity - check members path
          const latestPath = getEntityLatestPath('members', stub.entityId, orgId);
          const latestPointer = await readJSON<{ version?: number }>(bucket, latestPath);
          if (latestPointer) {
            hasData = true;
          }
        }
        
        // If stub exists but has no data, it's orphaned - delete it
        if (!hasData) {
          console.log('[EntityTypes] Deleting orphaned stub:', stub.entityId);
          const stubPath = getEntityStubPath(stub.entityId);
          await deleteFile(bucket, stubPath);
          cleanedCount++;
        }
      } catch (err) {
        // Skip invalid stub files
        continue;
      }
    }
    
    if (cleanedCount > 0) {
      console.log('[EntityTypes] Cleaned up', cleanedCount, 'orphaned stubs');
    }
  } catch (error) {
    console.error('[EntityTypes] Error cleaning up orphaned stubs:', error);
    // Don't fail the hard delete if cleanup fails - log and continue
  }
}

/**
 * Delete all entities of a specific type
 * Uses the same logic as superDelete but for all entities of a type
 */
async function deleteAllEntitiesOfType(
  bucket: R2Bucket,
  typeId: string,
  entityType: EntityType
): Promise<void> {
  console.log('[EntityTypes] Deleting all entities of type:', typeId);
  
  try {
    // Get all entity stubs for this type
    const stubFiles = await listFiles(bucket, `${R2_PATHS.STUBS}`);
    const entityStubs: Array<{ stub: EntityStub; stubPath: string; hasData: boolean; latestPointer: EntityLatestPointer | null; storageVisibility: VisibilityScope }> = [];
    
    for (const stubFile of stubFiles) {
      if (!stubFile.endsWith('.json')) continue;
      const filename = stubFile.replace(`${R2_PATHS.STUBS}`, '');
      // Skip files in subdirectories (like slug-index)
      if (filename.includes('/')) continue;
      
      try {
        const stub = await readJSON<EntityStub>(bucket, stubFile);
        if (!stub || stub.entityTypeId !== typeId) continue;
        
        // Check if entity actually has data
        const orgId = stub.organizationId;
        let latestPointer: EntityLatestPointer | null = null;
        let storageVisibility: VisibilityScope = 'members';
        
        if (orgId === null) {
          // Global entity - check both authenticated and public paths
          for (const visibility of ['authenticated', 'public'] as const) {
            const latestPath = getEntityLatestPath(visibility, stub.entityId, undefined);
            latestPointer = await readJSON<EntityLatestPointer>(bucket, latestPath);
            if (latestPointer) {
              storageVisibility = latestPointer.visibility;
              break;
            }
          }
        } else {
          // Org entity - check members path
          const latestPath = getEntityLatestPath('members', stub.entityId, orgId);
          latestPointer = await readJSON<EntityLatestPointer>(bucket, latestPath);
          if (latestPointer) {
            storageVisibility = 'members';
          }
        }
        
        // Only include entities that have actual data
        if (latestPointer) {
          entityStubs.push({
            stub,
            stubPath: stubFile,
            hasData: true,
            latestPointer,
            storageVisibility
          });
        }
      } catch (err) {
        // Skip invalid stub files
        continue;
      }
    }
    
    console.log('[EntityTypes] Found', entityStubs.length, 'entities to delete');
    
    // Delete each entity using the same logic as superDelete
    let deletedCount = 0;
    for (const { stub, stubPath, latestPointer, storageVisibility } of entityStubs) {
      try {
        const orgId = stub.organizationId;
        const entityId = stub.entityId;
        
        // Get the entity to check visibility and slug
        const versionPath = getEntityVersionPath(storageVisibility, entityId, latestPointer!.version, orgId || undefined);
        const entity = await readJSON<Entity>(bucket, versionPath);
        
        if (!entity) {
          console.warn('[EntityTypes] Entity not found, skipping:', entityId);
          continue;
        }
        
        // 1. Delete all version files
        const entityDir = orgId === null
          ? `${storageVisibility === 'public' ? 'public/' : 'platform/'}entities/${entityId}/`
          : `private/orgs/${orgId}/entities/${entityId}/`;
        
        const entityFiles = await listFiles(bucket, entityDir);
        for (const filePath of entityFiles) {
          console.log('[EntityTypes] Deleting version file:', filePath);
          await deleteFile(bucket, filePath);
        }
        
        // 2. Delete the entity stub
        console.log('[EntityTypes] Deleting entity stub:', stubPath);
        await deleteFile(bucket, stubPath);
        
        // 3. Delete slug index if entity was public
        if (entity.visibility === 'public' && entity.slug) {
          console.log('[EntityTypes] Deleting slug index for:', entity.slug);
          await deleteSlugIndex(bucket, orgId, entityType.slug, entity.slug);
        }
        
        deletedCount++;
        console.log('[EntityTypes] Deleted entity:', entityId);
      } catch (err) {
        console.error('[EntityTypes] Error deleting entity:', stub.entityId, err);
        // Continue deleting other entities even if one fails
      }
    }
    
    console.log('[EntityTypes] Deleted', deletedCount, 'entities of type:', typeId);
    
    // Regenerate bundles for all affected organizations
    // Collect unique org IDs from deleted entities
    const affectedOrgIds = new Set<string | null>();
    for (const { stub } of entityStubs) {
      affectedOrgIds.add(stub.organizationId);
    }
    
    const config = await loadAppConfig(bucket);
    for (const orgId of affectedOrgIds) {
      console.log('[EntityTypes] Regenerating bundles for org after entity deletion:', orgId || 'global');
      await regenerateEntityBundles(bucket, typeId, orgId, config);
    }
  } catch (error) {
    console.error('[EntityTypes] Error deleting all entities of type:', typeId, error);
    // Re-throw to prevent type deletion if entity deletion fails
    throw new Error(`Failed to delete entities of type ${typeId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
