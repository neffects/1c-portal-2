/**
 * Auth Middleware Tests
 * 
 * Tests for authentication and authorization middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { 
  authMiddleware, 
  requireRole, 
  requireSuperadmin, 
  requireOrgAdmin,
  requireOrgMembership,
  optionalAuth 
} from './auth';
import * as jwt from '../lib/jwt';

// Mock JWT verification
vi.mock('../lib/jwt', () => ({
  verifyJWT: vi.fn()
}));

// Mock environment
const mockEnv = {
  JWT_SECRET: 'test-jwt-secret-key-12345678901234567890',
  ENVIRONMENT: 'test'
};

// Valid mock JWT payload
const mockPayload = {
  sub: 'user_123',
  email: 'user@test.com',
  role: 'org_admin',
  organizationId: 'org_123',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
};

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  // ==========================================================================
  // authMiddleware - Main Authentication
  // ==========================================================================
  describe('authMiddleware', () => {
    it('should return 401 when no Authorization header', async () => {
      const app = new Hono();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
    
    it('should return 401 when Authorization header is not Bearer', async () => {
      const app = new Hono();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Basic dXNlcjpwYXNz' }
      }, mockEnv);
      
      expect(response.status).toBe(401);
    });
    
    it('should return 401 for invalid token', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(null);
      
      const app = new Hono();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer invalid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_TOKEN');
    });
    
    it('should set user context for valid token', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      
      const app = new Hono();
      app.use('*', authMiddleware);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId'),
          userRole: c.get('userRole'),
          organizationId: c.get('organizationId')
        });
      });
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.userId).toBe('user_123');
      expect(body.userRole).toBe('org_admin');
      expect(body.organizationId).toBe('org_123');
    });
    
    it('should return 401 on JWT verification error', async () => {
      vi.mocked(jwt.verifyJWT).mockRejectedValue(new Error('Token expired'));
      
      const app = new Hono();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer expired-token' }
      }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json();
      expect(body.error.code).toBe('AUTH_ERROR');
    });
  });
  
  // ==========================================================================
  // requireRole - Role-Based Access
  // ==========================================================================
  describe('requireRole', () => {
    it('should return 401 when no user role', async () => {
      const app = new Hono();
      app.use('*', requireRole('superadmin'));
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(401);
    });
    
    it('should return 403 for insufficient role', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_member');
        await next();
      });
      app.use('*', requireRole('superadmin'));
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow access for matching role', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'superadmin');
        await next();
      });
      app.use('*', requireRole('superadmin'));
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should allow access for any of multiple allowed roles', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_admin');
        await next();
      });
      app.use('*', requireRole('superadmin', 'org_admin'));
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // requireSuperadmin
  // ==========================================================================
  describe('requireSuperadmin', () => {
    it('should deny access to org_admin', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_admin');
        await next();
      });
      app.use('*', requireSuperadmin);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow superadmin', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'superadmin');
        await next();
      });
      app.use('*', requireSuperadmin);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // requireOrgAdmin
  // ==========================================================================
  describe('requireOrgAdmin', () => {
    it('should deny org_member', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_member');
        await next();
      });
      app.use('*', requireOrgAdmin);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow org_admin', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_admin');
        await next();
      });
      app.use('*', requireOrgAdmin);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should allow superadmin', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'superadmin');
        await next();
      });
      app.use('*', requireOrgAdmin);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // requireOrgMembership
  // ==========================================================================
  describe('requireOrgMembership', () => {
    it('should allow superadmin to access any org', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'superadmin');
        c.set('organizationId', 'org_123');
        await next();
      });
      app.use('*', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/different_org', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should deny access to different org', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_admin');
        c.set('organizationId', 'org_123');
        await next();
      });
      app.use('*', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/different_org', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow access to own org', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('userRole', 'org_member');
        c.set('organizationId', 'org_123');
        await next();
      });
      app.use('*', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // optionalAuth
  // ==========================================================================
  describe('optionalAuth', () => {
    it('should continue without auth header', async () => {
      const app = new Hono();
      app.use('*', optionalAuth);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId') || null,
          success: true
        });
      });
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.userId).toBeNull();
      expect(body.success).toBe(true);
    });
    
    it('should set user context for valid token', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      
      const app = new Hono();
      app.use('*', optionalAuth);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId'),
          success: true
        });
      });
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.userId).toBe('user_123');
    });
    
    it('should ignore invalid token silently', async () => {
      vi.mocked(jwt.verifyJWT).mockRejectedValue(new Error('Invalid token'));
      
      const app = new Hono();
      app.use('*', optionalAuth);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId') || null,
          success: true
        });
      });
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer invalid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.userId).toBeNull();
    });
  });
});
