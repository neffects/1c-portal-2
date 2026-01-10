/**
 * Auth Callback Page
 * 
 * Handles the magic link verification redirect and stores the JWT token
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../stores/auth';

export function AuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  
  useEffect(() => {
    async function processAuth() {
      console.log('[AuthCallback] Processing authentication...');
      
      // Get params from URL (set by worker redirect)
      const urlParams = new URLSearchParams(window.location.search);
      
      // Check for error from worker redirect
      const errorParam = urlParams.get('error');
      if (errorParam) {
        console.log('[AuthCallback] Error from redirect:', errorParam);
        setStatus('error');
        setError(errorParam);
        return;
      }
      
      // Get auth data from URL params
      const token = urlParams.get('token');
      const userId = urlParams.get('userId');
      const email = urlParams.get('email');
      const role = urlParams.get('role');
      const orgId = urlParams.get('orgId');
      const orgName = urlParams.get('orgName');
      const expiresAt = urlParams.get('expiresAt');
      
      if (!token || !userId || !email || !role) {
        console.log('[AuthCallback] Missing required params');
        setStatus('error');
        setError('Invalid authentication response');
        return;
      }
      
      // Build user object
      const userData = {
        id: userId,
        email,
        role: role as 'superadmin' | 'org_admin' | 'org_member',
        organizationId: orgId || null,
        organizationName: orgName || undefined
      };
      
      console.log('[AuthCallback] User authenticated:', userData);
      
      // Store token and user info
      login(token, userData, expiresAt || undefined);
      
      setStatus('success');
      
      // Clear URL params for security (don't expose token in browser history)
      window.history.replaceState({}, '', '/auth/callback');
      
      // Redirect based on role
      setTimeout(() => {
        if (role === 'superadmin') {
          route('/super');
        } else if (role === 'org_admin') {
          route('/admin');
        } else {
          route('/');
        }
      }, 1500);
    }
    
    processAuth();
  }, []);
  
  return (
    <div class="min-h-[60vh] flex items-center justify-center">
      <div class="card max-w-md w-full mx-4">
        {status === 'loading' && (
          <div class="text-center py-8">
            <div class="w-12 h-12 mx-auto mb-4 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
            <h2 class="heading-3 mb-2">Signing you in...</h2>
            <p class="text-surface-600 dark:text-surface-400">
              Please wait while we complete your authentication.
            </p>
          </div>
        )}
        
        {status === 'success' && (
          <div class="text-center py-8">
            <div class="w-12 h-12 mx-auto mb-4 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <span class="i-lucide-check text-2xl text-green-600 dark:text-green-400"></span>
            </div>
            <h2 class="heading-3 mb-2 text-green-600 dark:text-green-400">Welcome!</h2>
            <p class="text-surface-600 dark:text-surface-400">
              You've been signed in successfully. Redirecting...
            </p>
          </div>
        )}
        
        {status === 'error' && (
          <div class="text-center py-8">
            <div class="w-12 h-12 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <span class="i-lucide-x text-2xl text-red-600 dark:text-red-400"></span>
            </div>
            <h2 class="heading-3 mb-2 text-red-600 dark:text-red-400">Authentication Failed</h2>
            <p class="text-surface-600 dark:text-surface-400 mb-4">
              {error || 'Something went wrong. Please try again.'}
            </p>
            <a href="/login" class="btn-primary">
              Back to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
