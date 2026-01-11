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
import { NotFoundError } from '../../middleware/error';
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
  
  const flagFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}users/${userId}/flags/`);
  const jsonFiles = flagFiles.filter(f => f.endsWith('.json'));
  
  const flags: EntityFlag[] = [];
  
  for (const file of jsonFiles) {
    const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, file);
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
  
  // Verify entity exists
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check if already flagged
  const flagPath = getUserFlagsPath(userId, entityId);
  const existingFlag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath);
  
  if (existingFlag) {
    return c.json({
      success: true,
      data: existingFlag
    });
  }
  
  // Create flag
  const flag: EntityFlag = {
    userId,
    entityId,
    reason: reason || 'No reason provided',
    flaggedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, flagPath, flag);
  
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
  
  const flagPath = getUserFlagsPath(userId, entityId);
  const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath);
  
  if (!flag) {
    throw new NotFoundError('Flag', entityId);
  }
  
  await deleteFile(c.env.R2_BUCKET, flagPath);
  
  console.log('[User] Unflagged entity:', entityId);
  
  return c.json({
    success: true,
    data: { message: 'Flag removed' }
  });
});
