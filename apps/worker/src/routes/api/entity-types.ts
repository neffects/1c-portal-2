/**
 * API Entity Type Routes
 * 
 * NOTE: GET endpoints for entity types are now handled by entityTypeRoutes
 * mounted at /api/entity-types. This file is kept for potential future use
 * but currently has no active routes.
 * 
 * All entity type operations (GET, POST, PATCH, DELETE) are handled by:
 * - apps/worker/src/routes/entity-types.ts (mounted at /api/entity-types)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';

export const apiEntityTypeRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// All entity type routes are now handled by entityTypeRoutes
// This file is kept for potential future API-specific routes
