/**
 * Authentication Store
 * 
 * Manages user authentication state using Preact signals.
 * Handles login, logout, and session persistence.
 */

import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import type { Session, UserRole, AuthResponse } from '@1cc/shared';
import { api } from '../lib/api';

// Auth state signals
const session = signal<Session | null>(null);
const loading = signal(true);
const error = signal<string | null>(null);

// Computed values
const isAuthenticated = computed(() => session.value !== null);
const user = computed(() => session.value?.user || null);
const userRole = computed(() => session.value?.user.role || null);
const organizationId = computed(() => session.value?.user.organizationId || null);

// Check if user has specific role
const hasRole = (roles: UserRole[]) => {
  const role = userRole.value;
  return role ? roles.includes(role) : false;
};

const isSuperadmin = computed(() => hasRole(['superadmin']));
const isOrgAdmin = computed(() => hasRole(['superadmin', 'org_admin']));

/**
 * Load session from localStorage on startup
 */
async function loadSession() {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:37',message:'loadSession entry',data:{sessionValueNull:session.value===null},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.log('[Auth] Loading session...');
  loading.value = true;
  error.value = null;
  
  try {
    const storedSession = localStorage.getItem('session');
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:44',message:'localStorage check',data:{hasStoredSession:!!storedSession},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (!storedSession) {
      console.log('[Auth] No stored session found');
      loading.value = false;
      return;
    }
    
    const parsed: Session = JSON.parse(storedSession);
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:51',message:'session parsed from localStorage',data:{hasToken:!!parsed.token,tokenLength:parsed.token?.length,expiresAt:parsed.expiresAt},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Check if expired
    if (new Date(parsed.expiresAt) < new Date()) {
      console.log('[Auth] Session expired, clearing');
      localStorage.removeItem('session');
      loading.value = false;
      return;
    }
    
    // Set session value BEFORE validation so getAuthToken() returns the token
    // This ensures the Authorization header is included in the validation request
    session.value = parsed;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:60',message:'before validation call',data:{sessionValueNull:session.value===null,parsedTokenExists:!!parsed.token,getAuthTokenResult:getAuthToken()},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // Validate token with server
    const response = await api.get('/auth/me');
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:62',message:'validation response received',data:{success:response.success,hasError:!!response.error,errorCode:response.error?.code},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    if (response.success) {
      console.log('[Auth] Session loaded:', parsed.user.id);
      // Session value already set above
    } else {
      console.log('[Auth] Session invalid, clearing');
      session.value = null;
      localStorage.removeItem('session');
    }
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:72',message:'loadSession exception',data:{errorMessage:err instanceof Error?err.message:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.error('[Auth] Load session error:', err);
    localStorage.removeItem('session');
  } finally {
    loading.value = false;
  }
}

/**
 * Request magic link for email
 */
async function requestMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  console.log('[Auth] Requesting magic link for:', email);
  error.value = null;
  
  try {
    const response = await api.post('/auth/magic-link', { email });
    
    if (response.success) {
      console.log('[Auth] Magic link sent');
      return { success: true };
    } else {
      const errorMsg = response.error?.message || 'Failed to send magic link';
      error.value = errorMsg;
      return { success: false, error: errorMsg };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to send magic link';
    error.value = errorMsg;
    return { success: false, error: errorMsg };
  }
}

/**
 * Verify magic link token and complete login
 */
async function verifyMagicLink(token: string): Promise<{ success: boolean; error?: string }> {
  console.log('[Auth] Verifying magic link...');
  loading.value = true;
  error.value = null;
  
  try {
    const response = await api.get(`/auth/verify?token=${token}`) as AuthResponse;
    
    if (response.success && response.token) {
      const newSession: Session = {
        token: response.token,
        user: response.user,
        expiresAt: response.expiresAt
      };
      
      session.value = newSession;
      localStorage.setItem('session', JSON.stringify(newSession));
      
      console.log('[Auth] Login successful:', response.user.id);
      return { success: true };
    } else {
      const errorMsg = 'Invalid or expired magic link';
      error.value = errorMsg;
      return { success: false, error: errorMsg };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Verification failed';
    error.value = errorMsg;
    return { success: false, error: errorMsg };
  } finally {
    loading.value = false;
  }
}

/**
 * Login with token and user (called from auth callback)
 */
function login(token: string, userData: Session['user'], expiresAt?: string) {
  console.log('[Auth] Logging in user:', userData.id);
  
  const newSession: Session = {
    token,
    user: userData,
    expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
  
  session.value = newSession;
  localStorage.setItem('session', JSON.stringify(newSession));
  console.log('[Auth] Login successful:', userData.role);
}

/**
 * Logout and clear session
 */
async function logout() {
  console.log('[Auth] Logging out...');
  
  try {
    await api.post('/auth/logout');
  } catch (err) {
    console.error('[Auth] Logout API error:', err);
  }
  
  session.value = null;
  localStorage.removeItem('session');
  console.log('[Auth] Logged out');
}

/**
 * Refresh token if expiring soon
 */
async function refreshToken() {
  if (!session.value) return;
  
  try {
    const response = await api.post('/auth/refresh') as { success: boolean; data?: { token: string; expiresAt: string } };
    
    if (response.success && response.data) {
      const updatedSession: Session = {
        ...session.value,
        token: response.data.token,
        expiresAt: response.data.expiresAt
      };
      
      session.value = updatedSession;
      localStorage.setItem('session', JSON.stringify(updatedSession));
      console.log('[Auth] Token refreshed');
    }
  } catch (err) {
    console.error('[Auth] Token refresh error:', err);
  }
}

// Auth context value
const authValue = {
  session,
  loading,
  error,
  isAuthenticated,
  user,
  userRole,
  organizationId,
  isSuperadmin,
  isOrgAdmin,
  login,
  requestMagicLink,
  verifyMagicLink,
  logout,
  refreshToken
};

// Create context
const AuthContext = createContext(authValue);

/**
 * Auth Provider component
 */
export function AuthProvider({ children }: { children: preact.ComponentChildren }) {
  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);
  
  return (
    <AuthContext.Provider value={authValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth state
 */
export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Get auth token for API requests
 */
export function getAuthToken(): string | null {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/stores/auth.tsx:247',message:'getAuthToken called',data:{sessionValueNull:session.value===null,hasToken:!!session.value?.token},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  return session.value?.token || null;
}
