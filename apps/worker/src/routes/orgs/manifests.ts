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
  readJSONWithEtag,
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
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  const manifestPath = isAdmin 
    ? getOrgAdminManifestPath(orgId)
    : getOrgMemberManifestPath(orgId);
  
  // CASL verifies user can read their org's manifest
  let manifest = await readJSON<SiteManifest>(c.env.R2_BUCKET, manifestPath, ability, 'read', 'Platform');
  
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
 * Supports ETag-based conditional requests (If-None-Match header)
 */
orgManifestRoutes.get('/bundles/:typeId', requireOrgMembership('orgId'), async (c) => {
  const orgId = c.req.param('orgId');
  const typeId = c.req.param('typeId');
  const userRole = c.get('userRole');
  const isSuperadmin = userRole === 'superadmin';
  const ifNoneMatch = c.req.header('If-None-Match'); // ETag from client
  
  console.log('[OrgManifests] Getting org bundle:', orgId, typeId, 'role:', userRole, ifNoneMatch ? `(If-None-Match: ${ifNoneMatch})` : '');
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Verify entity type exists - CASL verifies user can read entity types
  const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, getEntityTypePath(typeId), ability, 'read', 'EntityType');
  if (!entityType || !entityType.isActive) {
    throw new NotFoundError('Entity Type', typeId);
  }
  
  // Check if org has access to this type - CASL verifies user can read org permissions
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET,
    getOrgPermissionsPath(orgId),
    ability,
    'read',
    'Organization'
  );
  
  if (!permissions?.viewable.includes(typeId)) {
    throw new ForbiddenError('Organization does not have access to this entity type');
  }
  
  // Determine if user is admin (can see admin bundle) or member (member bundle only)
  const isAdmin = isSuperadmin || userRole === 'org_admin';
  
  const bundlePath = isAdmin
    ? getOrgAdminBundlePath(orgId, typeId)
    : getOrgMemberBundlePath(orgId, typeId);
  
  // Read bundle with ETag metadata - CASL verifies user can read their org's bundles
  const { data: bundle, etag } = await readJSONWithEtag<EntityBundle>(c.env.R2_BUCKET, bundlePath, ability);
  
  // Generate ETag for empty bundle (hash of JSON content)
  let bundleEtag: string | null = etag;
  let finalBundle: EntityBundle;
  
  if (!bundle) {
    // Return empty bundle if not exists (bundles don't have versions)
    finalBundle = {
      typeId,
      typeName: entityType.pluralName,
      generatedAt: new Date().toISOString(),
      entityCount: 0,
      entities: []
    };
    
    // Generate ETag for empty bundle (hash of JSON string)
    const emptyBundleJson = JSON.stringify(finalBundle);
    bundleEtag = `"${Buffer.from(emptyBundleJson).toString('base64').substring(0, 32)}"`; // Simple hash approximation
  } else {
    finalBundle = bundle;
  }
  
  // Handle conditional request (If-None-Match)
  if (ifNoneMatch && bundleEtag) {
    // Remove quotes if present for comparison
    const clientEtag = ifNoneMatch.replace(/^"|"$/g, '');
    const serverEtag = bundleEtag.replace(/^"|"$/g, '');
    
    if (clientEtag === serverEtag) {
      console.log('[OrgManifests] Bundle ETag matches - returning 304 Not Modified:', typeId);
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': bundleEtag,
          'Cache-Control': 'private, max-age=300' // 5 minutes (private for org bundles)
        }
      });
    }
  }
  
  // Return bundle with ETag header
  const response = c.json({
    success: true,
    data: finalBundle
  });
  
  // Add ETag header if available
  if (bundleEtag) {
    response.headers.set('ETag', bundleEtag);
    response.headers.set('Cache-Control', 'private, max-age=300'); // 5 minutes (private for org bundles)
  }
  
  return response;
});
