/**
 * User Routes Aggregator
 * 
 * Aggregates all user-specific routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { userMeRoutes } from './me';
import { userPreferencesRoutes } from './preferences';
import { userFlagsRoutes } from './flags';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
userRoutes.route('/', userMeRoutes);
userRoutes.route('/', userPreferencesRoutes);
userRoutes.route('/', userFlagsRoutes);
