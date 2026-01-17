/**
 * Org Manifest Routes
 * 
 * GET /api/orgs/:orgId/manifests/site - Get org manifest (member or admin based on role)
 * GET /api/orgs/:orgId/bundles/:typeId - Get org bundle (member or admin based on role)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { 
  readJSON, 
  getOrgMemberManifestPath, getOrgAdminManifestPath,
  getOrgMemberBundlePath, getOrgAdminBundlePath,
  getEntityTypePath, getOrgPermissionsPath
} from '../../lib/r2';
import { requireOrgMembership } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../middleware/error';
import type { SiteManifest, EntityBundle, EntityType, EntityTypePermissions } from '@1cc/shared';

export const orgManifestRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /manifests/site
 * Get org manifest (member or admin based on user role)
 */
orgManifestRoutes.get('/manifests/site', requireOrgMembership('orgId'), async (c) => {
  const orgId = c.req.param('orgId');
  const userRole = c.get('userRole');
  const isSuperadmin = userRole === 'superadmin';
  
  console.log('[OrgManifests] Getting org manifest:', orgId, 'role:', userRole);
  
  // Determine if user is admin (can see admin bundle) or member (member bundle only)
  const isAdmin = isSuperadmin || userRole === 'org_admin';
  
  const manifestPath = isAdmin 
    ? getOrgAdminManifestPath(orgId)
    : getOrgMemberManifestPath(orgId);
  
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, manifestPath);
  
  if (!manifest) {
    // Return empty manifest if not exists
    manifest = {
      generatedAt: new Date().toISOString(),
      version: 0,
      entityTypes: []
    };
  }
  
  return c.json({
    success: true,
    data: manifest
  });
});

/**
 * GET /bundles/:typeId
 * Get org bundle (member or admin based on user role)
 */
orgManifestRoutes.get('/bundles/:typeId', requireOrgMembership('orgId'), async (c) => {
  const orgId = c.req.param('orgId');
  const typeId = c.req.param('typeId');
  const userRole = c.get('userRole');
  const isSuperadmin = userRole === 'superadmin';
  
  console.log('[OrgManifests] Getting org bundle:', orgId, typeId, 'role:', userRole);
  
  // Verify entity type exists
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId));
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check if org has access to this type
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET,
    getOrgPermissionsPath(orgId)
  );
  
  if (!permissions?.viewable.includes(typeId)) {
    throw new ForbiddenError('Organization does not have access to this entity type');
  }
  
  // Determine if user is admin (can see admin bundle) or member (member bundle only)
  const isAdmin = isSuperadmin || userRole === 'org_admin';
  
  const bundlePath = isAdmin
    ? getOrgAdminBundlePath(orgId, typeId)
    : getOrgMemberBundlePath(orgId, typeId);
  
  let bundle = await readJSON<EntityBundle>(c.env.R2_BUCKET, bundlePath);
  
  if (!bundle) {
    // Return empty bundle if not exists
    bundle = {
      typeId,
      typeName: entityType.pluralName,
      generatedAt: new Date().toISOString(),
      version: 0,
      entityCount: 0,
      entities: []
    };
  }
  
  return c.json({
    success: true,
    data: bundle
  });
});
