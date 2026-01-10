/**
 * Entity CRUD E2E Tests
 * 
 * Tests for creating, reading, updating, and deleting entities.
 */

import { test, expect } from '@playwright/test';

// Mock authenticated user
const mockUser = {
  id: 'user_123',
  email: 'admin@test.com',
  role: 'org_admin',
  organizationId: 'org_123'
};

// Mock entity type
const mockEntityType = {
  id: 'type_123',
  name: 'Test Type',
  pluralName: 'Test Types',
  slug: 'test-type',
  fields: [
    { id: 'name', type: 'string', name: 'Name', required: true },
    { id: 'description', type: 'text', name: 'Description', required: false }
  ],
  sections: [{ id: 'main', name: 'Main', order: 0 }]
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
  data: { name: 'Test Entity', description: 'Test description' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

test.describe('Entity CRUD', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated state
    await page.evaluate((user) => {
      localStorage.setItem('auth_token', 'mock-jwt-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, mockUser);
    
    // Mock common API endpoints
    await page.route('**/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: mockUser })
      });
    });
    
    await page.route('**/api/entity-types**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [mockEntityType], total: 1 }
        })
      });
    });
  });
  
  test.describe('Create Entity', () => {
    test('should display create entity form', async ({ page }) => {
      await page.route('**/api/entity-types/type_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntityType })
        });
      });
      
      await page.goto('/admin/create/test-type');
      
      // Check form is displayed
      await expect(page.getByLabel(/name/i)).toBeVisible();
    });
    
    test('should show validation errors for required fields', async ({ page }) => {
      await page.route('**/api/entity-types/type_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntityType })
        });
      });
      
      await page.goto('/admin/create/test-type');
      
      // Submit without filling required fields
      await page.getByRole('button', { name: /save|create|submit/i }).click();
      
      // Check for validation error
      await expect(page.getByText(/required|cannot be empty/i)).toBeVisible();
    });
    
    test('should create entity successfully', async ({ page }) => {
      await page.route('**/api/entity-types/type_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntityType })
        });
      });
      
      await page.route('**/api/entities', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: mockEntity })
          });
        }
      });
      
      await page.goto('/admin/create/test-type');
      
      // Fill form
      await page.getByLabel(/name/i).fill('New Test Entity');
      await page.getByLabel(/description/i).fill('Test description');
      
      // Submit
      await page.getByRole('button', { name: /save|create|submit/i }).click();
      
      // Should show success or redirect
      await expect(
        page.getByText(/created|success/i).or(page.locator('[data-entity-id]'))
      ).toBeVisible({ timeout: 10000 });
    });
  });
  
  test.describe('Read Entity', () => {
    test('should display entity details', async ({ page }) => {
      await page.route('**/api/entities/ent_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntity })
        });
      });
      
      await page.goto('/entity/ent_123');
      
      // Check entity data is displayed
      await expect(page.getByText('Test Entity')).toBeVisible();
    });
    
    test('should show 404 for non-existent entity', async ({ page }) => {
      await page.route('**/api/entities/nonexistent', async route => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Entity not found' }
          })
        });
      });
      
      await page.goto('/entity/nonexistent');
      
      // Check for 404 message
      await expect(page.getByText(/not found|404|doesn't exist/i)).toBeVisible();
    });
  });
  
  test.describe('Update Entity', () => {
    test('should update entity successfully', async ({ page }) => {
      await page.route('**/api/entities/ent_123', async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: mockEntity })
          });
        } else if (route.request().method() === 'PATCH') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { ...mockEntity, data: { name: 'Updated Entity' }, version: 2 }
            })
          });
        }
      });
      
      await page.route('**/api/entity-types/type_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntityType })
        });
      });
      
      await page.goto('/admin/edit/ent_123');
      
      // Update name field
      await page.getByLabel(/name/i).clear();
      await page.getByLabel(/name/i).fill('Updated Entity');
      
      // Save
      await page.getByRole('button', { name: /save|update/i }).click();
      
      // Should show success
      await expect(page.getByText(/updated|saved|success/i)).toBeVisible({ timeout: 10000 });
    });
  });
  
  test.describe('Entity Status Transitions', () => {
    test('should submit entity for approval', async ({ page }) => {
      await page.route('**/api/entities/ent_123', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mockEntity })
        });
      });
      
      await page.route('**/api/entities/ent_123/transition', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              entity: { ...mockEntity, status: 'pending' },
              transition: { from: 'draft', to: 'pending', action: 'submitForApproval' }
            }
          })
        });
      });
      
      await page.goto('/admin/edit/ent_123');
      
      // Find and click submit for approval button
      const submitButton = page.getByRole('button', { name: /submit|approval/i });
      if (await submitButton.isVisible()) {
        await submitButton.click();
        
        // Should show success or status change
        await expect(page.getByText(/submitted|pending|approval/i)).toBeVisible({ timeout: 10000 });
      }
    });
  });
});
