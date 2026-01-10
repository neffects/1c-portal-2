/**
 * Manifest Routes Tests
 * 
 * Tests for manifest and bundle retrieval for client sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { manifestRoutes } from './manifests';

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

// Mock manifest
const mockManifest = {
  generatedAt: '2024-01-01T00:00:00.000Z',
  version: 1704067200000,
  entityTypes: [
    {
      id: 'type_123',
      name: 'Test Type',
      pluralName: 'Test Types',
      slug: 'test-type',
      description: 'A test type',
      entityCount: 5,
      bundleVersion: 1704067200000,
      lastUpdated: '2024-01-01T00:00:00.000Z'
    }
  ]
};

// Mock bundle
const mockBundle = {
  typeId: 'type_123',
  typeName: 'Test Types',
  generatedAt: '2024-01-01T00:00:00.000Z',
  version: 1704067200000,
  entityCount: 2,
  entities: [
    {
      id: 'ent_1',
      version: 1,
      status: 'published',
      slug: 'entity-1',
      data: { name: 'Entity 1' },
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 'ent_2',
      version: 1,
      status: 'published',
      slug: 'entity-2',
      data: { name: 'Entity 2' },
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  ]
};

// Mock entity type
const mockEntityType = {
  id: 'type_123',
  name: 'Test Type',
  pluralName: 'Test Types',
  slug: 'test-type',
  isActive: true
};

// Mock permissions
const mockPermissions = {
  organizationId: 'org_123',
  viewable: ['type_123'],
  creatable: ['type_123']
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
  
  app.route('/manifests', manifestRoutes);
  return app;
}

// Setup R2 mocks
function setupR2Mocks() {
  mockR2.get.mockImplementation((key: string) => {
    if (key.includes('manifest.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockManifest) });
    }
    if (key.includes('bundle.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockBundle) });
    }
    if (key.includes('entity-types/') && key.includes('definition.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
    }
    if (key.includes('permissions.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockPermissions) });
    }
    return Promise.resolve(null);
  });
  
  mockR2.put.mockResolvedValue({});
  mockR2.list.mockResolvedValue({ objects: [] });
}

describe('Manifest Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupR2Mocks();
  });
  
  // ==========================================================================
  // GET /public - Public Manifest
  // ==========================================================================
  describe('GET /public - Public Manifest', () => {
    it('should return public manifest without auth', async () => {
      const app = createTestApp(); // No auth context
      
      const response = await app.request('/manifests/public', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.entityTypes).toBeDefined();
    });
    
    it('should generate manifest if not cached', async () => {
      const app = createTestApp();
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('manifest.json')) {
          return Promise.resolve(null); // No cached manifest
        }
        if (key.includes('entity-types/')) {
          return Promise.resolve({ json: () => Promise.resolve(mockEntityType) });
        }
        return Promise.resolve(null);
      });
      
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'public/entity-types/type_123/definition.json' }]
      });
      
      const response = await app.request('/manifests/public', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // GET /platform - Platform Manifest
  // ==========================================================================
  describe('GET /platform - Platform Manifest', () => {
    it('should return public manifest for unauthenticated users', async () => {
      const app = createTestApp(); // No auth
      
      const response = await app.request('/manifests/platform', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should return authenticated manifest for logged-in users', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/manifests/platform', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // GET /bundles/public/:typeId - Public Bundle
  // ==========================================================================
  describe('GET /bundles/public/:typeId - Public Bundle', () => {
    it('should return public bundle without auth', async () => {
      const app = createTestApp();
      
      const response = await app.request('/manifests/bundles/public/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.typeId).toBe('type_123');
      expect(body.data.entities).toBeDefined();
    });
  });
  
  // ==========================================================================
  // GET /bundles/platform/:typeId - Platform Bundle
  // ==========================================================================
  describe('GET /bundles/platform/:typeId - Platform Bundle', () => {
    it('should require authentication', async () => {
      const app = createTestApp(); // No auth
      
      const response = await app.request('/manifests/bundles/platform/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return bundle for authenticated users', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/manifests/bundles/platform/type_123', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
  });
  
  // ==========================================================================
  // POST /sync - Sync Check
  // ==========================================================================
  describe('POST /sync - Sync Check', () => {
    it('should return no updates when versions match', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/manifests/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifestVersion: mockManifest.version,
          bundleVersions: {
            'type_123': mockBundle.version
          }
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.manifestUpdated).toBe(false);
      expect(body.data.updatedBundles).toEqual([]);
    });
    
    it('should return updated manifest when version is older', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/manifests/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifestVersion: 1000000, // Old version
          bundleVersions: {}
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.manifestUpdated).toBe(true);
      expect(body.data.manifest).toBeDefined();
    });
    
    it('should detect removed entity types', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/manifests/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifestVersion: mockManifest.version,
          bundleVersions: {
            'type_123': mockBundle.version,
            'deleted_type': 12345 // This type no longer exists
          }
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.removedTypes).toContain('deleted_type');
    });
  });
});
