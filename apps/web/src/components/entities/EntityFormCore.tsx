/**
 * EntityFormCore Component
 * 
 * Shared component for entity creation/editing forms.
 * Used by both admin and superadmin entity editor pages.
 */

import { FieldRenderer } from '../fields';
import type { Entity, EntityType, FieldDefinition, OrganizationListItem } from '@1cc/shared';

export interface EntityFormCoreProps {
  /** Base path for navigation links (/admin or /super) */
  basePath: string;
  /** Entity being edited (null for new entities) */
  entity: Entity | null;
  /** Entity type definition */
  entityType: EntityType;
  /** Form data state */
  formData: Record<string, unknown>;
  /** Form validation errors */
  errors: Record<string, string>;
  /** Whether this is a new entity */
  isNew: boolean;
  /** Whether the form is saving */
  saving: boolean;
  /** Whether the form has unsaved changes */
  isDirty: boolean;
  /** Save error message */
  saveError: string | null;
  /** Callback when a field value changes */
  onFieldChange: (fieldId: string, value: unknown) => void;
  /** Callback to save the entity */
  onSave: () => void;
  /** Callback to submit for approval */
  onSubmitForApproval?: () => void;
  /** Whether to show organization selector (superadmin creating/editing) */
  showOrgSelector?: boolean;
  /** Selected organization ID (null = global, undefined = use default) */
  selectedOrgId?: string | null;
  /** Callback when organization selection changes */
  onOrgChange?: (orgId: string | null) => void;
  /** Available organizations */
  organizations?: OrganizationListItem[];
  /** Whether organizations are loading */
  loadingOrgs?: boolean;
  /** Organization name for display (when editing existing entity) */
  entityOrgName?: string | null;
  /** Whether the slug field helper should be shown */
  showSlugHelper?: boolean;
  /** Current user's organization name (for display) */
  userOrgName?: string;
}

export function EntityFormCore({
  basePath,
  entity,
  entityType,
  formData,
  errors,
  isNew,
  saving,
  isDirty,
  saveError,
  onFieldChange,
  onSave,
  onSubmitForApproval,
  showOrgSelector = false,
  selectedOrgId,
  onOrgChange,
  organizations = [],
  loadingOrgs = false,
  entityOrgName,
  showSlugHelper = false,
  userOrgName,
}: EntityFormCoreProps) {
  // Group fields by section
  const sections = entityType.sections || [{ id: 'default', name: 'Fields', displayOrder: 0 }];
  const fieldsBySection = new Map<string, FieldDefinition[]>();
  
  sections.forEach(section => {
    fieldsBySection.set(section.id, []);
  });
  
  entityType.fields.forEach(field => {
    const sectionId = field.sectionId || 'default';
    const sectionFields = fieldsBySection.get(sectionId) || [];
    sectionFields.push(field);
    fieldsBySection.set(sectionId, sectionFields);
  });

  // Get org display text
  const getOrgDisplayText = () => {
    if (isNew) {
      if (selectedOrgId === null) {
        return <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>;
      }
      const org = organizations.find(o => o.id === selectedOrgId);
      return org?.name || userOrgName || 'Your Organization';
    } else {
      if (entity?.organizationId === null) {
        return <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>;
      }
      return entityOrgName || userOrgName || entity?.organizationId || 'Organization';
    }
  };

  return (
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Main form */}
      <div class="lg:col-span-2 space-y-6">
        {sections.map(section => {
          const sectionFields = fieldsBySection.get(section.id) || [];
          if (sectionFields.length === 0) return null;
          
          return (
            <div key={section.id} class="card p-6">
              <h2 class="heading-4 mb-6">{section.name}</h2>
              
              <div class="space-y-6">
                {sectionFields
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map(field => {
                    // Special handling for slug field - show helper text for auto-generation
                    const isSlugField = field.id === 'slug';
                    const shouldShowSlugHelper = isNew && isSlugField && showSlugHelper;
                    
                    return (
                      <div key={field.id}>
                        <FieldRenderer
                          field={field}
                          value={formData[field.id]}
                          onChange={(value) => onFieldChange(field.id, value)}
                          error={errors[field.id]}
                          disabled={entity?.status !== 'draft' && !!entity}
                        />
                        {shouldShowSlugHelper && (
                          <p class="text-xs text-surface-500 mt-1 flex items-center gap-1">
                            <span class="i-lucide-info"></span>
                            Auto-generated from name (you can edit if needed)
                          </p>
                        )}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Sidebar */}
      <div class="lg:col-span-1 space-y-6">
        {/* Organization selector/display */}
        {isNew && showOrgSelector ? (
          <div class="card p-6">
            <h3 class="heading-4 mb-4">Organization</h3>
            {loadingOrgs ? (
              <div class="flex items-center justify-center py-4">
                <span class="i-lucide-loader-2 animate-spin text-xl text-primary-500"></span>
              </div>
            ) : (
              <select
                value={selectedOrgId === null ? 'global' : (selectedOrgId || '')}
                onChange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  onOrgChange?.(value === 'global' ? null : value);
                }}
                class="input w-full"
                disabled={saving}
              >
                <option value="global">Global (Platform-wide)</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}
            <p class="text-sm text-surface-500 mt-2">
              Select the organization this entity belongs to, or choose Global for platform-wide entities
            </p>
          </div>
        ) : (
          <div class="card p-6">
            <h3 class="heading-4 mb-4">Organization</h3>
            <div class="text-surface-900 dark:text-surface-100">
              {getOrgDisplayText()}
            </div>
            <p class="text-sm text-surface-500 mt-2">
              The organization this entity belongs to
            </p>
          </div>
        )}
        
        {/* Metadata */}
        {entity && (
          <div class="card p-6">
            <h3 class="heading-4 mb-4">Metadata</h3>
            
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-surface-500">ID</dt>
                <dd class="font-mono text-surface-900 dark:text-surface-100">{entity.id}</dd>
              </div>
              <div>
                <dt class="text-surface-500">Version</dt>
                <dd class="text-surface-900 dark:text-surface-100">{entity.version}</dd>
              </div>
              <div>
                <dt class="text-surface-500">Status</dt>
                <dd class="text-surface-900 dark:text-surface-100 capitalize">{entity.status}</dd>
              </div>
              <div>
                <dt class="text-surface-500">Created</dt>
                <dd class="text-surface-900 dark:text-surface-100">
                  {new Date(entity.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt class="text-surface-500">Updated</dt>
                <dd class="text-surface-900 dark:text-surface-100">
                  {new Date(entity.updatedAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
        )}
        
        {/* Actions */}
        <div class="card p-6">
          <h3 class="heading-4 mb-4">Actions</h3>
          
          <div class="space-y-2">
            <button type="button" class="btn-ghost w-full justify-start">
              <span class="i-lucide-history mr-2"></span>
              View History
            </button>
            <button type="button" class="btn-ghost w-full justify-start">
              <span class="i-lucide-copy mr-2"></span>
              Duplicate
            </button>
            {entity && entity.status === 'draft' && (
              <button type="button" class="btn-ghost w-full justify-start text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                <span class="i-lucide-trash-2 mr-2"></span>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * EntityFormHeader Component
 * 
 * Header for entity form pages with breadcrumb, title, and action buttons.
 */
export interface EntityFormHeaderProps {
  basePath: string;
  entityType: EntityType | null;
  entity: Entity | null;
  isNew: boolean;
  saving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onSubmitForApproval?: () => void;
  orgDisplayText?: preact.ComponentChildren;
}

export function EntityFormHeader({
  basePath,
  entityType,
  entity,
  isNew,
  saving,
  isDirty,
  onSave,
  onSubmitForApproval,
  orgDisplayText,
}: EntityFormHeaderProps) {
  const dashboardLabel = basePath === '/super' ? 'Superadmin' : 'Admin';
  
  return (
    <div class="flex items-center justify-between mb-8">
      <div>
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
          <a href={basePath} class="hover:text-surface-700 dark:hover:text-surface-200">{dashboardLabel}</a>
          <span class="i-lucide-chevron-right"></span>
          <a href={`${basePath}/entities`} class="hover:text-surface-700 dark:hover:text-surface-200">Entities</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">
            {isNew ? 'Create' : entity?.data?.name || 'Edit'}
          </span>
        </nav>
        <h1 class="heading-1">
          {isNew ? `New ${entityType?.name}` : `Edit ${entityType?.name}`}
        </h1>
        {orgDisplayText && (
          <div class="mt-2 flex items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
            <span class="flex items-center gap-1">
              <span class="i-lucide-building-2 text-base"></span>
              {orgDisplayText}
            </span>
          </div>
        )}
      </div>
      
      <div class="flex items-center gap-3">
        {entity?.status === 'draft' && onSubmitForApproval && (
          <button
            type="button"
            onClick={onSubmitForApproval}
            class="btn-secondary"
            disabled={saving || isDirty}
          >
            <span class="i-lucide-send mr-2"></span>
            Submit for Approval
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          class="btn-primary"
          disabled={saving || !isDirty}
        >
          {saving ? (
            <>
              <span class="i-lucide-loader-2 animate-spin mr-2"></span>
              Saving...
            </>
          ) : (
            <>
              <span class="i-lucide-save mr-2"></span>
              {isNew ? 'Create' : 'Save'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * EntityFormStatusBanner Component
 * 
 * Shows current entity status and any save errors.
 */
export interface EntityFormStatusBannerProps {
  entity: Entity | null;
  saveError: string | null;
}

export function EntityFormStatusBanner({ entity, saveError }: EntityFormStatusBannerProps) {
  return (
    <>
      {/* Error banner */}
      {saveError && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          <span class="i-lucide-alert-circle mr-2"></span>
          {saveError}
        </div>
      )}
      
      {/* Status banner */}
      {entity && entity.status !== 'draft' && (
        <div class={`mb-6 p-4 rounded-lg ${
          entity.status === 'published' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
          entity.status === 'pending' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' :
          'bg-surface-100 dark:bg-surface-800 text-surface-600'
        }`}>
          <span class={`mr-2 ${
            entity.status === 'published' ? 'i-lucide-check-circle' :
            entity.status === 'pending' ? 'i-lucide-clock' :
            'i-lucide-archive'
          }`}></span>
          This entity is <strong>{entity.status}</strong> and cannot be edited.
        </div>
      )}
    </>
  );
}

/**
 * EntityFormUnsavedWarning Component
 * 
 * Shows a warning when there are unsaved changes.
 */
export function EntityFormUnsavedWarning({ isDirty }: { isDirty: boolean }) {
  if (!isDirty) return null;
  
  return (
    <div class="fixed bottom-6 right-6 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
      <span class="i-lucide-alert-circle"></span>
      Unsaved changes
    </div>
  );
}

/**
 * EntityTypeSelector Component
 * 
 * Grid of entity types for selecting when creating a new entity.
 */
export interface EntityTypeSelectorProps {
  basePath: string;
  entityTypes: { id: string; name: string; description?: string; fieldCount?: number }[];
  loading: boolean;
}

export function EntityTypeSelector({ basePath, entityTypes, loading }: EntityTypeSelectorProps) {
  if (loading) {
    return (
      <div class="flex items-center justify-center py-16">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }

  return (
    <>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {entityTypes.map(type => (
          <a
            key={type.id}
            href={`${basePath}/entities/new/${type.id}`}
            class="card p-6 hover:ring-2 hover:ring-primary-500 transition-all"
          >
            <h3 class="heading-4 mb-2">{type.name}</h3>
            {type.description && (
              <p class="body-text text-sm">{type.description}</p>
            )}
            {type.fieldCount !== undefined && (
              <div class="mt-4 text-sm text-surface-500">
                {type.fieldCount} fields
              </div>
            )}
          </a>
        ))}
      </div>
      
      {entityTypes.length === 0 && (
        <div class="text-center py-16">
          <span class="i-lucide-layers text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
          <h3 class="heading-3 mb-2">No Entity Types Available</h3>
          <p class="body-text">
            Contact a superadmin to set up entity types.
          </p>
        </div>
      )}
    </>
  );
}
