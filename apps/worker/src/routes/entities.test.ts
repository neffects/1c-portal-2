/**
 * Entity Routes Tests
 * 
 * Comprehensive tests for entity CRUD operations and transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { entityRoutes } from './entities';

// Mock R2 bucket with type-safe mock functions
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

// Mock entity type for tests
const mockEntityType = {
  id: 'type_123',
  name: 'Test Type',
  pluralName: 'Test Types',
  slug: 'test-type',
  description: 'A test entity type',
  defaultVisibility: 'members',
  fields: [
    { id: 'name', type: 'string', name: 'Name', required: true, sectionId: 'main' },
    { id: 'description', type: 'text', name: 'Description', required: false, sectionId: 'main' }
  ],
  sections: [{ id: 'main', name: 'Main', order: 0 }],
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

// Mock entity stub
const mockEntityStub = {
  entityId: 'ent_123',
  organizationId: 'org_123',
  entityTypeId: 'type_123',
  createdAt: '2024-01-01T00:00:00.000Z'
};

// Mock latest pointer
const mockLatestPointer = {
  version: 1,
  status: 'draft',
  visibility: 'members',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

// Mock entity
const mockEntity = {
  id: 'ent_123',
  entityTypeId: 'type_123',
  organizationId: 'org_123',
  version: 1,
  status: 'draft',
  visibility: 'members',
  slug: 'test-entity',
  data: { name: 'Test Entity', description: 'A test entity' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'user_1',
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
  
  app.route('/entities', entityRoutes);
  return app;
}

// Helper to mock R2 responses based on key patterns
function setupR2Mocks() {
  mockR2.get.mockImplementation((key: string) => {
    console.log('[Test] R2 get:', key);
    
    if (key.includes('entity-types/type_123/definition.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
    }
    if (key.includes('permissions.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockPermissions) });
    }
    if (key.includes('stubs/ent_123.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
    }
    if (key.includes('latest.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockLatestPointer) });
    }
    if (key.includes('/v1.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntity) });
    }
    
    return Promise.resolve(null);
  });
  
  mockR2.put.mockResolvedValue({});
  mockR2.delete.mockResolvedValue({});
  mockR2.list.mockResolvedValue({ objects: [] });
}

describe('Entity Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupR2Mocks();
  });
  
  // ==========================================================================
  // POST / - Create Entity
  // ==========================================================================
  describe('POST / - Create Entity', () => {
    it('should return 403 for unauthenticated users', async () => {
      const app = createTestApp(undefined);
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: 'type_123',
          data: { name: 'Test' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return 400 for missing entityTypeId', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { name: 'Test' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 403 for org member (non-admin)', async () => {
      const app = createTestApp({ userRole: 'org_member' });
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: 'type_123',
          data: { name: 'Test' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should create entity successfully for org admin', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: 'type_123',
          data: { name: 'New Entity', description: 'Test description' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.entityTypeId).toBe('type_123');
      expect(body.data.status).toBe('draft');
      expect(body.data.data.name).toBe('New Entity');
    });
    
    it('should create entity successfully for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: 'type_123',
          organizationId: 'org_123',
          data: { name: 'Superadmin Entity' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(201);
    });
    
    it('should return 404 for non-existent entity type', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('entity-types/nonexistent')) {
          return Promise.resolve(null);
        }
        if (key.includes('permissions.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockPermissions, 
              creatable: ['nonexistent'] 
            }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: 'nonexistent',
          data: { name: 'Test' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });
  
  // ==========================================================================
  // GET / - List Entities
  // ==========================================================================
  describe('GET / - List Entities', () => {
    it('should return empty list when no entities exist', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      mockR2.list.mockResolvedValue({ objects: [] });
      
      const response = await app.request('/entities', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
    });
    
    it('should filter by typeId', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entities?typeId=type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should filter by status', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/entities?status=draft', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // GET /:id - Get Entity
  // ==========================================================================
  describe('GET /:id - Get Entity', () => {
    it('should return 404 for non-existent entity', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/entities/nonexistent', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should return entity for authorized user', async () => {
      const app = createTestApp({ 
        userRole: 'org_admin', 
        organizationId: 'org_123',
        userId: 'user_1' 
      });
      
      const response = await app.request('/entities/ent_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('ent_123');
    });
    
    it('should return 403 for members-only entity from different org', async () => {
      const app = createTestApp({ 
        userRole: 'org_admin', 
        organizationId: 'different_org' 
      });
      
      const response = await app.request('/entities/ent_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow superadmin to access any entity', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entities/ent_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should return specific version when requested', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entities/ent_123?version=1', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // PATCH /:id - Update Entity
  // ==========================================================================
  describe('PATCH /:id - Update Entity', () => {
    it('should return 403 for non-admin users', async () => {
      const app = createTestApp({ userRole: 'org_member' });
      
      const response = await app.request('/entities/ent_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { name: 'Updated' } })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return 404 for non-existent entity', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/entities/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { name: 'Updated' } })
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
    
    it('should update entity data with atomic merge', async () => {
      const app = createTestApp({ 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      const response = await app.request('/entities/ent_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data: { description: 'Updated description' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.version).toBe(2);
      // Original name preserved, description updated
      expect(body.data.data.name).toBe('Test Entity');
      expect(body.data.data.description).toBe('Updated description');
    });
    
    it('should return 400 for non-draft entity edit', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      // Mock a published entity
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('stubs/')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
        }
        if (key.includes('latest.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockLatestPointer, status: 'published' }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entities/ent_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { name: 'Updated' } })
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
  });
  
  // ==========================================================================
  // POST /:id/transition - Status Transitions
  // ==========================================================================
  describe('POST /:id/transition - Status Transitions', () => {
    it('should submit draft for approval', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/entities/ent_123/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitForApproval' })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.entity.status).toBe('pending');
      expect(body.data.transition.from).toBe('draft');
      expect(body.data.transition.to).toBe('pending');
    });
    
    it('should require superadmin for approval', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      // Mock pending entity
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('stubs/')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
        }
        if (key.includes('latest.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockLatestPointer, status: 'pending' }) 
          });
        }
        if (key.includes('/v1.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockEntity, status: 'pending' }) 
          });
        }
        return setupR2Mocks(), mockR2.get(key);
      });
      
      const response = await app.request('/entities/ent_123/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow superadmin to approve', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      // Mock pending entity
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('stubs/')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
        }
        if (key.includes('latest.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockLatestPointer, status: 'pending' }) 
          });
        }
        if (key.includes('/v')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockEntity, status: 'pending' }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entities/ent_123/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', feedback: 'Looks good!' })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.entity.status).toBe('published');
    });
    
    it('should return 400 for invalid transition', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      const response = await app.request('/entities/ent_123/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }) // Can't approve a draft
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should reject with feedback', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      // Mock pending entity
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('stubs/')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
        }
        if (key.includes('latest.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockLatestPointer, status: 'pending' }) 
          });
        }
        if (key.includes('/v')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ ...mockEntity, status: 'pending' }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/entities/ent_123/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'reject', 
          feedback: 'Please add more details' 
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.entity.status).toBe('draft');
      expect(body.data.entity.approvalFeedback).toBe('Please add more details');
    });
  });
});
