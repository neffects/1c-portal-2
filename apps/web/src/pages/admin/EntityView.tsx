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
import type { Entity, EntityType, FieldDefinition, FieldSection } from '@1cc/shared';

interface EntityViewProps {
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

export function EntityView({ id }: EntityViewProps) {
  const { isAuthenticated, isOrgAdmin, loading: authLoading } = useAuth();
  
  const [entity, setEntity] = useState<Entity | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entityOrgName, setEntityOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Redirect if not admin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      console.log('[EntityView] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load entity and entity type
  useEffect(() => {
    if (isOrgAdmin.value && id) {
      loadEntity();
    }
  }, [isOrgAdmin.value, id]);
  
  async function loadEntity() {
    if (!id) return;
    
    setLoading(true);
    console.log('[EntityView] Loading entity:', id);
    
    try {
      const response = await api.get(`/api/entities/${id}`) as {
        success: boolean;
        data?: Entity;
      };
      
      if (response.success && response.data) {
        const loadedEntity = response.data;
        setEntity(loadedEntity);
        
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
  if (authLoading.value || loading) {
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
  
  // Get values using the actual field IDs
  const name = nameField ? (entity.data[nameField.id] as string) || 'Untitled' : 'Untitled';
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
            href={`/admin/entity-types/${entityType.id}`}
            class="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
          >
            <span class="i-lucide-arrow-left"></span>
            <span>Back to {entityType.pluralName}</span>
          </a>
          
          <a 
            href={`/admin/entities/${id}/edit`}
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
