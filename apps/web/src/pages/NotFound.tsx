/**
 * 404 Not Found Page
 */

export function NotFoundPage() {
  return (
    <div class="min-h-[70vh] flex items-center justify-center">
      <div class="text-center px-4">
        <div class="w-24 h-24 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-6">
          <span class="i-lucide-map-pin-off text-5xl text-surface-400"></span>
        </div>
        
        <h1 class="text-6xl font-bold text-surface-300 dark:text-surface-600 mb-4">404</h1>
        <h2 class="heading-2 mb-4">Page Not Found</h2>
        <p class="body-text text-lg mb-8 max-w-md mx-auto">
          The page you're looking for doesn't exist or has been moved.
        </p>
        
        <div class="flex flex-wrap justify-center gap-4">
          <a href="/" class="btn-primary">
            <span class="i-lucide-home mr-2"></span>
            Go Home
          </a>
          <button onClick={() => window.history.back()} class="btn-secondary">
            <span class="i-lucide-arrow-left mr-2"></span>
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
