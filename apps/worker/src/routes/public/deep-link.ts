/**
 * Deep Link Routes
 * 
 * SEO-friendly slug-based entity access:
 * GET /:orgSlug/:typeSlug/:entitySlug - Get entity by slug chain
 * GET /:orgSlug/:typeSlug - List entities of type in org (public only)
 * GET /:orgSlug - Organization landing page
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { readJSON, getEntityLatestPath, getEntityVersionPath, getEntityTypePath, getManifestPath, getBundlePath, listFiles } from '../../lib/r2';
import { readSlugIndex } from '../../lib/slug-index';
import { findOrgBySlug } from '../../lib/organizations';
import { NotFoundError } from '../../middleware/error';
import type { Entity, EntityType, VisibilityScope, EntityLatestPointer } from '@1cc/shared';

export const deepLinkRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /:orgSlug/:typeSlug/:entitySlug
 * Get specific entity by slug chain
 */
deepLinkRoutes.get('/:orgSlug/:typeSlug/:entitySlug', async (c) => {
  const { orgSlug, typeSlug, entitySlug } = c.req.param();
  console.log('[DeepLink] Resolving slug chain:', { orgSlug, typeSlug, entitySlug });
  
  // 1. Resolve org slug → orgId
  const org = await findOrgBySlug(c.env.R2_BUCKET, orgSlug);
  if (!org) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Organization not found'
      }
    }, 404);
  }
  
  // 2. Get entity type to verify typeSlug matches
  // We need to find the entity type by slug - list all types and find matching slug
  const typeFiles = await listFiles(c.env.R2_BUCKET, 'public/entity-types/');
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  let entityType: EntityType | null = null;
  for (const file of definitionFiles) {
    const type = await readJSON<EntityType>(c.env.R2_BUCKET, file);
    if (type && type.slug === typeSlug && type.isActive) {
      entityType = type;
      break;
    }
  }
  
  if (!entityType) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity type not found'
      }
    }, 404);
  }
  
  // 3. Check slug index for fast lookup
  const slugIndex = await readSlugIndex(c.env.R2_BUCKET, org.id, typeSlug, entitySlug);
  
  if (!slugIndex) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity not found'
      }
    }, 404);
  }
  
  // 4. Verify entity is public
  if (slugIndex.visibility !== 'public') {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity not found'
      }
    }, 404);
  }
  
  // 5. Read and return entity
  const entityPath = getEntityVersionPath('public', slugIndex.entityId, 1, slugIndex.organizationId || undefined);
  // Actually, we need to get the latest version, not version 1
  // Let's get the latest pointer first
  const latestPath = getEntityLatestPath('public', slugIndex.entityId, slugIndex.organizationId || undefined);
  const latestPointer = await readJSON<EntityLatestPointer>(c.env.R2_BUCKET, latestPath);
  
  if (!latestPointer) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity not found'
      }
    }, 404);
  }
  
  const finalEntityPath = getEntityVersionPath('public', slugIndex.entityId, latestPointer.version, slugIndex.organizationId || undefined);
  const entity = await readJSON<Entity>(c.env.R2_BUCKET, finalEntityPath);
  
  if (!entity) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity not found'
      }
    }, 404);
  }
  
  return c.json({
    success: true,
    data: entity
  });
});

/**
 * GET /:orgSlug/:typeSlug
 * List entities of type in org (public only)
 */
deepLinkRoutes.get('/:orgSlug/:typeSlug', async (c) => {
  const { orgSlug, typeSlug } = c.req.param();
  console.log('[DeepLink] Listing entities for org/type:', { orgSlug, typeSlug });
  
  // Resolve org slug → orgId
  const org = await findOrgBySlug(c.env.R2_BUCKET, orgSlug);
  if (!org) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Organization not found'
      }
    }, 404);
  }
  
  // Get entity type
  const typeFiles = await listFiles(c.env.R2_BUCKET, 'public/entity-types/');
  const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
  
  let entityType: EntityType | null = null;
  for (const file of definitionFiles) {
    const type = await readJSON<EntityType>(c.env.R2_BUCKET, file);
    if (type && type.slug === typeSlug && type.isActive) {
      entityType = type;
      break;
    }
  }
  
  if (!entityType) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Entity type not found'
      }
    }, 404);
  }
  
  // Get public bundle for this type (contains all public entities)
  const bundlePath = getBundlePath('public', entityType.id);
  const bundle = await readJSON<{ entities: Array<{ id: string; slug: string; data: Record<string, unknown> }> }>(c.env.R2_BUCKET, bundlePath);
  
  // Filter entities that belong to this org
  const orgEntities = bundle?.entities.filter(e => {
    // We'd need to check entity stub to verify org, but for now return all public entities
    // TODO: Filter by organizationId when we have that in bundle
    return true;
  }) || [];
  
  return c.json({
    success: true,
    data: {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug
      },
      entityType: {
        id: entityType.id,
        name: entityType.name,
        pluralName: entityType.pluralName,
        slug: entityType.slug
      },
      entities: orgEntities
    }
  });
});

/**
 * GET /:orgSlug
 * Organization landing page
 */
deepLinkRoutes.get('/:orgSlug', async (c) => {
  const orgSlug = c.req.param('orgSlug');
  console.log('[DeepLink] Getting org landing page:', orgSlug);
  
  // Resolve org slug → orgId
  const org = await findOrgBySlug(c.env.R2_BUCKET, orgSlug);
  if (!org) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Organization not found'
      }
    }, 404);
  }
  
  // Get public manifest to list available entity types
  const manifestPath = getManifestPath('public');
  const manifest = await readJSON<{ entityTypes: Array<{ id: string; name: string; slug: string }> }>(c.env.R2_BUCKET, manifestPath);
  
  return c.json({
    success: true,
    data: {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.profile?.description
      },
      entityTypes: manifest?.entityTypes || []
    }
  });
});
