/**
 * Authentication Store
 * 
 * Manages user authentication state using Preact signals.
 * Handles login, logout, session persistence, and organization context.
 * 
 * Note: Users can belong to multiple organizations with different roles.
 * The currentOrganizationId tracks which org context is currently selected.
 */

import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import type { Session, UserRole, AuthResponse, UserOrganization } from '@1cc/shared';
import { api } from '../lib/api';

// Auth state signals
const session = signal<Session | null>(null);
const loading = signal(true);
const error = signal<string | null>(null);

// Current organization context (which org the user is acting as)
const currentOrgId = signal<string | null>(null);

// Computed values
const isAuthenticated = computed(() => session.value !== null);
const user = computed(() => session.value?.user || null);

// Organizations the user belongs to
const organizations = computed(() => session.value?.user.organizations || []);

// Current organization details
const currentOrganization = computed(() => {
  const orgId = currentOrgId.value;
  if (!orgId) return null;
  return organizations.value.find(o => o.id === orgId) || null;
});

// Current organization ID (for compatibility with existing code)
const organizationId = computed(() => currentOrgId.value);

// Is the user a superadmin?
const isSuperadmin = computed(() => session.value?.user.isSuperadmin || false);

// Role in the current organization
const currentRole = computed(() => {
  if (isSuperadmin.value) return 'superadmin' as UserRole;
  return currentOrganization.value?.role || null;
});

// Is the user an admin in the current organization?
const isOrgAdmin = computed(() => {
  if (isSuperadmin.value) return true;
  return currentRole.value === 'org_admin';
});

// Legacy userRole - returns role in current org context
const userRole = computed(() => currentRole.value);

/**
 * Load session from localStorage on startup
 */
async function loadSession() {
  console.log('[Auth] Loading session...');
  loading.value = true;
  error.value = null;
  
  try {
    const storedSession = localStorage.getItem('session');
    const storedOrgId = localStorage.getItem('currentOrgId');
    
    if (!storedSession) {
      console.log('[Auth] No stored session found');
      loading.value = false;
      return;
    }
    
    const parsed: Session = JSON.parse(storedSession);
    
    // Check if expired
    if (new Date(parsed.expiresAt) < new Date()) {
      console.log('[Auth] Session expired, clearing');
      localStorage.removeItem('session');
      localStorage.removeItem('currentOrgId');
      loading.value = false;
      return;
    }
    
    // Set session value BEFORE validation so getAuthToken() returns the token
    session.value = parsed;
    
    // Restore current organization context
    if (storedOrgId) {
      currentOrgId.value = storedOrgId;
    } else if (parsed.currentOrganizationId) {
      currentOrgId.value = parsed.currentOrganizationId;
    } else if (parsed.user.organizations.length > 0) {
      // Default to first organization
      currentOrgId.value = parsed.user.organizations[0].id;
    }
    
    // Validate token with server and refresh organizations list
    const response = await api.get('/api/user/me') as { 
      success: boolean; 
      data?: { 
        id: string; 
        email: string;
        isSuperadmin: boolean;
        organizations: UserOrganization[];
      } 
    };
    
    if (response.success && response.data) {
      console.log('[Auth] Session validated, updating organizations');
      
      // Update session with latest org data from server
      const updatedSession: Session = {
        ...parsed,
        user: {
          ...parsed.user,
          organizations: response.data.organizations,
          isSuperadmin: response.data.isSuperadmin
        }
      };
      
      session.value = updatedSession;
      localStorage.setItem('session', JSON.stringify(updatedSession));
      
      // Ensure currentOrgId is set if we have organizations
      if (response.data.organizations.length > 0) {
        // Verify current org is still valid
        const orgStillValid = currentOrgId.value && response.data.organizations.some(o => o.id === currentOrgId.value);
        
        // If no current org or current org is invalid, set to first organization
        if (!orgStillValid) {
          currentOrgId.value = response.data.organizations[0].id;
          localStorage.setItem('currentOrgId', currentOrgId.value);
          console.log('[Auth] Set default organization to:', currentOrgId.value);
        }
      } else {
        // No organizations - clear current org
        currentOrgId.value = null;
        localStorage.removeItem('currentOrgId');
      }
      
      console.log('[Auth] Session loaded:', parsed.user.id, 'orgs:', response.data.organizations.length, 'currentOrg:', currentOrgId.value);
    } else {
      console.log('[Auth] Session invalid, clearing');
      session.value = null;
      currentOrgId.value = null;
      localStorage.removeItem('session');
      localStorage.removeItem('currentOrgId');
    }
  } catch (err) {
    console.error('[Auth] Load session error:', err);
    localStorage.removeItem('session');
    localStorage.removeItem('currentOrgId');
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
      // Set default organization (first one, if any)
      const defaultOrgId = response.user.organizations.length > 0 
        ? response.user.organizations[0].id 
        : null;
      
      const newSession: Session = {
        token: response.token,
        user: response.user,
        currentOrganizationId: defaultOrgId,
        expiresAt: response.expiresAt
      };
      
      session.value = newSession;
      currentOrgId.value = defaultOrgId;
      
      localStorage.setItem('session', JSON.stringify(newSession));
      if (defaultOrgId) {
        localStorage.setItem('currentOrgId', defaultOrgId);
      }
      
      console.log('[Auth] Login successful:', response.user.id, 'orgs:', response.user.organizations.length);
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
  
  // Set default organization (first one, if any)
  const defaultOrgId = userData.organizations.length > 0 
    ? userData.organizations[0].id 
    : null;
  
  const newSession: Session = {
    token,
    user: userData,
    currentOrganizationId: defaultOrgId,
    expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
  
  session.value = newSession;
  currentOrgId.value = defaultOrgId;
  
  localStorage.setItem('session', JSON.stringify(newSession));
  if (defaultOrgId) {
    localStorage.setItem('currentOrgId', defaultOrgId);
  }
  
  console.log('[Auth] Login successful, orgs:', userData.organizations.length);
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
  currentOrgId.value = null;
  localStorage.removeItem('session');
  localStorage.removeItem('currentOrgId');
  console.log('[Auth] Logged out');
}

/**
 * Switch to a different organization
 */
function switchOrganization(orgId: string) {
  console.log('[Auth] Switching to organization:', orgId);
  
  // Verify the org is in the user's list
  const org = organizations.value.find(o => o.id === orgId);
  if (!org && !isSuperadmin.value) {
    console.error('[Auth] Cannot switch to org:', orgId, '- not in user organizations');
    return;
  }
  
  currentOrgId.value = orgId;
  localStorage.setItem('currentOrgId', orgId);
  
  // Update session with new current org
  if (session.value) {
    const updatedSession: Session = {
      ...session.value,
      currentOrganizationId: orgId
    };
    session.value = updatedSession;
    localStorage.setItem('session', JSON.stringify(updatedSession));
  }
  
  console.log('[Auth] Switched to org:', orgId, 'role:', org?.role || 'superadmin');
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
  // Multi-org support
  organizations,
  currentOrganization,
  currentOrgId,
  switchOrganization,
  // Actions
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
  return session.value?.token || null;
}

/**
 * Get current organization ID for API requests
 */
export function getCurrentOrgId(): string | null {
  return currentOrgId.value;
}
