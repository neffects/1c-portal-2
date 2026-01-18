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
import { MembershipKeys } from './pages/superadmin/MembershipKeys';
import { EntityImportExport } from './pages/superadmin/EntityImportExport';
import { BundleManagement } from './pages/superadmin/BundleManagement';
import { SuperEntitiesList } from './pages/superadmin/SuperEntitiesList';
import { SuperEntityTypeView } from './pages/superadmin/SuperEntityTypeView';
import { SuperEntityView } from './pages/superadmin/SuperEntityView';
import { SuperEntityEditor } from './pages/superadmin/SuperEntityEditor';

// Auth and state
import { AuthProvider } from './stores/auth';
import { SyncProvider } from './stores/sync';
import { QueryClientProvider } from '@preact-signals/query';
import { getQueryClient } from './stores/query-sync';

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
  
  // Branding is now loaded automatically via manifest config in sync store
  
  // Get or create QueryClient for TanStack Query
  const queryClient = getQueryClient();
  
  return (
    <QueryClientProvider client={queryClient}>
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
            
            {/* Browse routes - for browsing entities by type */}
            <Route path="/browse/:typeSlug/:entitySlug" component={EntityDetailPage} />
            <Route path="/browse/:typeSlug" component={BrowsePage} />
            
            {/* Admin routes */}
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/:orgSlug/entities" component={EntitiesList} />
            <Route path="/admin/:orgSlug/entity-types/:typeId" component={EntityTypeView} />
            <Route path="/admin/:orgSlug/entities/new/:typeId" component={EntityEditor} />
            <Route path="/admin/:orgSlug/entities/new" component={EntityEditor} />
            <Route path="/admin/:orgSlug/entities/:id/edit" component={EntityEditor} />
            <Route path="/admin/:orgSlug/entities/:id" component={EntityView} />
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
            <Route path="/super/membership-keys" component={MembershipKeys} />
            <Route path="/super/import-export" component={EntityImportExport} />
            <Route path="/super/bundles" component={BundleManagement} />
            <Route path="/super/entities" component={SuperEntitiesList} />
            <Route path="/super/entity-types/:typeId" component={SuperEntityTypeView} />
            <Route path="/super/entities/new" component={SuperEntityEditor} />
            <Route path="/super/entities/new/:typeId" component={SuperEntityEditor} />
            <Route path="/super/entities/:id/edit" component={SuperEntityEditor} />
            <Route path="/super/entities/:id" component={SuperEntityView} />
            
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
    </QueryClientProvider>
  );
}
