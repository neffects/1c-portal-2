/**
 * Home Page
 * 
 * Landing page showing available entity types.
 */

import { useSync } from '../stores/sync';
import { useAuth } from '../stores/auth';
import { TypeCard, TypeCardSkeleton } from '../components/TypeCard';

export function HomePage() {
  const { entityTypes, syncing } = useSync();
  const { isAuthenticated } = useAuth();
  
  const types = entityTypes.value;
  const isLoading = syncing.value && types.length === 0;
  
  return (
    <div class="min-h-[80vh]">
      {/* Hero section */}
      <section class="relative overflow-hidden bg-gradient-to-br from-primary-50 via-white to-accent-50 dark:from-surface-900 dark:via-surface-900 dark:to-surface-800 py-20">
        {/* Background pattern */}
        <div class="absolute inset-0 opacity-10">
          <div class="absolute inset-0 bg-gradient-to-br from-primary-500/20 to-accent-500/20"></div>
        </div>
        
        <div class="container-default relative">
          <div class="max-w-3xl">
            <h1 class="heading-1 text-5xl md:text-6xl mb-6 animate-slide-up">
              <span class="text-primary-600 dark:text-primary-400">Discover</span> and manage
              <br />your content
            </h1>
            
            <p class="text-xl text-surface-600 dark:text-surface-300 mb-8 animate-slide-up stagger-1">
              A powerful multi-tenant content management system. Browse, create, and collaborate on structured content with ease.
            </p>
            
            <div class="flex flex-wrap gap-4 animate-slide-up stagger-2">
              {!isAuthenticated.value ? (
                <>
                  <a href="/login" class="btn-primary text-lg px-6 py-3">
                    Get Started
                    <span class="i-lucide-arrow-right ml-2"></span>
                  </a>
                  <a href="#browse" class="btn-secondary text-lg px-6 py-3">
                    Browse Content
                  </a>
                </>
              ) : (
                <a href="#browse" class="btn-primary text-lg px-6 py-3">
                  Browse Content
                  <span class="i-lucide-arrow-down ml-2"></span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
      
      {/* Entity types section */}
      <section id="browse" class="container-default py-16">
        <div class="flex items-center justify-between mb-8">
          <h2 class="heading-2">Browse by Category</h2>
          
          {syncing.value && types.length > 0 && (
            <span class="flex items-center gap-2 text-sm text-surface-500">
              <span class="i-lucide-loader-2 animate-spin"></span>
              Updating...
            </span>
          )}
        </div>
        
        {isLoading ? (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <TypeCardSkeleton key={i} />
            ))}
          </div>
        ) : types.length > 0 ? (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {types.map((type, index) => (
              <div key={type.id} class={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
                <TypeCard type={type} />
              </div>
            ))}
          </div>
        ) : (
          <div class="text-center py-16">
            <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
              <span class="i-lucide-inbox text-3xl text-surface-400"></span>
            </div>
            <h3 class="heading-4 mb-2">No content yet</h3>
            <p class="body-text">
              Entity types will appear here once they're created.
            </p>
          </div>
        )}
      </section>
      
      {/* Features section */}
      <section class="bg-surface-50 dark:bg-surface-800/50 py-16">
        <div class="container-default">
          <h2 class="heading-2 text-center mb-12">Platform Features</h2>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="text-center">
              <div class="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mx-auto mb-4">
                <span class="i-lucide-zap text-2xl text-primary-600 dark:text-primary-400"></span>
              </div>
              <h3 class="heading-4 mb-2">Fast & Offline-Ready</h3>
              <p class="body-text">
                Content is cached locally for instant access, even without an internet connection.
              </p>
            </div>
            
            <div class="text-center">
              <div class="w-14 h-14 rounded-2xl bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center mx-auto mb-4">
                <span class="i-lucide-shield text-2xl text-accent-600 dark:text-accent-400"></span>
              </div>
              <h3 class="heading-4 mb-2">Secure Multi-Tenancy</h3>
              <p class="body-text">
                Organizations are completely isolated with fine-grained access controls.
              </p>
            </div>
            
            <div class="text-center">
              <div class="w-14 h-14 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <span class="i-lucide-workflow text-2xl text-green-600 dark:text-green-400"></span>
              </div>
              <h3 class="heading-4 mb-2">Approval Workflows</h3>
              <p class="body-text">
                Content goes through review before publishing, ensuring quality.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
