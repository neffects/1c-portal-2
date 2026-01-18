/**
 * User Flags Routes
 * 
 * GET /api/user/flags - Get flagged entities
 * POST /api/user/flags - Flag an entity
 * DELETE /api/user/flags/:entityId - Unflag an entity
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { readJSON, writeJSON, deleteFile, listFiles, getUserFlagsPath, getEntityStubPath } from '../../lib/r2';
import { flagEntityRequestSchema } from '@1cc/shared';
import { NotFoundError, ForbiddenError } from '../../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { EntityFlag, EntityStub } from '@1cc/shared';

export const userFlagsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /flags
 * Get current user's flagged entities
 */
userFlagsRoutes.get('/flags', async (c) => {
  const userId = c.get('userId')!;
  console.log('[User] Getting flags for:', userId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // CASL verifies user can only list their own flags
  const flagFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}users/${userId}/flags/`, ability);
  const jsonFiles = flagFiles.filter(f => f.endsWith('.json'));
  
  const flags: EntityFlag[] = [];
  
  for (const file of jsonFiles) {
    // CASL verifies user can only read their own flags
    const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, file, ability, 'read', 'Entity');
    if (flag) {
      flags.push(flag);
    }
  }
  
  // Sort by flaggedAt
  flags.sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());
  
  console.log('[User] Found', flags.length, 'flags');
  
  return c.json({
    success: true,
    data: {
      items: flags,
      total: flags.length
    }
  });
});

/**
 * POST /flags
 * Flag an entity
 */
userFlagsRoutes.post('/flags',
  zValidator('json', flagEntityRequestSchema),
  async (c) => {
  const userId = c.get('userId')!;
  const { entityId, reason } = c.req.valid('json');
  
  console.log('[User] Flagging entity:', entityId, 'by user:', userId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Verify entity exists - CASL verifies user can read entities
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId), ability, 'read', 'Entity');
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check if already flagged - CASL verifies user can read their own flags
  const flagPath = getUserFlagsPath(userId, entityId);
  const existingFlag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath, ability, 'read', 'Entity');
  
  if (existingFlag) {
    return c.json({
      success: true,
      data: existingFlag
    });
  }
  
  // Create flag - CASL verifies user can write their own flags
  const flag: EntityFlag = {
    userId,
    entityId,
    reason: reason || 'No reason provided',
    flaggedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, flagPath, flag, ability);
  
  console.log('[User] Flagged entity:', entityId);
  
  return c.json({
    success: true,
    data: flag
  }, 201);
});

/**
 * DELETE /flags/:entityId
 * Unflag an entity
 */
userFlagsRoutes.delete('/flags/:entityId', async (c) => {
  const userId = c.get('userId')!;
  const entityId = c.req.param('entityId');
  
  console.log('[User] Unflagging entity:', entityId, 'by user:', userId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  const flagPath = getUserFlagsPath(userId, entityId);
  // CASL verifies user can read their own flags
  const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath, ability, 'read', 'Entity');
  
  if (!flag) {
    throw new NotFoundError('Flag', entityId);
  }
  
  // CASL verifies user can delete their own flags
  await deleteFile(c.env.R2_BUCKET, flagPath, ability);
  
  console.log('[User] Unflagged entity:', entityId);
  
  return c.json({
    success: true,
    data: { message: 'Flag removed' }
  });
});
