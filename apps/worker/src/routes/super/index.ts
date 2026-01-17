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
import { configRoutes } from './config';
import { bundleRoutes } from './bundles';

export const superRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Mount sub-routes
superRoutes.route('/', superOrgRoutes);
superRoutes.route('/', superEntityRoutes);
superRoutes.route('/platform', platformRoutes);
superRoutes.route('/', configRoutes);
superRoutes.route('/', bundleRoutes);