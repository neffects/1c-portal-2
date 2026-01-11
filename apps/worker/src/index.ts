/**
 * 1C Portal API - Cloudflare Worker Entry Point
 * 
 * Main entry point for the API that handles:
 * - Authentication (magic links, JWT)
 * - Organization management
 * - Entity type management
 * - Entity CRUD operations
 * - User management
 * - Manifest and bundle generation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// Import route modules
import { authRoutes } from './routes/auth';
import { organizationRoutes } from './routes/organizations';
import { entityTypeRoutes } from './routes/entity-types';
import { entityRoutes } from './routes/entities';
import { userRoutes } from './routes/users';
import { manifestRoutes } from './routes/manifests';
import fileRoutes from './routes/files';
import { platformRoutes } from './routes/platform';

// Import middleware
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';

// Import types
import type { Env, Variables } from './types';

// Create Hono app with typed bindings
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true
}));

// Error handling
app.onError(errorHandler);

// Health check endpoint
app.get('/health', (c) => {
  console.log('[API] Health check');
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development'
  });
});

// API version info
app.get('/', (c) => {
  console.log('[API] Root endpoint accessed');
  return c.json({
    name: '1C Portal API',
    version: '1.0.0',
    documentation: '/docs'
  });
});

// Public routes (no auth required)
app.route('/auth', authRoutes);

// Public manifest routes
app.route('/manifests', manifestRoutes);

// Platform routes - GET /branding is public (uses optionalAuth middleware)
app.route('/api/platform', platformRoutes);

// Protected routes (auth required)
// Skip auth for platform routes which use optionalAuth
app.use('/api/*', async (c, next) => {
  // Skip auth middleware for platform routes (they use optionalAuth)
  if (c.req.path.startsWith('/api/platform')) {
    console.log('[API] Skipping auth middleware for platform route:', c.req.path);
    return next();
  }
  console.log('[API] Applying auth middleware for route:', c.req.path);
  return authMiddleware(c, next);
});

app.route('/api/organizations', organizationRoutes);
app.route('/api/entity-types', entityTypeRoutes);
app.route('/api/entities', entityRoutes);
app.route('/api/users', userRoutes);
app.route('/api/files', fileRoutes);

// File serving route (public, with auth check in route)
app.route('/files', fileRoutes);

// 404 handler
app.notFound((c) => {
  console.log('[API] 404 Not Found:', c.req.path);
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`
    }
  }, 404);
});

// Export for Cloudflare Workers
export default app;
