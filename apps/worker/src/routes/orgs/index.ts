/**
 * Org Routes Aggregator
 * 
 * Aggregates all org-scoped routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { orgEntityRoutes } from './entities';
import { orgManifestRoutes } from './manifests';

export const orgRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
orgRoutes.route('/:orgId', orgEntityRoutes);
orgRoutes.route('/:orgId', orgManifestRoutes);