/**
 * Auth Routes Tests
 * 
 * Unit tests for authentication endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authRoutes } from './auth';

// Mock R2 bucket
const mockR2 = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  head: vi.fn()
};

// Mock environment
const mockEnv = {
  R2_BUCKET: mockR2,
  JWT_SECRET: 'test-jwt-secret-key-12345678901234567890',
  RESEND_API_KEY: 'test-resend-key',
  ENVIRONMENT: 'test'
};

// Create test app
function createTestApp() {
  const app = new Hono();
  app.route('/auth', authRoutes);
  return app;
}

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  describe('POST /auth/magic-link', () => {
    it('should return 400 for invalid email', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      }, mockEnv);
      
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
    
    it('should return 400 for missing email', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should create magic link for valid email', async () => {
      const app = createTestApp();
      
      mockR2.put.mockResolvedValue({});
      
      const response = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('magic link');
      
      // Verify R2 put was called
      expect(mockR2.put).toHaveBeenCalled();
    });
  });
  
  describe('GET /auth/verify', () => {
    it('should return 400 for missing token', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/verify', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 400 for invalid token format', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/verify?token=invalid', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 400 for non-existent token', async () => {
      const app = createTestApp();
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/auth/verify?token=550e8400-e29b-41d4-a716-446655440000', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.error.message).toContain('expired');
    });
    
    it('should return 400 for expired token', async () => {
      const app = createTestApp();
      
      const expiredPayload = {
        email: 'test@example.com',
        exp: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
      };
      
      mockR2.get.mockResolvedValue({
        json: () => Promise.resolve(expiredPayload)
      });
      
      const response = await app.request('/auth/verify?token=550e8400-e29b-41d4-a716-446655440000', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.error.message).toContain('expired');
    });
    
    it('should return JWT for valid token', async () => {
      const app = createTestApp();
      
      const validPayload = {
        email: 'test@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      };
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('magic-links')) {
          return Promise.resolve({
            json: () => Promise.resolve(validPayload)
          });
        }
        // User doesn't exist
        return Promise.resolve(null);
      });
      
      mockR2.put.mockResolvedValue({});
      mockR2.delete.mockResolvedValue({});
      
      const response = await app.request('/auth/verify?token=550e8400-e29b-41d4-a716-446655440000', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.token).toBeDefined();
      expect(body.data.user).toBeDefined();
      
      // Verify magic link was deleted
      expect(mockR2.delete).toHaveBeenCalled();
    });
  });
  
  describe('GET /auth/me', () => {
    it('should return 401 without auth token', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/me', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(401);
    });
  });
  
  describe('POST /auth/logout', () => {
    it('should return success', async () => {
      const app = createTestApp();
      
      const response = await app.request('/auth/logout', {
        method: 'POST'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });
});
