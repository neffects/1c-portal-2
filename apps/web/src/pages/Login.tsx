/**
 * Login Page
 * 
 * Magic link authentication flow.
 */

import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../stores/auth';

export function LoginPage() {
  const { requestMagicLink, verifyMagicLink, isAuthenticated, loading, error } = useAuth();
  
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  
  // Check for magic link token in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (token) {
      console.log('[Login] Found token in URL, verifying...');
      handleVerify(token);
    }
  }, []);
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated.value && !loading.value) {
      console.log('[Login] Already authenticated, redirecting...');
      route('/');
    }
  }, [isAuthenticated.value, loading.value]);
  
  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    
    const result = await requestMagicLink(email);
    
    setSubmitting(false);
    
    if (result.success) {
      setSubmitted(true);
    } else {
      setLocalError(result.error || 'Failed to send magic link');
    }
  }
  
  async function handleVerify(token: string) {
    const result = await verifyMagicLink(token);
    
    if (result.success) {
      // Clear URL params
      window.history.replaceState({}, '', '/login');
      route('/');
    } else {
      setLocalError(result.error || 'Verification failed');
    }
  }
  
  const displayError = localError || error.value;
  
  // Show loading state while verifying token
  if (loading.value) {
    return (
      <div class="min-h-[80vh] flex items-center justify-center">
        <div class="text-center">
          <span class="i-lucide-loader-2 animate-spin text-4xl text-primary-500 mb-4"></span>
          <p class="body-text">Verifying your login...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div class="min-h-[80vh] flex items-center justify-center py-12">
      <div class="w-full max-w-md px-4">
        <div class="card p-8">
          {/* Logo */}
          <div class="text-center mb-8">
            <div class="w-16 h-16 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mx-auto mb-4">
              <span class="i-lucide-key-round text-3xl text-primary-600 dark:text-primary-400"></span>
            </div>
            <h1 class="heading-3">Sign in to OneConsortium</h1>
            <p class="body-text mt-2">
              Enter your email to receive a magic link
            </p>
          </div>
          
          {submitted ? (
            /* Success state */
            <div class="text-center animate-fade-in">
              <div class="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <span class="i-lucide-mail-check text-2xl text-green-600 dark:text-green-400"></span>
              </div>
              <h2 class="heading-4 mb-2">Check your email</h2>
              <p class="body-text mb-6">
                We sent a magic link to <strong class="text-surface-900 dark:text-surface-100">{email}</strong>.
                Click the link in the email to sign in.
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setEmail('');
                }}
                class="btn-ghost text-sm"
              >
                Use a different email
              </button>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSubmit}>
              {displayError && (
                <div class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400 animate-slide-down">
                  <span class="i-lucide-alert-circle mr-2"></span>
                  {displayError}
                </div>
              )}
              
              <div class="mb-4">
                <label for="email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  placeholder="you@example.com"
                  required
                  class="input"
                  disabled={submitting}
                  autoFocus
                />
              </div>
              
              <button
                type="submit"
                class="btn-primary w-full"
                disabled={submitting || !email}
              >
                {submitting ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                    Sending...
                  </>
                ) : (
                  <>
                    Send Magic Link
                    <span class="i-lucide-arrow-right ml-2"></span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
        
        {/* Help text */}
        <p class="text-center text-sm text-surface-500 dark:text-surface-400 mt-6">
          No password required. We'll send you a secure link to sign in.
        </p>
      </div>
    </div>
  );
}
