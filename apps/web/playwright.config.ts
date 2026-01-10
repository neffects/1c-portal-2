/**
 * Playwright Configuration for 1CC Portal E2E Tests
 * 
 * Configures end-to-end testing with:
 * - Multiple browser support (Chrome, Firefox, Safari)
 * - Screenshot and trace capture on failure
 * - Parallel test execution
 * - CI/CD integration
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Environment configuration
 * BASE_URL is set by CI or defaults to local dev server
 */
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
const apiURL = process.env.API_URL || 'http://localhost:8787';

export default defineConfig({
  // Test directory
  testDir: './e2e',
  
  // Test file pattern
  testMatch: '**/*.spec.ts',
  
  // Maximum test timeout
  timeout: 30000,
  
  // Expect timeout for assertions
  expect: {
    timeout: 10000
  },
  
  // Run tests in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Number of parallel workers (use fewer on CI for stability)
  workers: process.env.CI ? 2 : undefined,
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list']
  ],
  
  // Global test settings
  use: {
    // Base URL for navigation
    baseURL,
    
    // API URL for backend requests
    extraHTTPHeaders: {
      'X-API-URL': apiURL
    },
    
    // Capture screenshot on failure
    screenshot: 'only-on-failure',
    
    // Capture trace on failure (useful for debugging)
    trace: 'retain-on-failure',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Action timeout
    actionTimeout: 10000,
    
    // Navigation timeout
    navigationTimeout: 15000
  },
  
  // Browser configurations
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      }
    },
    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] }
    }
  ],
  
  // Web server configuration for local development
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000
  },
  
  // Output directory for test artifacts
  outputDir: 'test-results'
});
