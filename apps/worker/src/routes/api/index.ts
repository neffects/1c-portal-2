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
import { entityRoutes } from '../entities';
import { entityTypeRoutes } from '../entity-types';

export const apiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
apiRoutes.route('/', apiManifestRoutes);
apiRoutes.route('/', apiEntityRoutes);
// Mount full entity routes at /entities to handle GET /api/entities/:id, POST /api/entities, etc.
// Note: GET /api/entities (list) is handled by apiEntityRoutes above
apiRoutes.route('/entities', entityRoutes);
// Mount entity type routes (includes GET /, GET /:id, PATCH /:id, POST /, DELETE /:id)
// This handles all entity type operations for both superadmin and regular users
apiRoutes.route('/entity-types', entityTypeRoutes);
// Note: apiEntityTypeRoutes is currently empty (all routes moved to entityTypeRoutes)
apiRoutes.route('/organizations', organizationRoutes);