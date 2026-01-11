/**
 * Superadmin Organization Routes
 * 
 * CRUD /api/super/organizations - Platform organization management
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { createOrganizationRequestSchema, updateOrganizationRequestSchema } from '@1cc/shared';
import { readJSON, writeJSON, listFiles, getOrgProfilePath, getOrgPermissionsPath } from '../../lib/r2';
import { createOrgId, createSlug } from '../../lib/id';
import { findOrgBySlug } from '../../lib/organizations';
import { ConflictError, NotFoundError } from '../../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { Organization, EntityTypePermissions } from '@1cc/shared';

export const superOrgRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /organizations
 * Create organization
 */
superOrgRoutes.post('/organizations',
  zValidator('json', createOrganizationRequestSchema),
  async (c) => {
  const { name, slug, description, domainWhitelist, allowSelfSignup } = c.req.valid('json');
  
  // Check slug uniqueness
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
    profile: { description: description || undefined },
    settings: {
      domainWhitelist: domainWhitelist || [],
      allowSelfSignup: allowSelfSignup ?? false
    },
    createdAt: now,
    updatedAt: now,
    isActive: true
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), organization);
  
  // Initialize permissions
  const permissions: EntityTypePermissions = {
    organizationId: orgId,
    viewable: [],
    creatable: [],
    updatedAt: now,
    updatedBy: c.get('userId')!
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgPermissionsPath(orgId), permissions);
  
  return c.json({ success: true, data: organization }, 201);
});

/**
 * GET /organizations
 * List all organizations
 */
superOrgRoutes.get('/organizations', async (c) => {
  const orgFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/`);
  const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
  
  const items = [];
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(c.env.R2_BUCKET, file);
    if (org) {
      items.push(org);
    }
  }
  
  return c.json({ success: true, data: { items, total: items.length } });
});
