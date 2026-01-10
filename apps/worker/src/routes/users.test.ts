/**
 * User Routes Tests
 * 
 * Comprehensive tests for user management within organizations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { userRoutes } from './users';

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
  API_BASE_URL: 'http://localhost:8787',
  SUPERADMIN_EMAILS: 'superadmin@test.com'
};

// Mock organization
const mockOrganization = {
  id: 'org_123',
  name: 'Test Organization',
  slug: 'test-org',
  description: 'A test organization',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'user_1'
};

// Mock user membership
const mockMembership = {
  userId: 'user_1',
  email: 'user@test.com',
  organizationId: 'org_123',
  role: 'org_admin',
  joinedAt: '2024-01-01T00:00:00.000Z',
  invitedBy: 'superadmin_1'
};

// Mock user preferences
const mockPreferences = {
  userId: 'user_1',
  notifications: {
    emailAlerts: true,
    alertFrequency: 'daily'
  },
  ui: {
    theme: 'system',
    language: 'en'
  },
  updatedAt: '2024-01-01T00:00:00.000Z'
};

// Mock entity stub for flag tests
const mockEntityStub = {
  entityId: 'ent_123',
  organizationId: 'org_123',
  entityTypeId: 'type_123',
  createdAt: '2024-01-01T00:00:00.000Z'
};

// Helper to create test app with auth context
function createTestApp(authContext?: { 
  userId?: string; 
  userRole?: string; 
  organizationId?: string 
}) {
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
  
  app.route('/users', userRoutes);
  return app;
}

// Helper to setup default R2 mocks
function setupR2Mocks() {
  mockR2.get.mockImplementation((key: string) => {
    console.log('[Test] R2 get:', key);
    
    if (key.includes('/profile.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockOrganization) });
    }
    if (key.includes('/users/user_1.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockMembership) });
    }
    if (key.includes('/preferences.json')) {
      return Promise.resolve({ json: () => Promise.resolve(mockPreferences) });
    }
    if (key.includes('/stubs/')) {
      return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
    }
    
    return Promise.resolve(null);
  });
  
  mockR2.put.mockResolvedValue({});
  mockR2.delete.mockResolvedValue({});
  mockR2.list.mockResolvedValue({ objects: [] });
}

describe('User Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupR2Mocks();
  });
  
  // ==========================================================================
  // GET /all - List All System Users
  // ==========================================================================
  describe('GET /all - List All Users', () => {
    it('should return 403 for non-superadmin', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/users/all', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should list all users for superadmin', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      // Mock org and user files
      mockR2.list.mockImplementation((prefix: string) => {
        if (prefix.includes('orgs/')) {
          return Promise.resolve({
            objects: [{ key: 'private/orgs/org_123/profile.json' }]
          });
        }
        if (prefix.includes('users/')) {
          return Promise.resolve({
            objects: [{ key: 'private/orgs/org_123/users/user_1.json' }]
          });
        }
        return Promise.resolve({ objects: [] });
      });
      
      const response = await app.request('/users/all', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
    });
    
    it('should include superadmins from environment variable', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      mockR2.list.mockResolvedValue({ objects: [] });
      
      const response = await app.request('/users/all', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.items.some((u: any) => u.email === 'superadmin@test.com')).toBe(true);
    });
  });
  
  // ==========================================================================
  // GET / - List Organization Users
  // ==========================================================================
  describe('GET / - List Organization Users', () => {
    it('should list users in current organization', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'private/orgs/org_123/users/user_1.json' }]
      });
      
      const response = await app.request('/users', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
    });
    
    it('should filter by orgId query param', async () => {
      const app = createTestApp({ userRole: 'superadmin' });
      
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'private/orgs/org_456/users/user_2.json' }]
      });
      
      const response = await app.request('/users?orgId=org_456', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should return 403 when accessing different org as non-superadmin', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      const response = await app.request('/users?orgId=different_org', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return empty list for user without organization', async () => {
      const app = createTestApp({ userRole: 'org_member', organizationId: undefined });
      
      const response = await app.request('/users', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
    });
  });
  
  // ==========================================================================
  // POST /invite - Invite User
  // ==========================================================================
  describe('POST /invite - Invite User', () => {
    it('should return 403 for non-admin users', async () => {
      const app = createTestApp({ userRole: 'org_member' });
      
      const response = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@test.com',
          role: 'org_member'
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should create invitation for new user', async () => {
      const app = createTestApp({ 
        userRole: 'org_admin', 
        organizationId: 'org_123',
        userId: 'user_1' 
      });
      
      mockR2.list.mockResolvedValue({ objects: [] }); // No existing users
      
      const response = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@test.com',
          role: 'org_member'
        })
      }, mockEnv);
      
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.email).toBe('newuser@test.com');
      expect(body.data.expiresAt).toBeDefined();
    });
    
    it('should return 400 for invalid email', async () => {
      const app = createTestApp({ userRole: 'org_admin' });
      
      const response = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          role: 'org_member'
        })
      }, mockEnv);
      
      expect(response.status).toBe(400);
    });
    
    it('should return 409 for existing org member', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      // Mock existing user
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'private/orgs/org_123/users/user_1.json' }]
      });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('users/')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockMembership, 
              email: 'existing@test.com' 
            }) 
          });
        }
        if (key.includes('profile.json')) {
          return Promise.resolve({ json: () => Promise.resolve(mockOrganization) });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@test.com',
          role: 'org_member'
        })
      }, mockEnv);
      
      expect(response.status).toBe(409);
    });
    
    it('should return 403 for user without organization', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: undefined });
      
      const response = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@test.com',
          role: 'org_member'
        })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
  });
  
  // ==========================================================================
  // GET /:id - Get User Details
  // ==========================================================================
  describe('GET /:id - Get User Details', () => {
    it('should return current user info for self', async () => {
      const app = createTestApp({ 
        userId: 'user_1', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      const response = await app.request('/users/user_1', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('user_1');
    });
    
    it('should return 403 for org member viewing other users', async () => {
      const app = createTestApp({ 
        userId: 'user_1', 
        userRole: 'org_member',
        organizationId: 'org_123' 
      });
      
      const response = await app.request('/users/other_user', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should allow org admin to view other users', async () => {
      const app = createTestApp({ 
        userId: 'user_1', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('users/other_user.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockMembership, 
              userId: 'other_user' 
            }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/users/other_user', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
    });
    
    it('should return 404 for non-existent user', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/users/nonexistent', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });
  
  // ==========================================================================
  // PATCH /:id/role - Update User Role
  // ==========================================================================
  describe('PATCH /:id/role - Update User Role', () => {
    it('should return 403 for non-admin users', async () => {
      const app = createTestApp({ userRole: 'org_member' });
      
      const response = await app.request('/users/other_user/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'org_admin' })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return 403 when changing own role', async () => {
      const app = createTestApp({ 
        userId: 'user_1', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      const response = await app.request('/users/user_1/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'org_member' })
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should update user role successfully', async () => {
      const app = createTestApp({ 
        userId: 'admin_user', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('users/target_user.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockMembership, 
              userId: 'target_user',
              role: 'org_member' 
            }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/users/target_user/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'org_admin' })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.role).toBe('org_admin');
    });
    
    it('should return 404 for non-existent user', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/users/nonexistent/role', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'org_admin' })
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });
  
  // ==========================================================================
  // DELETE /:id - Remove User from Organization
  // ==========================================================================
  describe('DELETE /:id - Remove User', () => {
    it('should return 403 for non-admin users', async () => {
      const app = createTestApp({ userRole: 'org_member' });
      
      const response = await app.request('/users/other_user', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should return 403 when removing self', async () => {
      const app = createTestApp({ 
        userId: 'user_1', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      const response = await app.request('/users/user_1', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(403);
    });
    
    it('should remove user successfully', async () => {
      const app = createTestApp({ 
        userId: 'admin_user', 
        userRole: 'org_admin',
        organizationId: 'org_123' 
      });
      
      mockR2.get.mockImplementation((key: string) => {
        if (key.includes('users/target_user.json')) {
          return Promise.resolve({ 
            json: () => Promise.resolve({ 
              ...mockMembership, 
              userId: 'target_user' 
            }) 
          });
        }
        return Promise.resolve(null);
      });
      
      const response = await app.request('/users/target_user', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(mockR2.delete).toHaveBeenCalled();
    });
    
    it('should return 404 for non-existent user', async () => {
      const app = createTestApp({ userRole: 'org_admin', organizationId: 'org_123' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/users/nonexistent', {
        method: 'DELETE'
      }, mockEnv);
      
      expect(response.status).toBe(404);
    });
  });
  
  // ==========================================================================
  // GET /me/preferences - Get User Preferences
  // ==========================================================================
  describe('GET /me/preferences - Get Preferences', () => {
    it('should return user preferences', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/users/me/preferences', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.notifications).toBeDefined();
      expect(body.data.ui).toBeDefined();
    });
    
    it('should return defaults when no preferences exist', async () => {
      const app = createTestApp({ userId: 'new_user', userRole: 'org_member' });
      
      mockR2.get.mockResolvedValue(null);
      
      const response = await app.request('/users/me/preferences', {
        method: 'GET'
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.data.notifications.emailAlerts).toBe(true);
      expect(body.data.ui.theme).toBe('system');
    });
  });
  
  // ==========================================================================
  // PATCH /me/preferences - Update Preferences
  // ==========================================================================
  describe('PATCH /me/preferences - Update Preferences', () => {
    it('should update preferences', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/users/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ui: { theme: 'dark' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.ui.theme).toBe('dark');
    });
    
    it('should merge with existing preferences', async () => {
      const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
      
      const response = await app.request('/users/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifications: { alertFrequency: 'weekly' }
        })
      }, mockEnv);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      // Existing emailAlerts should be preserved
      expect(body.data.notifications.emailAlerts).toBe(true);
      expect(body.data.notifications.alertFrequency).toBe('weekly');
    });
  });
  
  // ==========================================================================
  // Entity Flags
  // ==========================================================================
  describe('Entity Flags', () => {
    describe('GET /me/flags', () => {
      it('should return empty list when no flags', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.list.mockResolvedValue({ objects: [] });
        
        const response = await app.request('/users/me/flags', {
          method: 'GET'
        }, mockEnv);
        
        expect(response.status).toBe(200);
        
        const body = await response.json();
        expect(body.data.items).toEqual([]);
      });
    });
    
    describe('POST /me/flags', () => {
      it('should create flag for entity', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.get.mockImplementation((key: string) => {
          if (key.includes('stubs/')) {
            return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
          }
          // No existing flag
          if (key.includes('flags/')) {
            return Promise.resolve(null);
          }
          return Promise.resolve(null);
        });
        
        const response = await app.request('/users/me/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: 'ent_123',
            note: 'Watching for updates'
          })
        }, mockEnv);
        
        expect(response.status).toBe(201);
        
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entityId).toBe('ent_123');
      });
      
      it('should return 404 for non-existent entity', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.get.mockResolvedValue(null);
        
        const response = await app.request('/users/me/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: 'nonexistent'
          })
        }, mockEnv);
        
        expect(response.status).toBe(404);
      });
      
      it('should return 409 for already flagged entity', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.get.mockImplementation((key: string) => {
          if (key.includes('stubs/')) {
            return Promise.resolve({ json: () => Promise.resolve(mockEntityStub) });
          }
          if (key.includes('flags/')) {
            return Promise.resolve({ 
              json: () => Promise.resolve({ 
                userId: 'user_1', 
                entityId: 'ent_123' 
              }) 
            });
          }
          return Promise.resolve(null);
        });
        
        const response = await app.request('/users/me/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityId: 'ent_123'
          })
        }, mockEnv);
        
        expect(response.status).toBe(409);
      });
    });
    
    describe('DELETE /me/flags/:entityId', () => {
      it('should remove flag', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.get.mockImplementation((key: string) => {
          if (key.includes('flags/')) {
            return Promise.resolve({ 
              json: () => Promise.resolve({ 
                userId: 'user_1', 
                entityId: 'ent_123' 
              }) 
            });
          }
          return Promise.resolve(null);
        });
        
        const response = await app.request('/users/me/flags/ent_123', {
          method: 'DELETE'
        }, mockEnv);
        
        expect(response.status).toBe(200);
        expect(mockR2.delete).toHaveBeenCalled();
      });
      
      it('should return 404 for non-existent flag', async () => {
        const app = createTestApp({ userId: 'user_1', userRole: 'org_member' });
        
        mockR2.get.mockResolvedValue(null);
        
        const response = await app.request('/users/me/flags/nonexistent', {
          method: 'DELETE'
        }, mockEnv);
        
        expect(response.status).toBe(404);
      });
    });
  });
});
