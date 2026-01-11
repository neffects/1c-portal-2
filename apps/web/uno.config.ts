import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss';

/**
 * UnoCSS configuration for 1C Portal
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
      // Primary brand colors - Deep teal/cyan (using CSS variables with fallbacks)
      primary: {
        50: 'var(--color-primary-50, #ecfeff)',
        100: 'var(--color-primary-100, #cffafe)',
        200: 'var(--color-primary-200, #a5f3fc)',
        300: 'var(--color-primary-300, #67e8f9)',
        400: 'var(--color-primary-400, #22d3ee)',
        500: 'var(--color-primary-500, #06b6d4)',
        600: 'var(--color-primary-600, #0891b2)',
        700: 'var(--color-primary-700, #0e7490)',
        800: 'var(--color-primary-800, #155e75)',
        900: 'var(--color-primary-900, #164e63)',
        950: 'var(--color-primary-950, #083344)'
      },
      // Accent colors - Warm amber (using CSS variables with fallbacks)
      accent: {
        50: 'var(--color-accent-50, #fffbeb)',
        100: 'var(--color-accent-100, #fef3c7)',
        200: 'var(--color-accent-200, #fde68a)',
        300: 'var(--color-accent-300, #fcd34d)',
        400: 'var(--color-accent-400, #fbbf24)',
        500: 'var(--color-accent-500, #f59e0b)',
        600: 'var(--color-accent-600, #d97706)',
        700: 'var(--color-accent-700, #b45309)',
        800: 'var(--color-accent-800, #92400e)',
        900: 'var(--color-accent-900, #78350f)',
        950: 'var(--color-accent-950, #451a03)'
      },
      // Neutral grays - Slate
      surface: {
        50: '#f8fafc',
        100: '#f1f5f9',
        200: '#e2e8f0',
        300: '#cbd5e1',
        400: '#94a3b8',
        500: '#64748b',
        600: '#475569',
        700: '#334155',
        800: '#1e293b',
        900: '#0f172a',
        950: '#020617'
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
