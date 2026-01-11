/**
 * Main Application Component
 * 
 * Sets up routing and global state providers
 */

import { Router, Route } from 'preact-router';
import { useEffect } from 'preact/hooks';
import { loadBranding } from './stores/branding';

// Layout
import { Layout } from './components/Layout';

// Pages
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { AuthCallbackPage } from './pages/AuthCallback';
import { BrowsePage } from './pages/Browse';
import { EntityDetailPage } from './pages/EntityDetail';
import { OrgHomePage } from './pages/OrgHomePage';
import { TypeListingPage } from './pages/TypeListingPage';
import { AlertsPage } from './pages/Alerts';
import { NotFoundPage } from './pages/NotFound';

// Admin Pages (lazy loaded in production)
import { AdminDashboard } from './pages/admin/Dashboard';
import { EntitiesList } from './pages/admin/EntitiesList';
import { EntityTypeView } from './pages/admin/EntityTypeView';
import { EntityView } from './pages/admin/EntityView';
import { EntityEditor } from './pages/admin/EntityEditor';
import { UserManagement } from './pages/admin/UserManagement';

// Superadmin Pages (lazy loaded in production)
import { SuperadminDashboard } from './pages/superadmin/Dashboard';
import { TypeManager } from './pages/superadmin/TypeManager';
import { TypeBuilder } from './pages/superadmin/TypeBuilder';
import { OrgManager } from './pages/superadmin/OrgManager';
import { OrgWizard } from './pages/superadmin/OrgWizard';
import { ApprovalQueue } from './pages/superadmin/ApprovalQueue';
import { Branding } from './pages/superadmin/Branding';
import { EntityImportExport } from './pages/superadmin/EntityImportExport';

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
  
  // Load branding configuration
  useEffect(() => {
    loadBranding();
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
            
            {/* Authenticated routes */}
            <Route path="/alerts" component={AlertsPage} />
            
            {/* Admin routes */}
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/entities" component={EntitiesList} />
            <Route path="/admin/entity-types/:typeId" component={EntityTypeView} />
            <Route path="/admin/entities/new/:typeId" component={EntityEditor} />
            <Route path="/admin/entities/new" component={EntityEditor} />
            <Route path="/admin/entities/:id/edit" component={EntityEditor} />
            <Route path="/admin/entities/:id" component={EntityView} />
            <Route path="/admin/users" component={UserManagement} />
            
            {/* Superadmin routes */}
            <Route path="/super" component={SuperadminDashboard} />
            <Route path="/super/types" component={TypeManager} />
            <Route path="/super/types/new" component={TypeBuilder} />
            <Route path="/super/types/:id/edit" component={TypeBuilder} />
            <Route path="/super/orgs" component={OrgManager} />
            <Route path="/super/orgs/new" component={OrgWizard} />
            <Route path="/super/approvals" component={ApprovalQueue} />
            <Route path="/super/branding" component={Branding} />
            <Route path="/super/import-export" component={EntityImportExport} />
            
            {/* Deep link routes - MUST be last to avoid catching other routes */}
            <Route path="/:orgSlug/:typeSlug/:entitySlug" component={EntityDetailPage} />
            <Route path="/:orgSlug/:typeSlug" component={TypeListingPage} />
            <Route path="/:orgSlug" component={OrgHomePage} />
            
            {/* 404 fallback */}
            <Route default component={NotFoundPage} />
          </Router>
        </Layout>
      </SyncProvider>
    </AuthProvider>
  );
}
