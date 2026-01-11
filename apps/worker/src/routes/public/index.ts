/**
 * Public Routes Aggregator
 * 
 * Aggregates all public (no auth) routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { brandingRoutes } from './branding';
import { publicManifestRoutes } from './manifests';
import { publicEntityRoutes } from './entities';
import { deepLinkRoutes } from './deep-link';

export const publicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
publicRoutes.route('/', brandingRoutes);
publicRoutes.route('/', publicManifestRoutes);
publicRoutes.route('/', publicEntityRoutes);
// Deep link routes must be mounted last to avoid catching other routes
publicRoutes.route('/', deepLinkRoutes);
