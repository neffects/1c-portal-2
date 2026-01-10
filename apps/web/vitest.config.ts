/**
 * Vitest Configuration for 1CC Portal Frontend
 * 
 * Configures unit testing for Preact components with:
 * - Preact Testing Library
 * - jsdom environment
 * - Coverage reporting
 */

import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'react': 'preact/compat',
      'react-dom': 'preact/compat'
    }
  },
  test: {
    // Use jsdom for browser-like environment
    environment: 'jsdom',
    
    // Enable global test utilities
    globals: true,
    
    // Setup files run before tests
    setupFiles: ['./src/__tests__/setup.ts'],
    
    // Test file patterns
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    
    // Exclude patterns
    exclude: ['node_modules', 'dist', 'e2e'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/__tests__/**',
        'src/main.tsx',
        'src/vite-env.d.ts'
      ],
      // Coverage thresholds
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60
      }
    },
    
    // Test timeout
    testTimeout: 10000,
    
    // Reporter configuration
    reporters: ['default', 'html'],
    
    // Output directory for reports
    outputFile: {
      html: './coverage/test-report.html'
    }
  }
});
