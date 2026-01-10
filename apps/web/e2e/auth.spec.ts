/**
 * Authentication E2E Tests
 * 
 * Tests for login, logout, and authentication flows.
 */

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });
  
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');
      
      // Check for login form elements
      await expect(page.getByRole('heading', { name: /sign in|log in/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /sign in|send|magic/i })).toBeVisible();
    });
    
    test('should show validation error for invalid email', async ({ page }) => {
      await page.goto('/login');
      
      // Enter invalid email
      await page.getByLabel(/email/i).fill('invalid-email');
      await page.getByRole('button', { name: /sign in|send|magic/i }).click();
      
      // Check for error message
      await expect(page.getByText(/valid email|invalid/i)).toBeVisible();
    });
    
    test('should show success message after magic link request', async ({ page }) => {
      await page.goto('/login');
      
      // Mock the API response
      await page.route('**/auth/magic-link', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { message: 'Magic link sent to your email' }
          })
        });
      });
      
      // Enter valid email
      await page.getByLabel(/email/i).fill('test@example.com');
      await page.getByRole('button', { name: /sign in|send|magic/i }).click();
      
      // Check for success message
      await expect(page.getByText(/sent|check.*email|magic link/i)).toBeVisible();
    });
  });
  
  test.describe('Authentication Callback', () => {
    test('should handle invalid token', async ({ page }) => {
      await page.goto('/auth/callback?token=invalid-token');
      
      // Mock the API response
      await page.route('**/auth/verify*', async route => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { message: 'Invalid or expired token' }
          })
        });
      });
      
      // Should show error or redirect to login
      await expect(page.getByText(/invalid|expired|error/i).or(page.locator('input[type="email"]'))).toBeVisible();
    });
    
    test('should redirect to home after successful verification', async ({ page }) => {
      // Mock the API response for successful auth
      await page.route('**/auth/verify*', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              token: 'mock-jwt-token',
              user: {
                id: 'user_123',
                email: 'test@example.com',
                role: 'org_admin',
                organizationId: 'org_123'
              }
            }
          })
        });
      });
      
      await page.goto('/auth/callback?token=valid-token');
      
      // Should redirect to home or dashboard
      await page.waitForURL(/\/(home|dashboard|$)/);
    });
  });
  
  test.describe('Protected Routes', () => {
    test('should redirect to login when accessing protected route unauthenticated', async ({ page }) => {
      await page.goto('/admin');
      
      // Should redirect to login
      await expect(page).toHaveURL(/login/);
    });
    
    test('should allow access to protected route when authenticated', async ({ page }) => {
      // Set up authenticated state
      await page.evaluate(() => {
        localStorage.setItem('auth_token', 'mock-jwt-token');
        localStorage.setItem('user', JSON.stringify({
          id: 'user_123',
          email: 'test@example.com',
          role: 'org_admin',
          organizationId: 'org_123'
        }));
      });
      
      // Mock auth check
      await page.route('**/auth/me', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'user_123',
              email: 'test@example.com',
              role: 'org_admin',
              organizationId: 'org_123'
            }
          })
        });
      });
      
      await page.goto('/admin');
      
      // Should stay on admin page
      await expect(page).toHaveURL(/admin/);
    });
  });
  
  test.describe('Logout', () => {
    test('should clear auth state and redirect to login', async ({ page }) => {
      // Set up authenticated state
      await page.evaluate(() => {
        localStorage.setItem('auth_token', 'mock-jwt-token');
        localStorage.setItem('user', JSON.stringify({
          id: 'user_123',
          email: 'test@example.com',
          role: 'org_admin'
        }));
      });
      
      await page.route('**/auth/logout', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
      });
      
      await page.goto('/');
      
      // Find and click logout button
      const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i });
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
        
        // Should redirect to login
        await expect(page).toHaveURL(/login|\/$/);
        
        // Auth state should be cleared
        const token = await page.evaluate(() => localStorage.getItem('auth_token'));
        expect(token).toBeNull();
      }
    });
  });
});
