/**
 * Superadmin Config Routes
 * 
 * Manage platform configuration including membership keys
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { membershipKeyDefinitionSchema } from '@1cc/shared';
import { z } from 'zod';
import { readJSON, writeJSON, getAppConfigPath } from '../../lib/r2';
import { loadAppConfig, clearAppConfigCache, regenerateAllManifests } from '../../lib/bundle-invalidation';
import { ValidationError, ForbiddenError } from '../../middleware/error';
import type { AppConfig, MembershipKeyDefinition } from '@1cc/shared';
import { listFiles } from '../../lib/r2';
import type { EntityType } from '@1cc/shared';

// Schema for updating membership keys only (no tiers)
// Note: 'public' key will be auto-added if missing
const updateMembershipKeysSchema = z.object({
  keys: z.array(membershipKeyDefinitionSchema).min(1, 'At least one membership key is required')
});

export const configRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /config/membership-keys
 * Get membership keys configuration
 */
configRoutes.get('/config/membership-keys', async (c) => {
  console.log('[Config] Getting membership keys config');
  
  try {
    const config = await loadAppConfig(c.env.R2_BUCKET);
    
    console.log('[Config] Loaded config, membershipKeys:', config.membershipKeys);
    
    // Ensure public key is always present
    let keys = config.membershipKeys?.keys || [];
    const hasPublic = keys.some(k => k.id === 'public');
    
    if (!hasPublic) {
      console.log('[Config] Adding default public key');
      keys = [getDefaultPublicKey(), ...keys];
    }
    
    return c.json({
      success: true,
      data: {
        keys
      }
    });
  } catch (error) {
    console.error('[Config] Error loading membership keys:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to load membership keys config';
    console.error('[Config] Error details:', errorMessage);
    
    // If config file doesn't exist, return default structure with public key
    if (errorMessage.includes('not found') || errorMessage.includes('App config not found')) {
      console.log('[Config] Config not found, returning default keys with public');
      return c.json({
        success: true,
        data: {
          keys: [getDefaultPublicKey()]
        }
      });
    }
    
    return c.json({
      success: false,
      error: {
        code: 'CONFIG_LOAD_ERROR',
        message: errorMessage
      }
    }, 500);
  }
});

/**
 * Get default public key (always present)
 */
function getDefaultPublicKey(): MembershipKeyDefinition {
  return {
    id: 'public',
    name: 'Public',
    description: 'Accessible to everyone without authentication',
    requiresAuth: false,
    order: 0
  };
}

/**
 * Create default app config structure
 */
function createDefaultConfig(): AppConfig {
  return {
    version: '1.0.0',
    environment: 'development',
    apiBaseUrl: 'http://localhost:8787',
    r2PublicUrl: 'http://localhost:8787/assets',
    features: {
      alerts: true,
      offlineMode: true,
      realtime: false,
      darkMode: true
    },
    branding: {
      rootOrgId: 'root001',
      siteName: '1C Portal',
      defaultTheme: 'light',
      logoUrl: '/logo.svg'
    },
    sync: {
      bundleRefreshInterval: 300000,
      staleTime: 60000,
      gcTime: 86400000
    },
    auth: {
      magicLinkExpiry: 600,
      sessionDuration: 604800
    },
    membershipKeys: {
      keys: [getDefaultPublicKey()],
      organizationTiers: []
    }
  };
}

/**
 * PATCH /config/membership-keys
 * Update membership keys configuration
 */
configRoutes.patch('/config/membership-keys',
  zValidator('json', updateMembershipKeysSchema),
  async (c) => {
  console.log('[Config] Updating membership keys config');
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  try {
    const updates = c.req.valid('json');
    
    // Ensure 'public' key is always present in the update
    const hasPublic = updates.keys.some(k => k.id === 'public');
    if (!hasPublic) {
      // Add public key if missing (always at order 0)
      updates.keys = [getDefaultPublicKey(), ...updates.keys];
    }
    
    // Load current config to merge with other settings
    let currentConfig: AppConfig;
    try {
      currentConfig = await loadAppConfig(c.env.R2_BUCKET, ability);
    } catch (error) {
      // If config doesn't exist, create default config structure
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('App config not found'))) {
        console.log('[Config] Config not found, creating default config');
        currentConfig = createDefaultConfig();
      } else {
        throw error;
      }
    }
    
    // Check for keys that are in use by entity types or organizations (warn but allow)
    const usedKeys = await findKeysInUse(c.env.R2_BUCKET, ability);
    const deletedKeys: string[] = [];
    const currentKeyIds = new Set(currentConfig.membershipKeys.keys.map(k => k.id));
    const newKeyIds = new Set(updates.keys.map(k => k.id));
    
    for (const currentKeyId of currentKeyIds) {
      if (!newKeyIds.has(currentKeyId) && usedKeys.has(currentKeyId)) {
        deletedKeys.push(currentKeyId);
      }
    }
    
    if (deletedKeys.length > 0) {
      console.warn('[Config] Warning: Deleting keys that are in use:', deletedKeys);
      // Don't block deletion - allow for migrations
    }
    
    // Merge updated membership config with rest of app config
    // Preserve organizationTiers array (empty or existing) for backward compatibility
    const updatedConfig: AppConfig = {
      ...currentConfig,
      membershipKeys: {
        keys: updates.keys,
        // Keep existing tiers for now (will be removed in future migration)
        organizationTiers: currentConfig.membershipKeys.organizationTiers || []
      }
    };
    
    // Write updated config to R2 - CASL verifies superadmin can write config
    await writeJSON(c.env.R2_BUCKET, getAppConfigPath(), updatedConfig, ability);
    
    // Clear cache so next request picks up new config
    clearAppConfigCache();
    
    console.log('[Config] Membership keys config updated successfully');
    
    return c.json({
      success: true,
      data: {
        keys: updatedConfig.membershipKeys.keys,
        warnings: deletedKeys.length > 0 ? [
          `Warning: The following keys were deleted but are still in use: ${deletedKeys.join(', ')}. ` +
          'You may need to update entity types or organizations to use different keys.'
        ] : []
      }
    });
  } catch (error) {
    console.error('[Config] Error updating membership keys:', error);
    
    if (error instanceof ValidationError) {
      return c.json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      }, 400);
    }
    
    return c.json({
      success: false,
      error: {
        code: 'CONFIG_UPDATE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update membership keys config'
      }
    }, 500);
  }
});

/**
 * Helper: Find which membership keys are currently in use by entity types and organizations
 */
async function findKeysInUse(bucket: R2Bucket, ability: AppAbility | null): Promise<Set<string>> {
  const usedKeys = new Set<string>();
  
  try {
    // Check entity types - CASL verifies superadmin can list and read entity types
    const typeFiles = await listFiles(bucket, 'public/entity-types/', ability);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    
    for (const file of definitionFiles) {
      const entityType = await readJSON<EntityType>(bucket, file, ability);
      if (!entityType) continue;
      
      // Check visibleTo
      if (entityType.visibleTo) {
        for (const keyId of entityType.visibleTo) {
          usedKeys.add(keyId);
        }
      }
      
      // Check fieldVisibility
      if (entityType.fieldVisibility) {
        for (const fieldKeys of Object.values(entityType.fieldVisibility)) {
          for (const keyId of fieldKeys) {
            usedKeys.add(keyId);
          }
        }
      }
    }
    
    // Check organizations (they may have membershipKey or membershipTier field)
    // CASL verifies superadmin can list and read orgs
    const orgFiles = await listFiles(bucket, 'private/orgs/', ability);
    const profileFiles = orgFiles.filter(f => f.endsWith('/profile.json'));
    
    for (const file of profileFiles) {
      const org = await readJSON<{ membershipKey?: string; membershipTier?: string }>(bucket, file, ability);
      if (org?.membershipKey) {
        usedKeys.add(org.membershipKey);
      }
      // Also check legacy membershipTier for migration period
      if (org?.membershipTier) {
        usedKeys.add(org.membershipTier);
      }
    }
  } catch (error) {
    console.error('[Config] Error finding keys in use:', error);
    // Don't fail the update if we can't check usage
  }
  
  return usedKeys;
}

/**
 * POST /config/manifests/regenerate
 * Regenerate all manifests (global and org) (superadmin only)
 * 
 * This manually triggers manifest regeneration, which is useful after:
 * - Deleting entity types
 * - Changing membership keys
 * - Fixing manifest inconsistencies
 */
configRoutes.post('/config/manifests/regenerate', async (c) => {
  console.log('[Config] Regenerating all manifests (manual trigger)');
  
  try {
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const ability = c.get('ability');
    
    console.log('[Config] Starting manifest regeneration for all keys and orgs');
    await regenerateAllManifests(c.env.R2_BUCKET, config, ability);
    
    console.log('[Config] All manifests regenerated successfully');
    
    return c.json({
      success: true,
      data: {
        message: 'All manifests have been regenerated successfully',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Config] Error regenerating manifests:', error);
    
    return c.json({
      success: false,
      error: {
        code: 'MANIFEST_REGENERATION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to regenerate manifests'
      }
    }, 500);
  }
});
