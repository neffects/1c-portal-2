/**
 * Organization Routes Tests
 * 
 * Unit tests for organization management endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { organizationRoutes } from './organizations';
import { authMiddleware } from '../middleware/auth';

// Mock R2 bucket
const mockR2 = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  head: vi.fn(),
  list: vi.fn()
};

// Mock environment
const mockEnv = {
  R2_BUCKET: mockR2,
  JWT_SECRET: 'test-jwt-secret-key-12345678901234567890',
  ENVIRONMENT: 'test'
};

// Mock authenticated user context
const mockSuperadminContext = {
  userId: 'user-123',
  userRole: 'superadmin',
  organizationId: null
};

const mockOrgAdminContext = {
  userId: 'user-456',
  userRole: 'org_admin',
  organizationId: 'org-789'
};

// Create test app with mock auth
function createTestApp(userContext = mockSuperadminContext) {
  const app = new Hono();
  
  // Mock auth middleware
  app.use('*', async (c, next) => {
    c.set('userId', userContext.userId);
    c.set('userRole', userContext.userRole);
    c.set('organizationId', userContext.organizationId);
    await next();
  });
  
  app.route('/api/organizations', organizationRoutes);
  return app;
}

describe('Organization Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  describe('POST /api/organizations', () => {
    it('should return 403 for non-superadmin', async () => {
      const app = createTestApp(mockOrgAdminContext);
      
      const response = await app.request('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Org',
          slug: 'test-org'
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return 400 for invalid data', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      const response = await app.request('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '' // Empty name
        })
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 409 for duplicate slug', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      // Mock existing org with same slug
      mockR2.head.mockResolvedValue({});
      
      const response = await app.request('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Org',
          slug: 'existing-slug'
        })
      }, mockEnv);
      
      expect(response.status).toBe(409);
    });
    
    it('should create organization for superadmin', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      mockR2.head.mockResolvedValue(null);
      mockR2.put.mockResolvedValue({});
      
      const response = await app.request('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Organization',
          slug: 'test-org'
        })
      }, mockEnv);
      
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Test Organization');
      expect(body.data.slug).toBe('test-org');
      expect(body.data.id).toBeDefined();
    });
  });
  
  describe('GET /api/organizations', () => {
    it('should list organizations for superadmin', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      mockR2.list.mockResolvedValue({
        objects: [
          { key: 'platform/organizations/org-1/profile.json' },
          { key: 'platform/organizations/org-2/profile.json' }
        ]
      });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('org-1')) {
          return Promise.resolve({
            json: () => Promise.resolve({ id: 'org-1', name: 'Org 1', slug: 'org-1' })
          });
        }
        if (key.includes('org-2')) {
          return Promise.resolve({
            json: () => Promise.resolve({ id: 'org-2', name: 'Org 2', slug: 'org-2' })
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/api/organizations', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
    });
  });
  
  describe('GET /api/organizations/:id', () => {
    it('should return 404 for non-existent org', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/api/organizations/non-existent', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should return organization details', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      const mockOrg = {
        id: 'org-123',
        name: 'Test Org',
        slug: 'test-org',
        createdAt: '2024-01-01T00:00:00Z'
      };
      
      mockR2.get.mockResolvedValue({
        json: () => Promise.resolve(mockOrg)
      });
      
      const response = await app.request('/api/organizations/org-123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('org-123');
      expect(body.data.name).toBe('Test Org');
    });
  });
  
  describe('PATCH /api/organizations/:id', () => {
    it('should return 403 for non-admin of the org', async () => {
      const app = createTestApp({
        userId: 'user-123',
        userRole: 'org_member',
        organizationId: 'different-org'
      });
      
      const response = await app.request('/api/organizations/org-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should update organization for superadmin', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      const existingOrg = {
        id: 'org-123',
        name: 'Old Name',
        slug: 'old-slug',
        createdAt: '2024-01-01T00:00:00Z'
      };
      
      mockR2.get.mockResolvedValue({
        json: () => Promise.resolve(existingOrg)
      });
      mockR2.put.mockResolvedValue({});
      
      const response = await app.request('/api/organizations/org-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('New Name');
    });
  });
  
  describe('DELETE /api/organizations/:id', () => {
    it('should return 403 for non-superadmin', async () => {
      const app = createTestApp(mockOrgAdminContext);
      
      const response = await app.request('/api/organizations/org-123', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should soft delete organization for superadmin', async () => {
      const app = createTestApp(mockSuperadminContext);
      
      const existingOrg = {
        id: 'org-123',
        name: 'Test Org',
        slug: 'test-org',
        isActive: true
      };
      
      mockR2.get.mockResolvedValue({
        json: () => Promise.resolve(existingOrg)
      });
      mockR2.put.mockResolvedValue({});
      
      const response = await app.request('/api/organizations/org-123', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      // Verify soft delete (isActive = false)
      expect(mockR2.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"isActive":false'),
        expect.any(Object)
      );
    });
  });
});
