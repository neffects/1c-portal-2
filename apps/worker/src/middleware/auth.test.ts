/**
 * Auth Middleware Tests
 * 
 * Tests for authentication and authorization middleware.
 * Updated for multi-org architecture where:
 * - JWT contains only sub + email (no role/org)
 * - Superadmin is checked via SUPERADMIN_EMAILS env var
 * - Membership is checked via user-org stubs per request
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { 
  authMiddleware, 
  requireSuperadmin, 
  requireOrgAdmin,
  requireOrgMembership,
  optionalAuth 
} from './auth';
import * as jwt from '../lib/jwt';
import * as userStubs from '../lib/user-stubs';

// Helper to create a typed Hono app for testing
const createTestApp = () => new Hono<{ Bindings: Env; Variables: Variables }>();

// Mock JWT verification
vi.mock('../lib/jwt', () => ({
  verifyJWT: vi.fn()
}));

// Mock user stubs
vi.mock('../lib/user-stubs', () => ({
  userOrgStubExists: vi.fn(),
  isSuperadminEmail: vi.fn()
}));

// Mock environment (now includes SUPERADMIN_EMAILS)
const mockEnv = {
  JWT_SECRET: 'test-jwt-secret-key-12345678901234567890',
  ENVIRONMENT: 'test',
  SUPERADMIN_EMAILS: 'admin@test.com,super@test.com',
  R2_BUCKET: {} as R2Bucket
};

// Valid mock JWT payload (minimal - no role/org)
const mockPayload = {
  sub: 'user_123',
  email: 'user@test.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
};

// Superadmin mock payload
const mockSuperadminPayload = {
  sub: 'admin_123',
  email: 'admin@test.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
};

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: isSuperadminEmail returns false
    vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
  });
  
  // ==========================================================================
  // authMiddleware - Main Authentication
  // ==========================================================================
  describe('authMiddleware', () => {
    it('should return 401 when no Authorization header', async () => {
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
    
    it('should return 401 when Authorization header is not Bearer', async () => {
      const app = createTestApp();
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
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer invalid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_TOKEN');
    });
    
    it('should set user context for valid token', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId'),
          userEmail: c.get('userEmail'),
          isSuperadmin: c.get('isSuperadmin')
        });
      });
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json() as { userId: string; userEmail: string; isSuperadmin: boolean };
      expect(body.userId).toBe('user_123');
      expect(body.userEmail).toBe('user@test.com');
      expect(body.isSuperadmin).toBe(false);
    });
    
    it('should identify superadmin by email', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockSuperadminPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(true);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId'),
          userEmail: c.get('userEmail'),
          isSuperadmin: c.get('isSuperadmin')
        });
      });
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json() as { userId: string; userEmail: string; isSuperadmin: boolean };
      expect(body.userId).toBe('admin_123');
      expect(body.userEmail).toBe('admin@test.com');
      expect(body.isSuperadmin).toBe(true);
    });
    
    it('should return 401 on JWT verification error', async () => {
      vi.mocked(jwt.verifyJWT).mockRejectedValue(new Error('Token expired'));
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer expired-token' }
      }, mockEnv);
      
      expect(response.status).toBe(401);
      
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('AUTH_ERROR');
    });
  });
  
  // ==========================================================================
  // requireSuperadmin
  // ==========================================================================
  describe('requireSuperadmin', () => {
    it('should deny access to non-superadmin', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('*', requireSuperadmin());
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow superadmin', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockSuperadminPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(true);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('*', requireSuperadmin());
      app.get('/test', (c) => c.json({ success: true }));
      
      const response = await app.request('/test', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // requireOrgMembership (now checks stubs)
  // ==========================================================================
  describe('requireOrgMembership', () => {
    it('should allow superadmin to access any org', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockSuperadminPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(true);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/any_org', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should deny access when no stub exists', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      vi.mocked(userStubs.userOrgStubExists).mockResolvedValue({ exists: false });
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow access when stub exists', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      vi.mocked(userStubs.userOrgStubExists).mockResolvedValue({ exists: true, role: 'org_member' });
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgMembership('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // requireOrgAdmin (membership + admin role)
  // ==========================================================================
  describe('requireOrgAdmin', () => {
    it('should deny org_member', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      vi.mocked(userStubs.userOrgStubExists).mockResolvedValue({ exists: true, role: 'org_member' });
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgAdmin('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow org_admin', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      vi.mocked(userStubs.userOrgStubExists).mockResolvedValue({ exists: true, role: 'org_admin' });
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgAdmin('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should allow superadmin', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockSuperadminPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(true);
      
      const app = createTestApp();
      app.use('*', authMiddleware);
      app.use('/org/:orgId', requireOrgAdmin('orgId'));
      app.get('/org/:orgId', (c) => c.json({ success: true }));
      
      const response = await app.request('/org/org_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer valid-token' }
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // optionalAuth
  // ==========================================================================
  describe('optionalAuth', () => {
    it('should continue without auth header', async () => {
      const app = createTestApp();
      app.use('*', optionalAuth);
      app.get('/test', (c) => {
        return c.json({
          userId: c.get('userId') || null,
          success: true
        });
      });
      
      const response = await app.request('/test', { method: 'GET' }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json() as { userId: string | null; success: boolean };
      expect(body.userId).toBeNull();
      expect(body.success).toBe(true);
    });
    
    it('should set user context for valid token', async () => {
      vi.mocked(jwt.verifyJWT).mockResolvedValue(mockPayload);
      vi.mocked(userStubs.isSuperadminEmail).mockReturnValue(false);
      
      const app = createTestApp();
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
      
      const body = await response.json() as { userId: string; success: boolean };
      expect(body.userId).toBe('user_123');
    });
    
    it('should ignore invalid token silently', async () => {
      vi.mocked(jwt.verifyJWT).mockRejectedValue(new Error('Invalid token'));
      
      const app = createTestApp();
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
      
      const body = await response.json() as { userId: string | null; success: boolean };
      expect(body.userId).toBeNull();
    });
  });
});
