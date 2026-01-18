/**
 * Superadmin Bundle Management Routes
 * 
 * List and manage bundles stored in R2
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { readJSON, writeJSON, listFiles, headFile, getEntityTypePath, getOrgProfilePath, getAppConfigPath, getBundlePath, getOrgMemberBundlePath, getOrgAdminBundlePath } from '../../lib/r2';
import { loadAppConfig, regenerateEntityBundles } from '../../lib/bundle-invalidation';
import { requireAbility } from '../../middleware/casl';
import { R2_PATHS } from '@1cc/shared';
import type { EntityBundle, EntityType, Organization, AppConfig } from '@1cc/shared';

export const bundleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Bundle info with metadata
 */
interface BundleInfo {
  path: string;
  type: 'global' | 'org-member' | 'org-admin';
  keyId?: string; // for global bundles
  orgId?: string; // for org bundles
  typeId: string;
  typeName?: string; // Entity type name
  keyName?: string; // Membership key name (for global bundles)
  orgName?: string; // Organization name (for org bundles)
  friendlyName: string; // Human-readable name
  generatedAt?: string; // undefined if bundle doesn't exist yet
  size: number; // bytes (0 if bundle doesn't exist)
  version?: number; // undefined if bundle doesn't exist yet
  entityCount?: number; // undefined if bundle doesn't exist yet
  exists: boolean; // whether the bundle file actually exists
}

/**
 * Parse bundle path to extract type and IDs
 */
function parseBundlePath(path: string): {
  type: 'global' | 'org-member' | 'org-admin';
  keyId?: string;
  orgId?: string;
  typeId: string;
} | null {
  // Global bundle: bundles/{keyId}/{typeId}.json
  const globalMatch = path.match(/^bundles\/([^\/]+)\/([^\/]+)\.json$/);
  if (globalMatch) {
    return {
      type: 'global',
      keyId: globalMatch[1],
      typeId: globalMatch[2]
    };
  }
  
  // Org member bundle: bundles/org/{orgId}/member/{typeId}.json
  const orgMemberMatch = path.match(/^bundles\/org\/([^\/]+)\/member\/([^\/]+)\.json$/);
  if (orgMemberMatch) {
    return {
      type: 'org-member',
      orgId: orgMemberMatch[1],
      typeId: orgMemberMatch[2]
    };
  }
  
  // Org admin bundle: bundles/org/{orgId}/admin/{typeId}.json
  const orgAdminMatch = path.match(/^bundles\/org\/([^\/]+)\/admin\/([^\/]+)\.json$/);
  if (orgAdminMatch) {
    return {
      type: 'org-admin',
      orgId: orgAdminMatch[1],
      typeId: orgAdminMatch[2]
    };
  }
  
  return null;
}

/**
 * GET /bundles
 * List all bundles with metadata
 * 
 * Requires superadmin access (enforced by app-level middleware)
 */
bundleRoutes.get('/bundles',
  requireAbility('read', 'Platform'),
  async (c) => {
  console.log('[Bundles] Listing all bundles (existing and expected)');
  console.log('[Bundles] Request path:', c.req.path);
  console.log('[Bundles] User role:', c.get('userRole'));
  
  try {
    const bucket = c.env.R2_BUCKET;
    
    if (!bucket) {
      console.error('[Bundles] R2_BUCKET not available');
      return c.json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'R2 bucket not configured'
        }
      }, 500);
    }
    
    const ability = c.get('ability');
    if (!ability) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'CASL ability required' }
      }, 401);
    }
    
    // Load app config for membership keys
    const config = await loadAppConfig(bucket, ability);
    
    // Get all entity types
    const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`, ability);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    const entityTypes: EntityType[] = [];
    
    for (const file of definitionFiles) {
      const entityType = await readJSON<EntityType>(bucket, file, ability, 'read', 'EntityType');
      if (entityType && entityType.isActive) {
        entityTypes.push(entityType);
      }
    }
    
    console.log('[Bundles] Found', entityTypes.length, 'active entity types');
    
    // Get all organizations
    const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`, ability);
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    const organizations: Organization[] = [];
    
    for (const file of profileFiles) {
      const org = await readJSON<Organization>(bucket, file, ability, 'read', 'Organization');
      if (org && org.isActive) {
        organizations.push(org);
      }
    }
    
    console.log('[Bundles] Found', organizations.length, 'active organizations');
    
    // Get all existing bundle files (require ability for listFiles on protected paths)
    const bundleFiles = await listFiles(bucket, 'bundles/', ability, 1000);
    
    console.log('[Bundles] Found', bundleFiles.length, 'bundle files in R2');
    
    // Create a map of existing bundles by path
    const existingBundles = new Map<string, { bundle: EntityBundle; size: number }>();
    
    for (const bundlePath of bundleFiles) {
      // Skip manifest files (site.json)
      if (bundlePath.endsWith('/site.json')) {
        continue;
      }
      
      // Only process .json files that match bundle patterns
      if (!bundlePath.endsWith('.json')) {
        continue;
      }
      
      // Parse bundle path
      const parsed = parseBundlePath(bundlePath);
      if (!parsed) {
        continue;
      }
      
      try {
        // Get file metadata (size) - require ability for protected paths
        const head = await headFile(bucket, bundlePath, ability);
        const size = head?.size || 0;
        
        // Read bundle JSON - require ability for protected paths
        const bundle = await readJSON<EntityBundle>(bucket, bundlePath, ability, 'read', 'Entity');
        if (bundle) {
          existingBundles.set(bundlePath, { bundle, size });
        }
      } catch (error) {
        console.error('[Bundles] Error reading existing bundle:', bundlePath, error);
      }
    }
    
    // Create lookup maps for friendly names
    const entityTypeMap = new Map<string, EntityType>();
    for (const et of entityTypes) {
      entityTypeMap.set(et.id, et);
    }
    
    const orgMap = new Map<string, Organization>();
    for (const org of organizations) {
      orgMap.set(org.id, org);
    }
    
    const keyMap = new Map<string, { name: string }>();
    for (const key of config.membershipKeys.keys) {
      keyMap.set(key.id, { name: key.name });
    }
    
    // Helper to generate friendly name
    function getFriendlyName(
      type: 'global' | 'org-member' | 'org-admin',
      entityType: EntityType,
      keyId?: string,
      orgId?: string
    ): string {
      const typeName = entityType.name;
      
      if (type === 'global' && keyId) {
        const keyName = keyMap.get(keyId)?.name || keyId;
        return `${typeName} (${keyName})`;
      }
      
      if (type === 'org-member' && orgId) {
        const orgName = orgMap.get(orgId)?.name || orgId;
        return `${typeName} - ${orgName} (Member)`;
      }
      
      if (type === 'org-admin' && orgId) {
        const orgName = orgMap.get(orgId)?.name || orgId;
        return `${typeName} - ${orgName} (Admin)`;
      }
      
      return typeName;
    }
    
    // Build expected bundles list
    const bundleInfos: BundleInfo[] = [];
    const bundlePaths = new Set<string>(); // Track paths to avoid duplicates
    
    // Global bundles: for each entity type, for each key in visibleTo
    for (const entityType of entityTypes) {
      try {
        // Handle entity types that might not have visibleTo defined
        const visibleTo = entityType.visibleTo;
        if (!visibleTo) {
          console.warn('[Bundles] Entity type', entityType.id, 'has no visibleTo property');
          continue;
        }
        
        if (!Array.isArray(visibleTo)) {
          console.warn('[Bundles] Entity type', entityType.id, 'has invalid visibleTo (not an array):', typeof visibleTo, visibleTo);
          continue;
        }
        
        // Skip if empty array
        if (visibleTo.length === 0) {
          console.log('[Bundles] Entity type', entityType.id, 'has empty visibleTo array, skipping global bundles');
          continue;
        }
        
        for (const keyId of visibleTo) {
          // Skip invalid key IDs
          if (!keyId || typeof keyId !== 'string') {
            console.warn('[Bundles] Skipping invalid key ID:', keyId, 'for entity type:', entityType.id);
            continue;
          }
          
          const path = getBundlePath(keyId, entityType.id);
          if (!bundlePaths.has(path)) {
            bundlePaths.add(path);
            const existing = existingBundles.get(path);
            const keyName = keyMap.get(keyId)?.name;
            bundleInfos.push({
              path,
              type: 'global',
              keyId,
              typeId: entityType.id,
              typeName: entityType.name,
              keyName,
              friendlyName: getFriendlyName('global', entityType, keyId),
              generatedAt: existing?.bundle.generatedAt,
              size: existing?.size || 0,
              version: existing?.bundle.version,
              entityCount: existing?.bundle.entityCount,
              exists: !!existing
            });
          }
        }
      } catch (error) {
        console.error('[Bundles] Error processing entity type', entityType.id, ':', error);
        // Continue with next entity type
      }
    }
    
    // Org bundles: for each organization, for each entity type
    for (const org of organizations) {
      for (const entityType of entityTypes) {
        // Member bundle
        const memberPath = getOrgMemberBundlePath(org.id, entityType.id);
        if (!bundlePaths.has(memberPath)) {
          bundlePaths.add(memberPath);
          const existing = existingBundles.get(memberPath);
          bundleInfos.push({
            path: memberPath,
            type: 'org-member',
            orgId: org.id,
            typeId: entityType.id,
            typeName: entityType.name,
            orgName: org.name,
            friendlyName: getFriendlyName('org-member', entityType, undefined, org.id),
            generatedAt: existing?.bundle.generatedAt,
            size: existing?.size || 0,
            version: existing?.bundle.version,
            entityCount: existing?.bundle.entityCount,
            exists: !!existing
          });
        }
        
        // Admin bundle
        const adminPath = getOrgAdminBundlePath(org.id, entityType.id);
        if (!bundlePaths.has(adminPath)) {
          bundlePaths.add(adminPath);
          const existing = existingBundles.get(adminPath);
          bundleInfos.push({
            path: adminPath,
            type: 'org-admin',
            orgId: org.id,
            typeId: entityType.id,
            typeName: entityType.name,
            orgName: org.name,
            friendlyName: getFriendlyName('org-admin', entityType, undefined, org.id),
            generatedAt: existing?.bundle.generatedAt,
            size: existing?.size || 0,
            version: existing?.bundle.version,
            entityCount: existing?.bundle.entityCount,
            exists: !!existing
          });
        }
      }
    }
    
    // Sort by path for consistent ordering
    bundleInfos.sort((a, b) => a.path.localeCompare(b.path));
    
    console.log('[Bundles] Returning', bundleInfos.length, 'bundles (existing and expected)');
    
    return c.json({
      success: true,
      data: {
        bundles: bundleInfos
      }
    });
  } catch (error) {
    console.error('[Bundles] Error listing bundles:', error);
    return c.json({
      success: false,
      error: {
        code: 'BUNDLE_LIST_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list bundles'
      }
    }, 500);
  }
});

/**
 * Regenerate bundle request schema
 */
const regenerateBundleSchema = z.object({
  typeId: z.string().min(1),
  orgId: z.string().optional().nullable(),
  type: z.enum(['global', 'org-member', 'org-admin']).optional()
});

/**
 * Regenerate all bundles request schema
 */
const regenerateAllSchema = z.object({
  addDefaultVisibleTo: z.boolean().optional().default(false) // If true, add default visibleTo to entity types missing it
});

/**
 * POST /bundles/regenerate
 * Regenerate bundles for a specific entity type
 * 
 * Request body:
 * - typeId (required): Entity type ID
 * - orgId (optional): Organization ID (for org bundles, null for global)
 * - type (optional): Bundle type to regenerate ('global', 'org-member', 'org-admin')
 *   If not specified, regenerates all applicable bundles for the typeId
 */
bundleRoutes.post('/bundles/regenerate',
  zValidator('json', regenerateBundleSchema),
  async (c) => {
  console.log('[Bundles] Regenerating bundles');
  
  try {
    const bucket = c.env.R2_BUCKET;
    const body = c.req.valid('json');
    
    if (!bucket) {
      return c.json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'R2 bucket not configured'
        }
      }, 500);
    }
    
    // Get CASL ability for file-level permission checks (defense in depth)
    const ability = c.get('ability');
    if (!ability) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'CASL ability required' }
      }, 401);
    }
    
    const config = await loadAppConfig(bucket, ability);
    const { typeId, orgId, type } = body;
    
    // Load entity type - CASL verifies superadmin can read entity types
    const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(typeId), ability);
    if (!entityType) {
      return c.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Entity type ${typeId} not found`
        }
      }, 404);
    }
    
    // Regenerate based on type parameter
    // Note: regenerateEntityBundles regenerates all applicable bundles for a type,
    // so we call it with the appropriate orgId
    if (type === 'global') {
      // Regenerate all global bundles for this type (orgId = null)
      console.log('[Bundles] Regenerating global bundles for type:', typeId);
      await regenerateEntityBundles(bucket, typeId, null, config, ability);
    } else if (type === 'org-member' || type === 'org-admin') {
      // Regenerate org bundles (both member and admin bundles are regenerated together)
      if (!orgId) {
        return c.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'orgId is required for org bundle regeneration'
          }
        }, 400);
      }
      console.log('[Bundles] Regenerating org bundles:', orgId, typeId);
      await regenerateEntityBundles(bucket, typeId, orgId, config, ability);
    } else {
      // Regenerate all applicable bundles (both global and org if orgId provided)
      console.log('[Bundles] Regenerating all bundles for type:', typeId, 'org:', orgId || 'global');
      await regenerateEntityBundles(bucket, typeId, orgId || null, config, ability);
    }
    
    return c.json({
      success: true,
      data: {
        message: 'Bundles regenerated successfully',
        typeId,
        orgId: orgId || null
      }
    });
  } catch (error) {
    console.error('[Bundles] Error regenerating bundles:', error);
    return c.json({
      success: false,
      error: {
        code: 'REGENERATION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to regenerate bundles'
      }
    }, 500);
  }
});

/**
 * POST /bundles/regenerate-all
 * Regenerate all bundles for all entity types and organizations
 * 
 * Query params:
 * - addDefaultVisibleTo: If true, automatically add default visibleTo to entity types missing it
 */
bundleRoutes.post('/bundles/regenerate-all',
  zValidator('json', regenerateAllSchema),
  async (c) => {
  console.log('[Bundles] Regenerating all bundles');
  
  try {
    const bucket = c.env.R2_BUCKET;
    const body = c.req.valid('json');
    const addDefaultVisibleTo = body.addDefaultVisibleTo || false;
    
    if (!bucket) {
      return c.json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'R2 bucket not configured'
        }
      }, 500);
    }
    
    // Get CASL ability for file-level permission checks (defense in depth)
    const ability = c.get('ability');
    if (!ability) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'CASL ability required' }
      }, 401);
    }
    
    const config = await loadAppConfig(bucket, ability);
    
    // Log actual configured membership keys
    console.log('[Bundles] Configured membership keys:', config.membershipKeys.keys.map(k => `${k.id} (${k.name})`));
    
    // Get all entity types - CASL verifies superadmin can list and read entity types
    const typeFiles = await listFiles(bucket, `${R2_PATHS.PUBLIC}entity-types/`, ability);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    const entityTypes: EntityType[] = [];
    const updatedEntityTypes: string[] = []; // Track which entity types were updated
    
    for (const file of definitionFiles) {
      let entityType = await readJSON<EntityType>(bucket, file, ability);
      if (!entityType || !entityType.isActive) continue;
      
      // If entity type is missing visibleTo and addDefaultVisibleTo is true, add default
      if (addDefaultVisibleTo && (!entityType.visibleTo || !Array.isArray(entityType.visibleTo) || entityType.visibleTo.length === 0)) {
        // Use the first (lowest order) membership key as default, or 'public' if available
        const defaultKey = config.membershipKeys.keys.find(k => k.id === 'public') || config.membershipKeys.keys[0];
        if (defaultKey) {
          console.log('[Bundles] Adding default visibleTo to entity type', entityType.id, entityType.name, '- using key:', defaultKey.id);
          entityType = {
            ...entityType,
            visibleTo: [defaultKey.id]
          };
          // Save updated entity type - CASL verifies superadmin can write entity types
          await writeJSON(bucket, file, entityType, ability);
          updatedEntityTypes.push(entityType.id);
          console.log('[Bundles] Updated entity type', entityType.id, 'with visibleTo:', entityType.visibleTo);
        }
      }
      
      entityTypes.push(entityType);
    }
    
    console.log('[Bundles] Found', entityTypes.length, 'active entity types to regenerate');
    if (updatedEntityTypes.length > 0) {
      console.log('[Bundles] Updated', updatedEntityTypes.length, 'entity types with default visibleTo:', updatedEntityTypes);
    }
    
    // Log entity type details for debugging
    console.log('[Bundles] Entity type configurations:');
    for (const et of entityTypes) {
      const visibleTo = et.visibleTo;
      const validKeys = visibleTo && Array.isArray(visibleTo) 
        ? visibleTo.filter(keyId => config.membershipKeys.keys.some(k => k.id === keyId))
        : [];
      const invalidKeys = visibleTo && Array.isArray(visibleTo)
        ? visibleTo.filter(keyId => !config.membershipKeys.keys.some(k => k.id === keyId))
        : [];
      
      console.log('[Bundles]   -', et.id, et.name, 
        'visibleTo:', visibleTo,
        'valid keys:', validKeys,
        invalidKeys.length > 0 ? `INVALID keys: ${invalidKeys.join(', ')}` : '');
    }
    
    // Get all organizations - CASL verifies superadmin can list and read orgs
    const orgFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`, ability);
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    const organizations: Organization[] = [];
    
    for (const file of profileFiles) {
      const org = await readJSON<Organization>(bucket, file, ability);
      if (org && org.isActive) {
        organizations.push(org);
      }
    }
    
    console.log('[Bundles] Found', organizations.length, 'active organizations');
    
    // Regenerate bundles for each entity type
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    console.log('[Bundles] Starting regeneration for', entityTypes.length, 'entity types and', organizations.length, 'organizations');
    
    for (const entityType of entityTypes) {
      // Check if entity type has valid visibleTo
      const visibleTo = entityType.visibleTo;
      if (!visibleTo) {
        console.warn('[Bundles] Skipping entity type', entityType.id, entityType.name, '- missing visibleTo property');
        continue;
      }
      
      if (!Array.isArray(visibleTo)) {
        console.warn('[Bundles] Skipping entity type', entityType.id, entityType.name, '- visibleTo is not an array:', typeof visibleTo, visibleTo);
        continue;
      }
      
      if (visibleTo.length === 0) {
        console.warn('[Bundles] Skipping entity type', entityType.id, entityType.name, '- visibleTo is empty array');
        continue;
      }
      
      console.log('[Bundles] Processing entity type:', entityType.id, entityType.name, 'with visibleTo:', visibleTo);
      
      try {
        // Regenerate global bundles
        console.log('[Bundles] Regenerating global bundles for type:', entityType.id, entityType.name);
        await regenerateEntityBundles(bucket, entityType.id, null, config, ability);
        // Count each valid membership key as a separate bundle
        const validKeys = visibleTo.filter(keyId => {
          const keyDef = config.membershipKeys.keys.find(k => k.id === keyId);
          if (!keyDef) {
            console.warn('[Bundles] Key', keyId, 'not found in config for type', entityType.id);
          }
          return !!keyDef;
        });
        if (validKeys.length === 0) {
          console.warn('[Bundles] No valid membership keys found for type', entityType.id, 'visibleTo:', visibleTo, 'available keys:', config.membershipKeys.keys.map(k => k.id));
        }
        successCount += validKeys.length;
        console.log('[Bundles] Successfully regenerated', validKeys.length, 'global bundle(s) for type:', entityType.id, 'valid keys:', validKeys);
        
        // Regenerate org bundles for each organization
        for (const org of organizations) {
          try {
            console.log('[Bundles] Regenerating org bundles for:', org.id, entityType.id);
            await regenerateEntityBundles(bucket, entityType.id, org.id, config, ability);
            // Count both member and admin bundles (2 per org)
            successCount += 2;
            console.log('[Bundles] Successfully regenerated org bundles for:', org.id, entityType.id);
          } catch (error) {
            errorCount++;
            const errorMsg = `Failed to regenerate bundles for org ${org.id}, type ${entityType.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error('[Bundles]', errorMsg);
            errors.push(errorMsg);
          }
        }
      } catch (error) {
        errorCount++;
        const errorMsg = `Failed to regenerate global bundles for type ${entityType.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error('[Bundles]', errorMsg);
        errors.push(errorMsg);
      }
    }
    
    // Count how many entity types were actually processed (not skipped)
    let processedTypes = 0;
    let skippedTypes = 0;
    for (const et of entityTypes) {
      const visibleTo = et.visibleTo;
      if (visibleTo && Array.isArray(visibleTo) && visibleTo.length > 0) {
        processedTypes++;
      } else {
        skippedTypes++;
      }
    }
    
    console.log('[Bundles] Entity types - Processed:', processedTypes, 'Skipped:', skippedTypes, 'Total:', entityTypes.length);
    
    if (entityTypes.length === 0) {
      console.warn('[Bundles] No entity types found to regenerate');
    } else if (processedTypes === 0) {
      console.error('[Bundles] All entity types were skipped! Check visibleTo configuration.');
      console.error('[Bundles] Available membership keys:', config.membershipKeys.keys.map(k => `${k.id} (${k.name})`));
    }
    
    if (organizations.length === 0) {
      console.warn('[Bundles] No organizations found to regenerate');
    }
    
    console.log('[Bundles] Regeneration complete. Success:', successCount, 'Errors:', errorCount);
    console.log('[Bundles] Entity types processed:', entityTypes.length);
    console.log('[Bundles] Organizations processed:', organizations.length);
    
    if (successCount === 0 && errorCount === 0) {
      console.error('[Bundles] No bundles were regenerated!');
      console.error('[Bundles] Entity types found:', entityTypes.length);
      console.error('[Bundles] Organizations found:', organizations.length);
      console.error('[Bundles] Available membership keys:', config.membershipKeys.keys.map(k => `${k.id} (${k.name})`));
      console.error('[Bundles] Entity type configurations:');
      for (const et of entityTypes) {
        console.error('[Bundles]   -', et.id, et.name, 'visibleTo:', et.visibleTo, 'isArray:', Array.isArray(et.visibleTo));
      }
    }
    
    return c.json({
      success: true,
      data: {
        message: successCount > 0 
          ? `Regenerated ${successCount} bundle(s)${errorCount > 0 ? ` with ${errorCount} error(s)` : ''}`
          : `No bundles were regenerated. Check entity type visibleTo configuration.`,
        successCount,
        errorCount,
        entityTypesProcessed: entityTypes.length,
        entityTypesSkipped: skippedTypes,
        entityTypesUpdated: updatedEntityTypes.length,
        organizationsProcessed: organizations.length,
        availableKeys: config.membershipKeys.keys.map(k => k.id),
        entityTypeIssues: entityTypes.map(et => {
          const visibleTo = et.visibleTo;
          if (!visibleTo || !Array.isArray(visibleTo) || visibleTo.length === 0) {
            return {
              typeId: et.id,
              typeName: et.name,
              issue: !visibleTo ? 'missing visibleTo' : !Array.isArray(visibleTo) ? 'visibleTo is not an array' : 'visibleTo is empty',
              visibleTo: visibleTo
            };
          }
          const invalidKeys = visibleTo.filter(keyId => !config.membershipKeys.keys.some(k => k.id === keyId));
          if (invalidKeys.length > 0) {
            return {
              typeId: et.id,
              typeName: et.name,
              issue: 'invalid key IDs',
              visibleTo: visibleTo,
              invalidKeys: invalidKeys,
              validKeys: visibleTo.filter(keyId => config.membershipKeys.keys.some(k => k.id === keyId))
            };
          }
          return null;
        }).filter(Boolean),
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('[Bundles] Error regenerating all bundles:', error);
    return c.json({
      success: false,
      error: {
        code: 'REGENERATION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to regenerate all bundles'
      }
    }, 500);
  }
});
