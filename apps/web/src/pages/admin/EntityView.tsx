/**
 * Entity View Page
 * 
 * Displays an entity as a polished, published content page.
 * Content is organized by sections with clean typography.
 * No technical metadata (ID, slug, version) is shown.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { useEntity } from '../../hooks/useDB';
import { useSync } from '../../stores/sync';
import { getEntityWithTypeId } from '../../stores/db';
import type { Entity, EntityType, FieldDefinition, FieldSection } from '@1cc/shared';

interface EntityViewProps {
  orgSlug?: string;
  id?: string;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Get status display info (color and label)
 */
function getStatusDisplay(status: string): { color: string; label: string } {
  switch (status) {
    case 'published':
      return { color: 'bg-green-500', label: 'Published' };
    case 'draft':
      return { color: 'bg-amber-500', label: 'Draft' };
    case 'pending_approval':
      return { color: 'bg-blue-500', label: 'Pending Approval' };
    case 'archived':
      return { color: 'bg-surface-400', label: 'Archived' };
    default:
      return { color: 'bg-surface-400', label: status };
  }
}

/**
 * Render field value based on type - clean, readable format
 */
function FieldValue({ value, fieldType }: { value: unknown; fieldType?: string }) {
  // Don't show empty values
  if (value === null || value === undefined || value === '') {
    return <span class="text-surface-400 italic">—</span>;
  }
  
  // Boolean fields
  if (typeof value === 'boolean') {
    return value ? (
      <span class="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
        <span class="i-lucide-check-circle text-base"></span>
        Yes
      </span>
    ) : (
      <span class="inline-flex items-center gap-1.5 text-surface-500">
        <span class="i-lucide-x-circle text-base"></span>
        No
      </span>
    );
  }
  
  // Array values (multiselect, etc.)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span class="text-surface-400 italic">—</span>;
    }
    return (
      <div class="flex flex-wrap gap-2">
        {value.map((item, i) => (
          <span 
            key={i} 
            class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
          >
            {String(item)}
          </span>
        ))}
      </div>
    );
  }
  
  // Markdown content
  if (fieldType === 'markdown' && typeof value === 'string') {
    return (
      <div class="prose prose-surface dark:prose-invert max-w-none">
        {value}
      </div>
    );
  }
  
  // URLs - make them clickable
  if (typeof value === 'string' && value.startsWith('http')) {
    return (
      <a 
        href={value} 
        target="_blank" 
        rel="noopener noreferrer" 
        class="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
      >
        {value}
        <span class="i-lucide-external-link text-sm"></span>
      </a>
    );
  }
  
  // Default text display
  return <span class="text-surface-900 dark:text-surface-100">{String(value)}</span>;
}

export function EntityView({ orgSlug, id }: EntityViewProps) {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, currentOrganization, organizations, session, refreshToken } = useAuth();
  const { sync } = useSync();
  
  // Try to load entity from TanStack DB first
  const { data: bundleEntity, loading: dbLoading, error: dbError } = useEntity(id);
  
  // State for tracking org refresh - prevents infinite loop
  const [orgRefreshAttempted, setOrgRefreshAttempted] = useState(false);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  
  // Helper to get organization ID (resolve slug to ID if needed)
  const getOrgId = (): string | null => {
    // If orgSlug is provided, find organization by slug
    if (orgSlug) {
      const org = organizations.value.find(o => o.slug === orgSlug || o.id === orgSlug);
      if (org) {
        console.log('[EntityView] Found org by slug:', orgSlug, '->', org.id, org);
        return org.id;
      }
      console.warn('[EntityView] Organization not found by slug:', orgSlug, 'available orgs:', organizations.value.map(o => ({ id: o.id, slug: o.slug })));
      return null;
    }
    // Otherwise use current organization ID
    const orgId = currentOrganization.value?.id || null;
    if (orgId) {
      console.log('[EntityView] Using current organization ID:', orgId);
    }
    return orgId;
  };
  
  const [entity, setEntity] = useState<Entity | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entityOrgName, setEntityOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingFromDB, setLoadingFromDB] = useState(false);
  
  // Compute effective org ID for links - use resolvedOrgId, orgSlug, or current org
  const effectiveOrgId = resolvedOrgId || orgSlug || currentOrganization.value?.id || '';
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      console.log('[EntityView] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load entity directly with a known org ID (used after org refresh)
  async function loadEntityDirectly(orgId: string) {
    if (!id) return;
    
    console.log('[EntityView] loadEntityDirectly called with orgId:', orgId);
    setLoading(true);
    setResolvedOrgId(orgId);
    
    try {
      // First try organization-scoped route: /api/orgs/:orgId/entities/:id
      let response = await api.get(`/api/orgs/${orgId}/entities/${id}`) as {
        success: boolean;
        data?: Entity;
        error?: { code: string };
      };
      
      // If org-scoped fails with 404, try the generic entities endpoint (for global/platform entities)
      if (!response.success && response.error?.code === 'NOT_FOUND') {
        console.log('[EntityView] Entity not found in org directly, trying generic endpoint...');
        response = await api.get(`/api/entities/${id}`) as {
          success: boolean;
          data?: Entity;
          error?: { code: string };
        };
      }
      
      if (response.success && response.data) {
        const loadedEntity = response.data;
        setEntity(loadedEntity);
        console.log('[EntityView] Entity loaded directly:', loadedEntity.id, 'organizationId:', loadedEntity.organizationId);
        
        // Load entity type
        const typeResponse = await api.get(`/api/entity-types/${loadedEntity.entityTypeId}`) as {
          success: boolean;
          data?: EntityType;
        };
        
        if (typeResponse.success && typeResponse.data) {
          setEntityType(typeResponse.data);
        }
        
        // Load organization name if entity has an organization
        if (loadedEntity.organizationId) {
          loadOrganizationName(loadedEntity.organizationId);
        } else {
          setEntityOrgName(null);
        }
      } else {
        console.error('[EntityView] Failed to load entity directly:', response);
        route('/admin');
      }
    } catch (err) {
      console.error('[EntityView] Error loading entity directly:', err);
      route('/admin');
    } finally {
      setLoading(false);
    }
  }
  
  // Try to load entity from TanStack DB first
  useEffect(() => {
    if (!id || dbLoading || !bundleEntity) return;
    
    console.log('[EntityView] Entity found in TanStack DB, loading typeId and converting to Entity format...');
    setLoadingFromDB(true);
    
    // Get typeId from DB (bundleEntity already has the entity data, just need typeId)
    getEntityWithTypeId(id).then(async (result) => {
      if (!result) {
        console.log('[EntityView] Entity not found in DB with typeId, falling back to API');
        setLoadingFromDB(false);
        return;
      }
      
      const { entity: dbEntity, typeId } = result;
      
      // Use bundleEntity from hook (already loaded) instead of result.entity
      const dbEntityToUse = bundleEntity;
      
      // Convert BundleEntity to Entity format
      // We need to get version, createdAt, organizationId from API, but try DB first
      // For now, use defaults and let API fill in if needed
      const convertedEntity: Entity = {
        id: dbEntityToUse.id,
        entityTypeId: typeId,
        organizationId: null, // Will be loaded from API if needed
        version: 1, // Default, will be updated if API call succeeds
        status: dbEntityToUse.status,
        visibility: 'public' as any, // Default
        name: dbEntityToUse.name,
        slug: dbEntityToUse.slug,
        data: dbEntityToUse.data,
        createdAt: dbEntityToUse.updatedAt, // Use updatedAt as fallback
        updatedAt: dbEntityToUse.updatedAt,
      };
      
      setEntity(convertedEntity);
      
      // Load entity type definition (always from API since DB doesn't have full definition)
      const typeResponse = await api.get(`/api/entity-types/${typeId}`) as {
        success: boolean;
        data?: EntityType;
      };
      
      if (typeResponse.success && typeResponse.data) {
        setEntityType(typeResponse.data);
      }
      
      // Try to get full entity from API to get version, createdAt, organizationId
      // But don't fail if it doesn't work - we have the basic data from DB
      const orgId = resolvedOrgId || getOrgId();
      if (orgId) {
        try {
          const fullEntityResponse = await api.get(`/api/orgs/${orgId}/entities/${id}`) as {
            success: boolean;
            data?: Entity;
            error?: { code: string };
          };
          
          if (fullEntityResponse.success && fullEntityResponse.data) {
            // Update with full entity data
            setEntity(fullEntityResponse.data);
            if (fullEntityResponse.data.organizationId) {
              loadOrganizationName(fullEntityResponse.data.organizationId);
            } else {
              setEntityOrgName(null);
            }
          } else if (!fullEntityResponse.success && fullEntityResponse.error?.code === 'NOT_FOUND') {
            // Try generic endpoint
            const genericResponse = await api.get(`/api/entities/${id}`) as {
              success: boolean;
              data?: Entity;
            };
            if (genericResponse.success && genericResponse.data) {
              setEntity(genericResponse.data);
              if (genericResponse.data.organizationId) {
                loadOrganizationName(genericResponse.data.organizationId);
              } else {
                setEntityOrgName(null);
              }
            }
          }
        } catch (err) {
          console.warn('[EntityView] Could not load full entity from API, using DB data:', err);
        }
      }
      
      setLoadingFromDB(false);
      setLoading(false);
    }).catch((err) => {
      console.error('[EntityView] Error loading entity from DB:', err);
      setLoadingFromDB(false);
      // Fall through to API loading
    });
  }, [id, bundleEntity, dbLoading, resolvedOrgId]);
  
  // Load entity and entity type - wait for auth and organizations to be loaded
  // Only load from API if not found in DB
  useEffect(() => {
    const sessionOrgs = session.value?.user?.organizations || [];
    console.log('[EntityView] useEffect triggered', {
      authLoading: authLoading.value,
      isOrgAdmin: isOrgAdmin.value,
      id,
      orgSlug,
      organizationsCount: organizations.value.length,
      sessionOrgsCount: sessionOrgs.length,
      orgRefreshAttempted,
      resolvedOrgId,
      bundleEntity: !!bundleEntity,
      dbLoading,
      loadingFromDB
    });
    
    // Wait for auth to finish loading
    if (authLoading.value) {
      console.log('[EntityView] Auth still loading, waiting...');
      return;
    }
    
    if (!isOrgAdmin.value || !id) {
      console.log('[EntityView] Not ready:', { isOrgAdmin: isOrgAdmin.value, id });
      return;
    }
    
    // If entity is loading from DB, wait
    if (loadingFromDB || (dbLoading && !dbError)) {
      console.log('[EntityView] Loading from DB, waiting...');
      return;
    }
    
    // If entity was found in DB, don't load from API
    if (bundleEntity && entity) {
      console.log('[EntityView] Entity already loaded from DB');
      return;
    }
    
    // If we already have a resolved org ID, use it
    if (resolvedOrgId) {
      console.log('[EntityView] Using already resolved org ID:', resolvedOrgId);
      loadEntity();
      return;
    }
    
    // Try to get org ID - check both organizations.value and session directly
    let orgId = getOrgId();
    
    // If not found in organizations.value, try session directly
    if (orgSlug && !orgId && sessionOrgs.length > 0) {
      const org = sessionOrgs.find(o => o.slug === orgSlug || o.id === orgSlug);
      if (org) {
        console.log('[EntityView] Found org in session:', orgSlug, '->', org.id);
        orgId = org.id;
        setResolvedOrgId(org.id);
      }
    }
    
    if (orgSlug && !orgId) {
      // Only attempt refresh once to prevent infinite loop
      if (orgRefreshAttempted) {
        console.error('[EntityView] Organization refresh already attempted, giving up', { orgSlug });
        setLoading(false);
        return;
      }
      
      if (organizations.value.length === 0 && sessionOrgs.length === 0) {
        console.log('[EntityView] Organizations not loaded, fetching user info to refresh session...');
        setOrgRefreshAttempted(true); // Mark that we've attempted refresh
        
        // Fetch user info and update session - this will trigger organizations to update
        api.get('/api/user/me').then(async (userResponse: any) => {
          if (userResponse.success && userResponse.data?.organizations) {
            console.log('[EntityView] Fetched organizations:', userResponse.data.organizations.length, userResponse.data.organizations);
            // Update session directly - this will trigger the organizations computed to update
            const currentSession = session.value;
            if (currentSession) {
              // Update the session signal directly - this will trigger organizations computed to update
              session.value = {
                ...currentSession,
                user: {
                  ...currentSession.user,
                  organizations: userResponse.data.organizations,
                  isSuperadmin: userResponse.data.isSuperadmin
                }
              };
              // Also update localStorage
              localStorage.setItem('session', JSON.stringify(session.value));
              
              // Find the org and load entity directly with the org ID
              const org = userResponse.data.organizations.find((o: any) => o.slug === orgSlug || o.id === orgSlug);
              if (org) {
                console.log('[EntityView] Found org after refresh:', orgSlug, '->', org.id);
                // Load entity directly with the org ID we just fetched
                loadEntityDirectly(org.id);
              } else {
                console.error('[EntityView] Organization not found in fetched list', {
                  orgSlug,
                  fetchedOrgs: userResponse.data.organizations.map((o: any) => ({ id: o.id, slug: o.slug }))
                });
                setLoading(false);
              }
            }
          } else {
            console.error('[EntityView] Failed to fetch user info:', userResponse);
            setLoading(false);
          }
        }).catch((err: any) => {
          console.error('[EntityView] Error fetching user info:', err);
          setLoading(false);
        });
        return;
      } else {
        // Organizations are loaded but slug not found - this is an error
        console.error('[EntityView] Organization slug not found', {
          orgSlug,
          availableOrgs: organizations.value.map(o => ({ id: o.id, slug: o.slug, name: o.name })),
          sessionOrgs: sessionOrgs.map(o => ({ id: o.id, slug: o.slug, name: o.name }))
        });
        // Don't return - let it try to load anyway, API will return proper error
      }
    }
    
    // If we found an orgId, save it
    if (orgId && !resolvedOrgId) {
      setResolvedOrgId(orgId);
    }
    
    // All conditions met, load the entity from API (fallback if not in DB)
    console.log('[EntityView] All conditions met, loading entity from API...', { orgId });
    loadEntity();
  }, [authLoading.value, isOrgAdmin.value, id, orgSlug, organizations.value.length, orgRefreshAttempted, resolvedOrgId, bundleEntity, dbLoading, dbError, loadingFromDB, entity]);
  
  async function loadEntity() {
    if (!id) return;
    
    setLoading(true);
    
    // Get organization ID - use resolved ID first, then try to resolve from slug
    let orgId = resolvedOrgId || getOrgId();
    
    if (!orgId) {
      console.error('[EntityView] No organization ID available', { orgSlug, resolvedOrgId, currentOrganization: currentOrganization.value, organizations: organizations.value });
      setLoading(false);
      route('/admin');
      return;
    }
    
    // Save resolved org ID for future use
    if (!resolvedOrgId && orgId) {
      setResolvedOrgId(orgId);
    }
    
    console.log('[EntityView] Loading entity:', id, 'for org:', orgId);
    
    try {
      // First try organization-scoped route: /api/orgs/:orgId/entities/:id
      let response = await api.get(`/api/orgs/${orgId}/entities/${id}`) as {
        success: boolean;
        data?: Entity;
        error?: { code: string };
      };
      
      // If org-scoped fails with 404, try the generic entities endpoint (for global/platform entities)
      if (!response.success && response.error?.code === 'NOT_FOUND') {
        console.log('[EntityView] Entity not found in org, trying generic endpoint...');
        response = await api.get(`/api/entities/${id}`) as {
          success: boolean;
          data?: Entity;
          error?: { code: string };
        };
      }
      
      if (response.success && response.data) {
        const loadedEntity = response.data;
        setEntity(loadedEntity);
        console.log('[EntityView] Entity loaded:', loadedEntity.id, 'organizationId:', loadedEntity.organizationId);
        
        // Load entity type
        const typeResponse = await api.get(`/api/entity-types/${loadedEntity.entityTypeId}`) as {
          success: boolean;
          data?: EntityType;
        };
        
        if (typeResponse.success && typeResponse.data) {
          setEntityType(typeResponse.data);
        }
        
        // Load organization name if entity has an organization
        if (loadedEntity.organizationId) {
          loadOrganizationName(loadedEntity.organizationId);
        } else {
          setEntityOrgName(null);
        }
      } else {
        console.error('[EntityView] Failed to load entity:', response);
        route('/admin');
      }
    } catch (err) {
      console.error('[EntityView] Error loading entity:', err);
      route('/admin');
    } finally {
      setLoading(false);
    }
  }
  
  async function loadOrganizationName(orgId: string) {
    try {
      const response = await api.get(`/api/organizations/${orgId}`) as {
        success: boolean;
        data?: { name: string; id: string };
      };
      
      if (response.success && response.data) {
        setEntityOrgName(response.data.name);
        console.log('[EntityView] Loaded organization name:', response.data.name);
      } else {
        setEntityOrgName(null);
      }
    } catch (err) {
      console.error('[EntityView] Error loading organization name:', err);
      setEntityOrgName(null);
    }
  }
  
  // Loading state
  if (authLoading.value || loading || (dbLoading && !bundleEntity) || loadingFromDB) {
    return (
      <div class="container-default py-12">
        <div class="max-w-4xl mx-auto">
          <div class="skeleton h-6 w-32 mb-4"></div>
          <div class="skeleton h-12 w-3/4 mb-4"></div>
          <div class="skeleton h-5 w-24 mb-8"></div>
          <div class="skeleton h-32 w-full mb-6"></div>
          <div class="skeleton h-48 w-full"></div>
        </div>
      </div>
    );
  }
  
  if (!entity || !entityType) {
    return null;
  }
  
  // Find the name field - first by ID, then by display name
  const findFieldByNameOrId = (names: string[]) => {
    const lowercaseNames = names.map(n => n.toLowerCase());
    // First try to find by field ID
    let field = entityType.fields.find(f => lowercaseNames.includes(f.id.toLowerCase()));
    // If not found, try to find by display name
    if (!field) {
      field = entityType.fields.find(f => lowercaseNames.includes(f.name.toLowerCase()));
    }
    return field;
  };
  
  // Find name and description fields
  const nameField = findFieldByNameOrId(['name', 'title']);
  const descriptionField = findFieldByNameOrId(['description', 'desc']);
  const slugField = findFieldByNameOrId(['slug', 'url-slug']);
  
  // Name is stored at top-level (common property)
  const name = entity.name || 'Untitled';
  const description = descriptionField ? (entity.data[descriptionField.id] as string) || '' : '';
  
  const statusDisplay = getStatusDisplay(entity.status);
  const orgDisplay = entity.organizationId === null 
    ? 'Global' 
    : (entityOrgName || 'Organization');
  
  // Technical fields to exclude from section display - using actual field objects
  const technicalFieldIds = new Set(
    [nameField?.id, descriptionField?.id, slugField?.id].filter(Boolean) as string[]
  );
  const isTechnicalField = (fieldId: string) => technicalFieldIds.has(fieldId);
  
  // Debug: Log entity data keys for troubleshooting field mapping
  console.log('[EntityView] Entity data keys:', Object.keys(entity.data));
  console.log('[EntityView] Name field:', nameField?.id, '→', name);
  console.log('[EntityView] Technical fields to hide:', Array.from(technicalFieldIds));
  const sections = [...(entityType.sections || [])].sort((a, b) => a.displayOrder - b.displayOrder);
  
  // Build a map of fields by section
  const fieldsBySection = new Map<string, FieldDefinition[]>();
  sections.forEach(section => {
    fieldsBySection.set(section.id, []);
  });
  
  // Add a default section if needed
  if (!fieldsBySection.has('default')) {
    fieldsBySection.set('default', []);
  }
  
  // Populate fields into sections (excluding technical fields)
  entityType.fields
    .filter(f => !isTechnicalField(f.id))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .forEach(field => {
      const sectionId = field.sectionId || 'default';
      const sectionFields = fieldsBySection.get(sectionId) || [];
      sectionFields.push(field);
      fieldsBySection.set(sectionId, sectionFields);
    });
  
  // Filter out empty sections
  const nonEmptySections = sections.filter(section => {
    const fields = fieldsBySection.get(section.id) || [];
    return fields.length > 0;
  });
  
  // Check for default section fields
  const defaultFields = fieldsBySection.get('default') || [];
  
  return (
    <div class="container-default py-8">
      <div class="max-w-4xl mx-auto">
        {/* Top Navigation */}
        <div class="flex items-center justify-between mb-8">
          <a 
            href={`/admin/${effectiveOrgId}/entity-types/${entityType.id}`}
            class="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
          >
            <span class="i-lucide-arrow-left"></span>
            <span>Back to {entityType.pluralName}</span>
          </a>
          
          <a 
            href={`/admin/${effectiveOrgId}/entities/${id}/edit`}
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 rounded-lg transition-colors"
          >
            <span class="i-lucide-edit text-base"></span>
            Edit
          </a>
        </div>
        
        {/* Hero Header */}
        <header class="mb-10">
          {/* Organization Label */}
          <div class="text-primary-600 dark:text-primary-400 font-semibold text-sm uppercase tracking-wide mb-3">
            {orgDisplay}
          </div>
          
          {/* Title */}
          <h1 class="text-4xl font-bold text-surface-900 dark:text-surface-100 mb-4">
            {name}
          </h1>
          
          {/* Status Indicator */}
          <div class="flex items-center gap-2 text-surface-600 dark:text-surface-400">
            <span class={`w-2 h-2 rounded-full ${statusDisplay.color}`}></span>
            <span>{statusDisplay.label}</span>
          </div>
        </header>
        
        {/* Description Block */}
        {description && (
          <div class="mb-8">
            <div class="prose prose-lg prose-surface dark:prose-invert max-w-none">
              <p class="text-surface-700 dark:text-surface-300 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
        )}
        
        {/* Section Cards */}
        <div class="space-y-6">
          {nonEmptySections.map(section => {
            const fields = fieldsBySection.get(section.id) || [];
            if (fields.length === 0) return null;
            
            return (
              <div key={section.id} class="card p-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-3 border-b border-surface-200 dark:border-surface-700">
                  {section.name}
                </h2>
                
                <dl class="space-y-5">
                  {fields.map(field => {
                    const value = entity.data[field.id];
                    return (
                      <div key={field.id}>
                        <dt class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1.5">
                          {field.name}
                        </dt>
                        <dd class="text-surface-900 dark:text-surface-100">
                          <FieldValue value={value} fieldType={field.type} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            );
          })}
          
          {/* Default section for uncategorized fields */}
          {defaultFields.length > 0 && (
            <div class="card p-6">
              <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-3 border-b border-surface-200 dark:border-surface-700">
                Details
              </h2>
              
              <dl class="space-y-5">
                {defaultFields.map(field => {
                  const value = entity.data[field.id];
                  return (
                    <div key={field.id}>
                      <dt class="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1.5">
                        {field.name}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">
                        <FieldValue value={value} fieldType={field.type} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <footer class="mt-10 pt-6 border-t border-surface-200 dark:border-surface-700">
          <p class="text-sm text-surface-500 dark:text-surface-400">
            Last updated {formatDate(entity.updatedAt)}
          </p>
        </footer>
      </div>
    </div>
  );
}
