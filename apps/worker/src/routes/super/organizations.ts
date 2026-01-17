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
import { regenerateEntityBundles, loadAppConfig } from '../../lib/bundle-invalidation';
import { ConflictError, NotFoundError } from '../../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { Organization, EntityTypePermissions, EntityType } from '@1cc/shared';

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
  
  // Generate bundles for all entity types for this new organization (even if empty)
  // This ensures bundles exist immediately when the organization is created
  console.log('[SuperOrgs] Generating bundles for all entity types for new organization:', orgId);
  try {
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    
    for (const file of definitionFiles) {
      const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, file);
      if (entityType && entityType.isActive) {
        try {
          await regenerateEntityBundles(c.env.R2_BUCKET, entityType.id, orgId, config);
        } catch (error) {
          console.error('[SuperOrgs] Error generating bundles for type', entityType.id, ':', error);
          // Continue with other types even if one fails
        }
      }
    }
    console.log('[SuperOrgs] Bundle generation complete for new organization:', orgId);
  } catch (error) {
    console.error('[SuperOrgs] Error generating bundles for new organization:', orgId, error);
    // Don't fail organization creation if bundle generation fails - log and continue
  }
  
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
