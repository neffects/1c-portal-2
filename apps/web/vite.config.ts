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
    port: 5173,
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
