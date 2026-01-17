import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import UnoCSS from 'unocss/vite';
import { resolve } from 'path';

/**
 * Vite configuration for 1C Portal frontend
 * Uses Preact for lightweight React alternative and UnoCSS for styling
 */
export default defineConfig({
  plugins: [
    // UnoCSS for utility-first CSS
    UnoCSS(),
    // Preact plugin for JSX transformation
    preact()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Ensure preact compatibility
      'react': 'preact/compat',
      'react-dom': 'preact/compat'
    }
  },
  server: {
    // IMPORTANT: Port 5173 is fixed and must not be changed
    // This port is referenced in wrangler.toml FRONTEND_URL and AGENTS.md
    port: 5173,
    // Strict mode: fail if port is already in use (don't try another port)
    strictPort: true,
    // Proxy API requests to worker in development
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      // Only proxy specific auth API endpoints, not /auth/callback (frontend route)
      '^/auth/(?!callback)': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/manifests': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      // Proxy file uploads/downloads to worker
      '/files': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      // Proxy public API routes (branding, etc.)
      '/public': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    // Target modern browsers for smaller bundle
    target: 'es2022',
    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor chunk
          vendor: ['preact', 'preact/hooks', '@preact/signals'],
          // Router chunk
          router: ['preact-router']
        }
      }
    }
  }
});
