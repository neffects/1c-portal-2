/**
 * Main Layout Component
 * 
 * Provides the application shell with header, navigation, and footer.
 * Includes hidden debug panel (toggle with Ctrl+Shift+D).
 */

import { useEffect } from 'preact/hooks';
import { useAuth } from '../stores/auth';
import { useSync } from '../stores/sync';
import { useBranding } from '../stores/branding';
import { DebugPanel } from './DebugPanel';

interface LayoutProps {
  children: preact.ComponentChildren;
}

/**
 * Header component with navigation
 */
function Header() {
  const { isAuthenticated, user, userRole, logout, isSuperadmin, isOrgAdmin } = useAuth();
  const { isOffline, syncing } = useSync();
  const { siteName, logoUrl, logoDarkUrl, primaryColor, accentColor } = useBranding();
  
  return (
    <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-surface-200 dark:bg-surface-900/80 dark:border-surface-700">
      <div class="container-wide">
        <div class="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" class="flex items-center gap-2 font-display font-bold text-xl text-primary-900 dark:text-primary-50">
            {logoDarkUrl.value && (
              <>
                <img src={logoUrl.value} alt={siteName.value} class="h-8 dark:hidden" />
                <img src={logoDarkUrl.value} alt={siteName.value} class="h-8 hidden dark:block" />
              </>
            )}
            {!logoDarkUrl.value && (
              <img src={logoUrl.value} alt={siteName.value} class="h-8" />
            )}
          </a>
          
          {/* Navigation */}
          <nav class="hidden md:flex items-center gap-6">
            <a href="/" class="text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-100 transition-colors">
              Home
            </a>
            
            {isAuthenticated.value && (
              <>
                <a href="/alerts" class="text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-100 transition-colors">
                  Alerts
                </a>
                
                {isOrgAdmin.value && (
                  <a href="/admin" class="text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-100 transition-colors">
                    Admin
                  </a>
                )}
                
                {isSuperadmin.value && (
                  <a href="/super" class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors">
                    Superadmin
                  </a>
                )}
              </>
            )}
          </nav>
          
          {/* Right side */}
          <div class="flex items-center gap-4">
            {/* Sync status */}
            {isOffline.value && (
              <span class="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <span class="i-lucide-wifi-off mr-1"></span>
                Offline
              </span>
            )}
            
            {syncing.value && (
              <span class="text-surface-400">
                <span class="i-lucide-loader-2 animate-spin"></span>
              </span>
            )}
            
            {/* Theme toggle */}
            <button
              onClick={() => {
                document.documentElement.classList.toggle('dark');
                const isDark = document.documentElement.classList.contains('dark');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
              }}
              class="p-2 text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 transition-colors"
              aria-label="Toggle theme"
            >
              <span class="i-lucide-sun dark:hidden text-xl"></span>
              <span class="i-lucide-moon hidden dark:block text-xl"></span>
            </button>
            
            {/* Auth buttons */}
            {isAuthenticated.value ? (
              <div class="flex items-center gap-3">
                <span class="text-sm text-surface-600 dark:text-surface-300 hidden sm:block">
                  {user.value?.email}
                </span>
                <button
                  onClick={() => logout()}
                  class="btn-ghost text-sm"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <a href="/login" class="btn-primary text-sm">
                Sign In
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Footer component
 */
function Footer() {
  const { siteName, privacyPolicyUrl } = useBranding();
  
  return (
    <footer class="border-t border-surface-200 dark:border-surface-700 mt-auto">
      <div class="container-wide py-8">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-surface-500 dark:text-surface-400">
          <div class="flex items-center gap-2">
            <span>© {new Date().getFullYear()} {siteName.value}</span>
            <span class="hidden md:inline">·</span>
            <span class="hidden md:inline">Multi-tenant Content Management</span>
          </div>
          
          <div class="flex items-center gap-4">
            <a href="#" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
              Documentation
            </a>
            {privacyPolicyUrl.value && (
              <a href={privacyPolicyUrl.value} class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors" target="_blank" rel="noopener noreferrer">
                Privacy
              </a>
            )}
            {!privacyPolicyUrl.value && (
              <a href="#" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
                Privacy
              </a>
            )}
            <a href="#" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Main layout wrapper
 */
export function Layout({ children }: LayoutProps) {
  const { siteName, faviconUrl, primaryColor, accentColor } = useBranding();
  
  // Branding is now loaded automatically via manifest config in sync store
  
  // Update document title and favicon
  useEffect(() => {
    if (siteName.value) {
      document.title = siteName.value;
    }
    
    if (faviconUrl.value) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = faviconUrl.value;
    }
  }, [siteName.value, faviconUrl.value]);
  
  // Generate color shades from base color using HSL interpolation for better results
  function generateColorShades(baseColor: string): Record<number, string> {
    // Parse hex color
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    // Convert RGB to HSL for better color manipulation
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    
    const shades: Record<number, string> = {};
    
    // Define lightness values for each shade (500 is base)
    const lightnessValues: Record<number, number> = {
      50: 0.95, 100: 0.9, 200: 0.8, 300: 0.7, 400: 0.6,
      500: l, // Base lightness
      600: Math.max(0, l - 0.1), 700: Math.max(0, l - 0.2), 
      800: Math.max(0, l - 0.3), 900: Math.max(0, l - 0.4), 
      950: Math.max(0, l - 0.5)
    };
    
    // Convert HSL back to RGB and format as hex
    function hslToHex(h: number, s: number, l: number): string {
      let r, g, b;
      
      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      
      const toHex = (c: number) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    
    // Generate each shade
    for (const [shadeStr, lightness] of Object.entries(lightnessValues)) {
      const shadeNum = parseInt(shadeStr);
      // For lighter shades, reduce saturation slightly for better appearance
      const adjustedS = shadeNum <= 300 ? s * 0.7 : s;
      shades[shadeNum] = hslToHex(h, adjustedS, lightness);
    }
    
    return shades;
  }
  
  // Apply dynamic colors via CSS variables
  useEffect(() => {
    const root = document.documentElement;
    
    if (primaryColor.value) {
      const shades = generateColorShades(primaryColor.value);
      Object.entries(shades).forEach(([shade, color]) => {
        root.style.setProperty(`--color-primary-${shade}`, color);
      });
    } else {
      // Remove all primary color variables
      [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach(shade => {
        root.style.removeProperty(`--color-primary-${shade}`);
      });
    }
    
    if (accentColor.value) {
      const shades = generateColorShades(accentColor.value);
      Object.entries(shades).forEach(([shade, color]) => {
        root.style.setProperty(`--color-accent-${shade}`, color);
      });
    } else {
      // Remove all accent color variables
      [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach(shade => {
        root.style.removeProperty(`--color-accent-${shade}`);
      });
    }
  }, [primaryColor.value, accentColor.value]);
  
  return (
    <div class="min-h-screen flex flex-col">
      <Header />
      <main class="flex-1">
        {children}
      </main>
      <Footer />
      {/* Hidden debug panel - toggle with Ctrl+Shift+D */}
      <DebugPanel />
    </div>
  );
}
