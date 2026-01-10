/**
 * 1C Portal Frontend Entry Point
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
console.log('[1C Portal] Starting application...');

// Render app
const root = document.getElementById('app');

if (root) {
  render(<App />, root);
  console.log('[1C Portal] Application rendered');
} else {
  console.error('[1C Portal] Root element not found');
}
