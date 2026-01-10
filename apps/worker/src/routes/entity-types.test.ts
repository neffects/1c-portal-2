/**
 * Entity Type Routes Tests
 * 
 * Comprehensive tests for entity type (schema) management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { entityTypeRoutes } from './entity-types';

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
  RESEND_API_KEY: 'test-resend-key',
  ENVIRONMENT: 'test',
  SUPERADMIN_EMAILS: 'admin@test.com'
};

// Mock entity type
const mockEntityType = {
  id: 'type_123',
  name: 'Test Type',
  pluralName: 'Test Types',
  slug: 'test-type',
  description: 'A test entity type',
  defaultVisibility: 'members',
  fields: [
    { id: 'field_0', type: 'string', name: 'Name', required: true, sectionId: 'section_0' },
    { id: 'field_1', type: 'text', name: 'Description', required: false, sectionId: 'section_0' }
  ],
  sections: [{ id: 'section_0', name: 'Main', order: 0 }],
  tableDisplayConfig: { showName: true, showStatus: true, showUpdated: true },
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'user_1',
  updatedBy: 'user_1'
};

// Mock organization permissions
const mockPermissions = {
  organizationId: 'org_123',
  viewable: ['type_123'],
  creatable: ['type_123'],
  updatedAt: '2024-01-01T00:00:00.000Z',
  updatedBy: 'user_1'
};

// Helper to create test app with auth context
function createTestApp(authContext?: { userId?: string; userRole?: string; organizationId?: string }) {
  const app = new Hono();
  
  // Add mock auth middleware
  app.use('*', async (c, next) => {
    if (authContext) {
      c.set('userId', authContext.userId || 'user_1');
      c.set('userRole', authContext.userRole || 'org_admin');
      c.set('organizationId', authContext.organizationId || 'org_123');
    }
    await next();
  });
  
  app.route('/entity-types', entityTypeRoutes);
  return app;
}

// Helper to setup default R2 mocks
function setupR2Mocks() {
  mockR2.get.mockImplementation((key: string) => {
    console.log('[Test] R2 get:', key);
    
    if (key.includes('entity-types/type_123/definition.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
    }
    if (key.includes('permissions.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockPermissions) });
    }
    
    return Promise.resolve(null);
  });
  
  mockR2.put.mockResolvedValue({});
  mockR2.delete.mockResolvedValue({});
  mockR2.list.mockResolvedValue({ 
    objects: [
      { key: 'public/entity-types/type_123/definition.json' }
    ] 
  });
}

describe('Entity Type Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupR2Mocks();
  });
  
  // ==========================================================================
  // POST / - Create Entity Type
  // ==========================================================================
  describe('POST / - Create Entity Type', () => {
    it('should return 403 for non-superadmin users', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Type',
          pluralName: 'New Types',
          slug: 'new-type',
          defaultVisibility: 'public',
          fields: [{ type: 'string', name: 'Name', required: true, sectionId: 'main' }],
          sections: [{ name: 'Main', order: 0 }]
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should create entity type for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin', userId: 'superadmin_1' });
      
      const response = await app.request('/entity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Type',
          pluralName: 'New Types',
          slug: 'new-type',
          description: 'A new entity type',
          defaultVisibility: 'public',
          fields: [
            { type: 'string', name: 'Name', required: true, sectionId: 'section_0' }
          ],
          sections: [{ name: 'Main', order: 0 }]
        })
      }, mockEnv);
      
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('New Type');
      expect(body.data.slug).toBe('new-type');
      expect(body.data.isActive).toBe(true);
    });
    
    it('should return 400 for invalid data', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required fields
          name: 'Incomplete Type'
        })
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 409 for duplicate slug', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      // Mock finding an existing type with same slug
      mockR2.list.mockResolvedValue({ 
        objects: [{ key: 'public/entity-types/type_123/definition.json' }] 
      });
      
      const response = await app.request('/entity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Type',
          pluralName: 'Test Types',
          slug: 'test-type', // Same as existing mockEntityType
          defaultVisibility: 'public',
          fields: [{ type: 'string', name: 'Name', required: true, sectionId: 'main' }],
          sections: [{ name: 'Main', order: 0 }]
        })
      }, mockEnv);
      
      expect(response.status).toBe(409);
    });
  });
  
  // ==========================================================================
  // GET / - List Entity Types
  // ==========================================================================
  describe('GET / - List Entity Types', () => {
    it('should list entity types for authenticated users', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/entity-types', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
    });
    
    it('should filter by viewable permissions for org users', async () => {
      const app = createTestApp({ userRole: 'org_member', organizationId: 'org_123' });
      
      // Mock permissions with limited viewable types
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('permissions.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({
              ...mockPermissions,
              viewable: [] // No viewable types
            }) 
          });
        }
        if (key.includes('definition.json')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entity-types', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.items.length).toBe(0);
    });
    
    it('should filter by creatable permissions when requested', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/entity-types?permission=creatable', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should list all types for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
    });
    
    it('should include inactive types when requested by superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types?includeInactive=true', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should support search filter', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types?search=test', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should support pagination', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types?page=1&pageSize=10', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.page).toBe(1);
      expect(body.data.pageSize).toBe(10);
    });
  });
  
  // ==========================================================================
  // GET /:id - Get Entity Type
  // ==========================================================================
  describe('GET /:id - Get Entity Type', () => {
    it('should return entity type for authorized user', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('type_123');
      expect(body.data.name).toBe('Test Type');
    });
    
    it('should return 404 for non-existent type', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/entity-types/nonexistent', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should return 404 for unauthorized access to type', async () => {
      const app = createTestApp({ userRole: 'org_member', organizationId: 'org_123' });
      
      // Mock no permissions for this type
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('permissions.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({
              organizationId: 'org_123',
              viewable: [],
              creatable: []
            }) 
          });
        }
        if (key.includes('definition.json')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should allow superadmin to access any type', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // PATCH /:id - Update Entity Type
  // ==========================================================================
  describe('PATCH /:id - Update Entity Type', () => {
    it('should return 403 for non-superadmin', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Type' })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should update entity type for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin', userId: 'superadmin_1' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: 'Updated Type',
          description: 'Updated description'
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Updated Type');
      expect(body.data.description).toBe('Updated description');
    });
    
    it('should return 404 for non-existent type', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/entity-types/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' })
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should return 409 when changing to duplicate slug', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      // Mock finding another type with the target slug
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('type_123/definition.json')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
        }
        return Promise.resolve(null);
      });
      
      mockR2.list.mockResolvedValue({ 
        objects: [
          { key: 'public/entity-types/type_123/definition.json' },
          { key: 'public/entity-types/type_456/definition.json' }
        ] 
      });
      
      // Mock the second type having the slug we want to use
      const originalGet = mockR2.get;
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('type_123/definition.json')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
        }
        if (key.includes('type_456/definition.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockEntityType, 
              id: 'type_456', 
              slug: 'existing-slug' 
            }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'existing-slug' })
      }, mockEnv);
      
      expect(response.status).toBe(409);
    });
  });
  
  // ==========================================================================
  // DELETE /:id - Archive Entity Type
  // ==========================================================================
  describe('DELETE /:id - Archive Entity Type', () => {
    it('should return 403 for non-superadmin', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should archive entity type for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin', userId: 'superadmin_1' });
      
      const response = await app.request('/entity-types/type_123', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('archived');
      
      // Verify put was called to update isActive to false
      expect(mockR2.put).toHaveBeenCalled();
    });
    
    it('should return 404 for non-existent type', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/entity-types/nonexistent', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });
});
