/**
 * Main Application Component
 * 
 * Sets up routing and global state providers
 */

import { Router, Route } from 'preact-router';
import { useEffect } from 'preact/hooks';

// Layout
import { Layout } from './components/Layout';

// Pages
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { AuthCallbackPage } from './pages/AuthCallback';
import { BrowsePage } from './pages/Browse';
import { EntityDetailPage } from './pages/EntityDetail';
import { AlertsPage } from './pages/Alerts';
import { NotFoundPage } from './pages/NotFound';

// Admin Pages (lazy loaded in production)
import { AdminDashboard } from './pages/admin/Dashboard';
import { EntityEditor } from './pages/admin/EntityEditor';
import { UserManagement } from './pages/admin/UserManagement';

// Superadmin Pages (lazy loaded in production)
import { SuperadminDashboard } from './pages/superadmin/Dashboard';
import { TypeManager } from './pages/superadmin/TypeManager';
import { TypeBuilder } from './pages/superadmin/TypeBuilder';
import { OrgManager } from './pages/superadmin/OrgManager';
import { OrgWizard } from './pages/superadmin/OrgWizard';
import { ApprovalQueue } from './pages/superadmin/ApprovalQueue';

// Auth and state
import { AuthProvider } from './stores/auth';
import { SyncProvider } from './stores/sync';

/**
 * Main App component with routing
 */
export function App() {
  // Initialize dark mode from system preference
  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
    
    console.log('[App] Theme initialized:', savedTheme || (prefersDark ? 'dark' : 'light'));
  }, []);
  
  return (
    <AuthProvider>
      <SyncProvider>
        <Layout>
          <Router>
            {/* Public routes */}
            <Route path="/" component={HomePage} />
            <Route path="/login" component={LoginPage} />
            <Route path="/auth/callback" component={AuthCallbackPage} />
            <Route path="/browse/:typeSlug" component={BrowsePage} />
            <Route path="/browse/:typeSlug/:entitySlug" component={EntityDetailPage} />
            
            {/* Authenticated routes */}
            <Route path="/alerts" component={AlertsPage} />
            
            {/* Admin routes */}
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/entities/new/:typeId" component={EntityEditor} />
            <Route path="/admin/entities/:id/edit" component={EntityEditor} />
            <Route path="/admin/users" component={UserManagement} />
            
            {/* Superadmin routes */}
            <Route path="/super" component={SuperadminDashboard} />
            <Route path="/super/types" component={TypeManager} />
            <Route path="/super/types/new" component={TypeBuilder} />
            <Route path="/super/types/:id/edit" component={TypeBuilder} />
            <Route path="/super/orgs" component={OrgManager} />
            <Route path="/super/orgs/new" component={OrgWizard} />
            <Route path="/super/approvals" component={ApprovalQueue} />
            
            {/* 404 fallback */}
            <Route default component={NotFoundPage} />
          </Router>
        </Layout>
      </SyncProvider>
    </AuthProvider>
  );
}
