/**
 * API Entity Type Routes
 * 
 * GET /api/entity-types - List entity types (authenticated users)
 * GET /api/entity-types/:id - Get entity type definition (authenticated users)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { entityTypeQueryParamsSchema } from '@1cc/shared';
import { readJSON, listFiles, getEntityTypePath, getOrgPermissionsPath } from '../../lib/r2';
import { R2_PATHS } from '@1cc/shared';
import { NotFoundError } from '../../middleware/error';
import type { EntityType, EntityTypeListItem, EntityTypePermissions } from '@1cc/shared';

export const apiEntityTypeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /entity-types
 * List entity types (authenticated users)
 */
apiEntityTypeRoutes.get('/entity-types',
  zValidator('query', entityTypeQueryParamsSchema),
  async (c) => {
  console.log('[API] Listing entity types');
  
  const query = c.req.valid('query');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Get all entity types
  const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  const items: EntityTypeListItem[] = [];
  
  // Filter by org permissions if specified
  let allowedTypeIds: string[] | null = null;
  if (query.permission && userOrgId) {
    const permissions = await readJSON<EntityTypePermissions>(
      c.env.R2_BUCKET,
      getOrgPermissionsPath(userOrgId)
    );
    
    if (query.permission === 'viewable') {
      allowedTypeIds = permissions?.viewable || [];
    } else if (query.permission === 'creatable') {
      allowedTypeIds = permissions?.creatable || [];
    }
  }
  
  for (const file of definitionFiles) {
    const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, file);
    if (!entityType || !entityType.isActive) continue;
    
    // Filter by permissions if specified
    if (allowedTypeIds !== null && !allowedTypeIds.includes(entityType.id)) {
      continue;
    }
    
    // Count entities (simplified - in production would use manifest/bundle)
    const entityCount = 0; // TODO: Get from manifest
    
    items.push({
      id: entityType.id,
      name: entityType.name,
      pluralName: entityType.pluralName,
      slug: entityType.slug,
      description: entityType.description,
      defaultVisibility: entityType.defaultVisibility,
      fieldCount: entityType.fields.length,
      entityCount,
      isActive: entityType.isActive
    });
  }
  
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  
  console.log('[API] Returning', items.length, 'entity types');
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length
    }
  });
});

/**
 * GET /entity-types/:id
 * Get entity type definition (authenticated users)
 */
apiEntityTypeRoutes.get('/entity-types/:id', async (c) => {
  const typeId = c.req.param('id');
  console.log('[API] Getting entity type:', typeId);
  
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
