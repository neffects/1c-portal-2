/**
 * Main Layout Component
 * 
 * Provides the application shell with header, navigation, and footer.
 */

import { useAuth } from '../stores/auth';
import { useSync } from '../stores/sync';

interface LayoutProps {
  children: preact.ComponentChildren;
}

/**
 * Header component with navigation
 */
function Header() {
  const { isAuthenticated, user, userRole, logout, isSuperadmin, isOrgAdmin } = useAuth();
  const { isOffline, syncing } = useSync();
  
  return (
    <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-surface-200 dark:bg-surface-900/80 dark:border-surface-700">
      <div class="container-wide">
        <div class="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" class="flex items-center gap-2 font-display font-bold text-xl text-primary-900 dark:text-primary-50">
            <img src="/logo.svg" alt="OneConsortium" class="h-8" />
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
  return (
    <footer class="border-t border-surface-200 dark:border-surface-700 mt-auto">
      <div class="container-wide py-8">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-surface-500 dark:text-surface-400">
          <div class="flex items-center gap-2">
            <span>© {new Date().getFullYear()} OneConsortium</span>
            <span class="hidden md:inline">·</span>
            <span class="hidden md:inline">Multi-tenant Content Management</span>
          </div>
          
          <div class="flex items-center gap-4">
            <a href="#" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
              Documentation
            </a>
            <a href="#" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
              Privacy
            </a>
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
  return (
    <div class="min-h-screen flex flex-col">
      <Header />
      <main class="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
