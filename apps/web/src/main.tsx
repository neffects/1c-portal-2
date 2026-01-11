/**
 * OneConsortium Frontend Entry Point
 * 
 * Initializes the Preact application with:
 * - UnoCSS styles
 * - Router setup
 * - Auth state management
 */

import { render } from 'preact';
import { App } from './App';

// Import UnoCSS styles
import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';

// Import global styles
import './styles/global.css';

// Debug logging
console.log('[OneConsortium] Starting application...');

// Render app
const root = document.getElementById('app');

if (root) {
  render(<App />, root);
  console.log('[OneConsortium] Application rendered');
} else {
  console.error('[OneConsortium] Root element not found');
}
