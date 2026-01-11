import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss';

/**
 * UnoCSS configuration for OneConsortium
 * Utility-first CSS with custom design tokens
 */
export default defineConfig({
  presets: [
    // Default Tailwind-like utilities
    presetUno(),
    // Icon support (uses Iconify)
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/'
    }),
    // Typography plugin for prose content
    presetTypography()
  ],
  
  // Custom theme extending defaults
  theme: {
    colors: {
      // Primary brand colors - Black and white
      primary: {
        50: '#f5f5f5',
        100: '#e6e6e6',
        200: '#cccccc',
        300: '#b3b3b3',
        400: '#999999',
        500: '#808080',
        600: '#666666',
        700: '#4d4d4d',
        800: '#333333',
        900: '#1a1a1a',
        950: '#000000'
      },
      // Accent colors - Gray tones
      accent: {
        50: '#fafafa',
        100: '#f5f5f5',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#404040',
        800: '#262626',
        900: '#171717',
        950: '#0a0a0a'
      },
      // Neutral grays
      surface: {
        50: '#fafafa',
        100: '#f5f5f5',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#404040',
        800: '#262626',
        900: '#171717',
        950: '#0a0a0a'
      }
    },
    fontFamily: {
      // Display font for headings
      display: ['Outfit', 'system-ui', 'sans-serif'],
      // Body font
      body: ['Inter', 'system-ui', 'sans-serif'],
      // Mono font for code
      mono: ['JetBrains Mono', 'Consolas', 'monospace']
    },
    borderRadius: {
      DEFAULT: '0.5rem',
      lg: '0.75rem',
      xl: '1rem',
      '2xl': '1.5rem'
    }
  },
  
  // Custom shortcuts for common patterns
  shortcuts: {
    // Buttons
    'btn': 'inline-flex items-center justify-center px-4 py-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
    'btn-primary': 'btn bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500',
    'btn-secondary': 'btn bg-surface-100 text-surface-700 hover:bg-surface-200 focus:ring-surface-400 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700',
    'btn-ghost': 'btn text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800',
    'btn-danger': 'btn bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    
    // Inputs
    'input': 'w-full px-3 py-2 border border-surface-300 rounded-lg bg-white text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:bg-surface-800 dark:border-surface-600 dark:text-surface-100',
    'input-error': 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
    
    // Cards
    'card': 'bg-white rounded-xl shadow-sm border border-surface-200 dark:bg-surface-800 dark:border-surface-700',
    'card-hover': 'card hover:shadow-md hover:border-surface-300 transition-all dark:hover:border-surface-600',
    
    // Layout
    'container-narrow': 'max-w-2xl mx-auto px-4',
    'container-default': 'max-w-5xl mx-auto px-4',
    'container-wide': 'max-w-7xl mx-auto px-4',
    
    // Typography
    'heading-1': 'text-4xl font-bold font-display text-surface-900 dark:text-surface-50',
    'heading-2': 'text-3xl font-bold font-display text-surface-900 dark:text-surface-50',
    'heading-3': 'text-2xl font-semibold font-display text-surface-900 dark:text-surface-50',
    'heading-4': 'text-xl font-semibold text-surface-900 dark:text-surface-50',
    'body-text': 'text-surface-600 dark:text-surface-300',
    'caption': 'text-sm text-surface-500 dark:text-surface-400',
    
    // Status badges
    'badge': 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    'badge-draft': 'badge bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
    'badge-pending': 'badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'badge-published': 'badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'badge-archived': 'badge bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400'
  },
  
  // Safelist classes that might be dynamically used
  safelist: [
    'badge-draft',
    'badge-pending', 
    'badge-published',
    'badge-archived'
  ]
});
