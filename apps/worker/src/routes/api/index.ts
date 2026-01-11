/**
 * API Routes Aggregator
 * 
 * Aggregates all authenticated platform routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { apiManifestRoutes } from './manifests';
import { apiEntityRoutes } from './entities';
import { apiEntityTypeRoutes } from './entity-types';
import { organizationRoutes } from '../organizations';

export const apiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
apiRoutes.route('/', apiManifestRoutes);
apiRoutes.route('/', apiEntityRoutes);
apiRoutes.route('/', apiEntityTypeRoutes);
apiRoutes.route('/organizations', organizationRoutes);