/**
 * User Preferences Routes
 * 
 * GET /api/user/preferences - Get current user preferences
 * PATCH /api/user/preferences - Update preferences
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { readJSON, writeJSON, getUserPreferencesPath } from '../../lib/r2';
import { updateUserPreferencesRequestSchema } from '@1cc/shared';
import type { UserPreferences } from '@1cc/shared';
import { ForbiddenError } from '../../middleware/error';

export const userPreferencesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /preferences
 * Get current user's preferences
 */
userPreferencesRoutes.get('/preferences', async (c) => {
  const userId = c.get('userId')!;
  console.log('[User] Getting preferences for:', userId);
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // CASL verifies user can only read their own preferences
  const preferences = await readJSON<UserPreferences>(
    c.env.R2_BUCKET,
    getUserPreferencesPath(userId),
    ability,
    'read',
    'User'
  );
  
  // Return defaults if not set
  const defaultPreferences: UserPreferences = {
    userId,
    notifications: {
      emailAlerts: true,
      alertFrequency: 'daily'
    },
    ui: {
      theme: 'system',
      language: 'en'
    },
    updatedAt: new Date().toISOString()
  };
  
  return c.json({
    success: true,
    data: preferences || defaultPreferences
  });
});

/**
 * PATCH /preferences
 * Update current user's preferences
 */
userPreferencesRoutes.patch('/preferences',
  zValidator('json', updateUserPreferencesRequestSchema),
  async (c) => {
  const userId = c.get('userId')!;
  console.log('[User] Updating preferences for:', userId);
  
  const updates = c.req.valid('json');
  
  // Get CASL ability for file-level permission checks (defense in depth)
  const ability = c.get('ability');
  if (!ability) {
    throw new ForbiddenError('CASL ability required');
  }
  
  // Get current preferences - CASL verifies user can read their own preferences
  const prefsPath = getUserPreferencesPath(userId);
  const currentPrefs = await readJSON<UserPreferences>(c.env.R2_BUCKET, prefsPath, ability, 'read', 'User');
  
  const updatedPrefs: UserPreferences = {
    userId,
    notifications: {
      emailAlerts: updates.notifications?.emailAlerts ?? currentPrefs?.notifications?.emailAlerts ?? true,
      alertFrequency: updates.notifications?.alertFrequency ?? currentPrefs?.notifications?.alertFrequency ?? 'daily',
      digestTime: updates.notifications?.digestTime ?? currentPrefs?.notifications?.digestTime
    },
    ui: {
      theme: updates.ui?.theme ?? currentPrefs?.ui?.theme ?? 'system',
      language: updates.ui?.language ?? currentPrefs?.ui?.language ?? 'en'
    },
    updatedAt: new Date().toISOString()
  };
  
  // CASL verifies user can write their own preferences
  await writeJSON(c.env.R2_BUCKET, prefsPath, updatedPrefs, ability);
  
  console.log('[User] Updated preferences for:', userId);
  
  return c.json({
    success: true,
    data: updatedPrefs
  });
});
