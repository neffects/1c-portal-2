/**
 * Superadmin Routes Aggregator
 * 
 * Aggregates all superadmin routes
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { superOrgRoutes } from './organizations';
import { superEntityRoutes } from './entities';
import { platformRoutes } from '../platform';

export const superRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
superRoutes.route('/', superOrgRoutes);
superRoutes.route('/', superEntityRoutes);
superRoutes.route('/platform', platformRoutes);