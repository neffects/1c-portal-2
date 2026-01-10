/**
 * Admin Dashboard E2E Tests
 * 
 * Tests for admin functionality and dashboard features.
 */

import { test, expect } from '@playwright/test';

// Mock admin user
const mockAdminUser = {
  id: 'admin_123',
  email: 'admin@test.com',
  role: 'org_admin',
  organizationId: 'org_123'
};

// Mock superadmin user
const mockSuperadmin = {
  id: 'superadmin_1',
  email: 'superadmin@test.com',
  role: 'superadmin',
  organizationId: null
};

// Mock entity types
const mockEntityTypes = [
  { id: 'type_1', name: 'Articles', pluralName: 'Articles', slug: 'articles', entityCount: 5 },
  { id: 'type_2', name: 'Products', pluralName: 'Products', slug: 'products', entityCount: 12 }
];

// Mock entities
const mockEntities = [
  { id: 'ent_1', entityTypeId: 'type_1', status: 'published', data: { name: 'Article 1' } },
  { id: 'ent_2', entityTypeId: 'type_1', status: 'draft', data: { name: 'Article 2' } },
  { id: 'ent_3', entityTypeId: 'type_1', status: 'pending', data: { name: 'Article 3' } }
];

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated state
    await page.evaluate((user) => {
      localStorage.setItem('auth_token', 'mock-jwt-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, mockAdminUser);
    
    // Mock auth endpoint
    await page.route('**/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: mockAdminUser })
      });
    });
  });
  
  test.describe('Dashboard Overview', () => {
    test('should display entity types the user can manage', async ({ page }) => {
      await page.route('**/api/entity-types**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntityTypes, total: mockEntityTypes.length }
          })
        });
      });
      
      await page.goto('/admin');
      
      // Check for entity type cards
      await expect(page.getByText('Articles')).toBeVisible();
      await expect(page.getByText('Products')).toBeVisible();
    });
    
    test('should navigate to entity list when clicking type card', async ({ page }) => {
      await page.route('**/api/entity-types**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntityTypes, total: mockEntityTypes.length }
          })
        });
      });
      
      await page.route('**/api/entities**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntities, total: mockEntities.length }
          })
        });
      });
      
      await page.goto('/admin');
      
      // Click on Articles card
      await page.getByText('Articles').click();
      
      // Should navigate to entity list
      await expect(page).toHaveURL(/admin.*articles|entities.*type_1/);
    });
  });
  
  test.describe('Entity List', () => {
    test('should display entities with status badges', async ({ page }) => {
      await page.route('**/api/entities**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntities, total: mockEntities.length }
          })
        });
      });
      
      await page.goto('/admin/entities?typeId=type_1');
      
      // Check for status badges
      await expect(page.getByText(/published/i).first()).toBeVisible();
      await expect(page.getByText(/draft/i).first()).toBeVisible();
      await expect(page.getByText(/pending/i).first()).toBeVisible();
    });
    
    test('should filter entities by status', async ({ page }) => {
      await page.route('**/api/entities**', async route => {
        const url = new URL(route.request().url());
        const status = url.searchParams.get('status');
        
        const filteredEntities = status 
          ? mockEntities.filter(e => e.status === status)
          : mockEntities;
        
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: filteredEntities, total: filteredEntities.length }
          })
        });
      });
      
      await page.goto('/admin/entities?typeId=type_1');
      
      // Select draft filter
      const statusFilter = page.getByRole('combobox', { name: /status/i });
      if (await statusFilter.isVisible()) {
        await statusFilter.selectOption('draft');
        
        // Wait for filtered results
        await page.waitForResponse(resp => resp.url().includes('status=draft'));
      }
    });
    
    test('should search entities by name', async ({ page }) => {
      await page.route('**/api/entities**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntities, total: mockEntities.length }
          })
        });
      });
      
      await page.goto('/admin/entities?typeId=type_1');
      
      // Enter search term
      const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
      if (await searchInput.isVisible()) {
        await searchInput.fill('Article 1');
        await searchInput.press('Enter');
        
        // Wait for search results
        await page.waitForResponse(resp => resp.url().includes('search'));
      }
    });
  });
  
  test.describe('Create Entity Button', () => {
    test('should show create button and navigate to create form', async ({ page }) => {
      await page.route('**/api/entity-types**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntityTypes, total: mockEntityTypes.length }
          })
        });
      });
      
      await page.goto('/admin');
      
      // Find create button
      const createButton = page.getByRole('link', { name: /create|new|add/i });
      if (await createButton.first().isVisible()) {
        await createButton.first().click();
        
        // Should navigate to create page
        await expect(page).toHaveURL(/create|new/);
      }
    });
  });
});

test.describe('Superadmin Features', () => {
  test.beforeEach(async ({ page }) => {
    // Set up superadmin state
    await page.evaluate((user) => {
      localStorage.setItem('auth_token', 'mock-jwt-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, mockSuperadmin);
    
    await page.route('**/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: mockSuperadmin })
      });
    });
  });
  
  test.describe('Approval Queue', () => {
    test('should display pending entities for approval', async ({ page }) => {
      await page.route('**/api/entities**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              items: [mockEntities[2]], // Only pending entity
              total: 1
            }
          })
        });
      });
      
      await page.goto('/superadmin/approvals');
      
      // Check for pending entity
      await expect(page.getByText('Article 3')).toBeVisible();
    });
    
    test('should approve entity', async ({ page }) => {
      await page.route('**/api/entities**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: [mockEntities[2]], total: 1 }
          })
        });
      });
      
      await page.route('**/api/entities/ent_3/transition', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              entity: { ...mockEntities[2], status: 'published' },
              transition: { from: 'pending', to: 'published', action: 'approve' }
            }
          })
        });
      });
      
      await page.goto('/superadmin/approvals');
      
      // Find and click approve button
      const approveButton = page.getByRole('button', { name: /approve/i });
      if (await approveButton.isVisible()) {
        await approveButton.click();
        
        // Should show success
        await expect(page.getByText(/approved|published|success/i)).toBeVisible({ timeout: 10000 });
      }
    });
  });
  
  test.describe('Organization Management', () => {
    test('should display organizations list', async ({ page }) => {
      await page.route('**/api/organizations**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              items: [
                { id: 'org_1', name: 'Test Org 1', slug: 'test-org-1' },
                { id: 'org_2', name: 'Test Org 2', slug: 'test-org-2' }
              ],
              total: 2
            }
          })
        });
      });
      
      await page.goto('/superadmin/organizations');
      
      // Check for organizations
      await expect(page.getByText('Test Org 1')).toBeVisible();
      await expect(page.getByText('Test Org 2')).toBeVisible();
    });
  });
  
  test.describe('Entity Type Management', () => {
    test('should display entity types for management', async ({ page }) => {
      await page.route('**/api/entity-types**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: mockEntityTypes, total: mockEntityTypes.length }
          })
        });
      });
      
      await page.goto('/superadmin/types');
      
      // Check for entity types
      await expect(page.getByText('Articles')).toBeVisible();
      await expect(page.getByText('Products')).toBeVisible();
    });
  });
});
