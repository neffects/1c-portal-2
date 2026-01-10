/**
 * Organization Routes
 * 
 * Handles organization management:
 * - POST / - Create organization (superadmin)
 * - GET / - List organizations
 * - GET /:id - Get organization details
 * - PATCH /:id - Update organization
 * - DELETE /:id - Soft delete organization
 * - GET /:id/permissions - Get entity type permissions
 * - PATCH /:id/permissions - Update entity type permissions
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { 
  createOrganizationRequestSchema, 
  updateOrganizationRequestSchema,
  updateEntityTypePermissionsRequestSchema 
} from '@1cc/shared';
import { readJSON, writeJSON, listFiles, getOrgProfilePath, getOrgPermissionsPath } from '../lib/r2';
import { createOrgId, createSlug } from '../lib/id';
import { requireSuperadmin, requireOrgAdmin, requireOrgMembership } from '../middleware/auth';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { Organization, EntityTypePermissions, OrganizationListItem } from '@1cc/shared';

export const organizationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new organization (superadmin only)
 */
organizationRoutes.post('/', requireSuperadmin, async (c) => {
  console.log('[Orgs] Creating organization');
  
  const body = await c.req.json();
  const result = createOrganizationRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid organization data', { errors: result.error.errors });
  }
  
  const { name, slug, description, domainWhitelist, allowSelfSignup } = result.data;
  
  // Check if slug is unique
  const existingOrg = await findOrgBySlug(c.env.R2_BUCKET, slug);
  if (existingOrg) {
    throw new ConflictError(`Organization with slug '${slug}' already exists`);
  }
  
  const orgId = createOrgId();
  const now = new Date().toISOString();
  
  const organization: Organization = {
    id: orgId,
    name,
    slug,
    profile: {
      description: description || undefined
    },
    settings: {
      domainWhitelist: domainWhitelist || [],
      allowSelfSignup: allowSelfSignup ?? false
    },
    createdAt: now,
    updatedAt: now,
    isActive: true
  };
  
  // Save organization profile
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), organization);
  
  // Initialize empty entity type permissions
  const permissions: EntityTypePermissions = {
    organizationId: orgId,
    viewable: [],
    creatable: [],
    updatedAt: now,
    updatedBy: c.get('userId')!
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgPermissionsPath(orgId), permissions);
  
  console.log('[Orgs] Created organization:', orgId);
  
  return c.json({
    success: true,
    data: organization
  }, 201);
});

/**
 * GET /
 * List all organizations
 */
organizationRoutes.get('/', async (c) => {
  console.log('[Orgs] Listing organizations');
  
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  // Non-superadmins can only see their own organization
  if (userRole !== 'superadmin') {
    if (!userOrgId) {
      return c.json({
        success: true,
        data: { items: [], total: 0 }
      });
    }
    
    const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(userOrgId));
    
    if (!org || !org.isActive) {
      return c.json({
        success: true,
        data: { items: [], total: 0 }
      });
    }
    
    const item: OrganizationListItem = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      memberCount: await countOrgMembers(c.env.R2_BUCKET, org.id),
      entityCount: await countOrgEntities(c.env.R2_BUCKET, org.id),
      createdAt: org.createdAt,
      isActive: org.isActive
    };
    
    return c.json({
      success: true,
      data: { items: [item], total: 1 }
    });
  }
  
  // Superadmin: list all organizations
  const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`);
  const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
  
  const items: OrganizationListItem[] = [];
  
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(c.env.R2_BUCKET, file);
    if (!org) continue;
    
    items.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      memberCount: await countOrgMembers(c.env.R2_BUCKET, org.id),
      entityCount: await countOrgEntities(c.env.R2_BUCKET, org.id),
      createdAt: org.createdAt,
      isActive: org.isActive
    });
  }
  
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  
  console.log('[Orgs] Found', items.length, 'organizations');
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length
    }
  });
});

/**
 * GET /:id
 * Get organization details
 */
organizationRoutes.get('/:id', requireOrgMembership('id'), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Getting organization:', orgId);
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  return c.json({
    success: true,
    data: org
  });
});

/**
 * PATCH /:id
 * Update organization
 */
organizationRoutes.patch('/:id', requireOrgAdmin, requireOrgMembership('id'), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Updating organization:', orgId);
  
  const body = await c.req.json();
  const result = updateOrganizationRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid organization data', { errors: result.error.errors });
  }
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  const updates = result.data;
  
  // Check slug uniqueness if changing
  if (updates.slug && updates.slug !== org.slug) {
    const existingOrg = await findOrgBySlug(c.env.R2_BUCKET, updates.slug);
    if (existingOrg) {
      throw new ConflictError(`Organization with slug '${updates.slug}' already exists`);
    }
  }
  
  // Merge updates
  const updatedOrg: Organization = {
    ...org,
    name: updates.name ?? org.name,
    slug: updates.slug ?? org.slug,
    profile: {
      ...org.profile,
      ...updates.profile
    },
    settings: {
      ...org.settings,
      ...updates.settings
    },
    updatedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), updatedOrg);
  
  console.log('[Orgs] Updated organization:', orgId);
  
  return c.json({
    success: true,
    data: updatedOrg
  });
});

/**
 * DELETE /:id
 * Soft delete organization (superadmin only)
 */
organizationRoutes.delete('/:id', requireSuperadmin, async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Deleting organization:', orgId);
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  // Soft delete - mark as inactive
  const updatedOrg: Organization = {
    ...org,
    isActive: false,
    updatedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), updatedOrg);
  
  console.log('[Orgs] Soft deleted organization:', orgId);
  
  return c.json({
    success: true,
    data: { message: 'Organization deleted successfully' }
  });
});

/**
 * GET /:id/permissions
 * Get entity type permissions for organization
 */
organizationRoutes.get('/:id/permissions', requireOrgMembership('id'), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Getting permissions for:', orgId);
  
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET, 
    getOrgPermissionsPath(orgId)
  );
  
  if (!permissions) {
    // Return empty permissions if not set
    return c.json({
      success: true,
      data: {
        organizationId: orgId,
        viewable: [],
        creatable: [],
        updatedAt: null,
        updatedBy: null
      }
    });
  }
  
  return c.json({
    success: true,
    data: permissions
  });
});

/**
 * PATCH /:id/permissions
 * Update entity type permissions (superadmin only)
 */
organizationRoutes.patch('/:id/permissions', requireSuperadmin, async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Updating permissions for:', orgId);
  
  const body = await c.req.json();
  const result = updateEntityTypePermissionsRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid permissions data', { errors: result.error.errors });
  }
  
  // Verify org exists
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  const currentPermissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET, 
    getOrgPermissionsPath(orgId)
  );
  
  const updates = result.data;
  const now = new Date().toISOString();
  
  const updatedPermissions: EntityTypePermissions = {
    organizationId: orgId,
    viewable: updates.viewable ?? currentPermissions?.viewable ?? [],
    creatable: updates.creatable ?? currentPermissions?.creatable ?? [],
    updatedAt: now,
    updatedBy: c.get('userId')!
  };
  
  // Ensure creatable is subset of viewable
  updatedPermissions.creatable = updatedPermissions.creatable.filter(
    id => updatedPermissions.viewable.includes(id)
  );
  
  await writeJSON(c.env.R2_BUCKET, getOrgPermissionsPath(orgId), updatedPermissions);
  
  console.log('[Orgs] Updated permissions for:', orgId);
  
  return c.json({
    success: true,
    data: updatedPermissions
  });
});

// Helper functions

/**
 * Find organization by slug
 */
async function findOrgBySlug(bucket: R2Bucket, slug: string): Promise<Organization | null> {
  const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
  const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
  
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(bucket, file);
    if (org && org.slug === slug) {
      return org;
    }
  }
  
  return null;
}

/**
 * Count members in an organization
 */
async function countOrgMembers(bucket: R2Bucket, orgId: string): Promise<number> {
  const userFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
  return userFiles.filter(f => f.endsWith('.json')).length;
}

/**
 * Count entities in an organization
 */
async function countOrgEntities(bucket: R2Bucket, orgId: string): Promise<number> {
  const entityFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`);
  // Count directories (each entity has a directory)
  const entityDirs = new Set(entityFiles.map(f => {
    const match = f.match(/entities\/([^\/]+)\//);
    return match ? match[1] : null;
  }).filter(Boolean));
  return entityDirs.size;
}
