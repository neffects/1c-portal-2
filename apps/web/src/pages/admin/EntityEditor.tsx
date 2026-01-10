/**
 * Entity Editor Page
 * 
 * Full-featured entity editor with dynamic field rendering.
 */

import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { useSync } from '../../stores/sync';
import { api } from '../../lib/api';
import { FieldRenderer } from '../../components/fields';
import type { Entity, EntityType, FieldDefinition, VisibilityScope } from '@1cc/shared';

interface EntityEditorProps {
  id?: string;
  typeId?: string;
}

export function EntityEditor({ id, typeId }: EntityEditorProps) {
  const { isAuthenticated, isOrgAdmin, loading: authLoading, organizationId, userId } = useAuth();
  const { entityTypes } = useSync();
  
  const [entity, setEntity] = useState<Entity | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [visibility, setVisibility] = useState<VisibilityScope>('private');
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  
  const isNew = !id;
  
  // Redirect if not authorized
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load entity type
  useEffect(() => {
    const types = entityTypes.value;
    
    if (isNew && typeId) {
      const type = types.find(t => t.id === typeId);
      if (type) {
        setEntityType(type as unknown as EntityType);
        setVisibility(type.defaultVisibility as VisibilityScope);
        initializeFormData(type as unknown as EntityType);
      }
    } else if (entity) {
      const type = types.find(t => t.id === entity.entityTypeId);
      if (type) {
        setEntityType(type as unknown as EntityType);
      }
    }
  }, [entityTypes.value, typeId, entity, isNew]);
  
  // Load existing entity
  useEffect(() => {
    if (id && isOrgAdmin.value) {
      loadEntity(id);
    }
  }, [id, isOrgAdmin.value]);
  
  function initializeFormData(type: EntityType) {
    const data: Record<string, unknown> = {};
    
    type.fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        data[field.id] = field.defaultValue;
      } else {
        // Initialize with appropriate empty values
        switch (field.type) {
          case 'boolean':
            data[field.id] = false;
            break;
          case 'multiselect':
            data[field.id] = [];
            break;
          default:
            data[field.id] = '';
        }
      }
    });
    
    setFormData(data);
  }
  
  async function loadEntity(entityId: string) {
    setLoading(true);
    
    const response = await api.get<Entity>(`/api/entities/${entityId}`);
    
    if (response.success && response.data) {
      setEntity(response.data);
      setFormData(response.data.data);
      setVisibility(response.data.visibility);
    } else {
      route('/admin');
    }
    
    setLoading(false);
  }
  
  function handleFieldChange(fieldId: string, value: unknown) {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
    setIsDirty(true);
    
    // Clear error for this field
    if (errors[fieldId]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  }
  
  function validateForm(): boolean {
    const newErrors: Record<string, string> = {};
    
    if (!entityType) return false;
    
    entityType.fields.forEach(field => {
      const value = formData[field.id];
      
      // Check required fields
      if (field.required) {
        if (value === undefined || value === null || value === '') {
          newErrors[field.id] = 'This field is required';
        } else if (Array.isArray(value) && value.length === 0) {
          newErrors[field.id] = 'Please select at least one option';
        }
      }
      
      // Type-specific validation
      if (value !== undefined && value !== null && value !== '') {
        const constraints = field.constraints || {};
        
        if (field.type === 'string' || field.type === 'text' || field.type === 'markdown') {
          const strValue = value as string;
          if (constraints.minLength && strValue.length < constraints.minLength) {
            newErrors[field.id] = `Must be at least ${constraints.minLength} characters`;
          }
          if (constraints.maxLength && strValue.length > constraints.maxLength) {
            newErrors[field.id] = `Must not exceed ${constraints.maxLength} characters`;
          }
        }
        
        if (field.type === 'number') {
          const numValue = value as number;
          if (constraints.minValue !== undefined && numValue < constraints.minValue) {
            newErrors[field.id] = `Must be at least ${constraints.minValue}`;
          }
          if (constraints.maxValue !== undefined && numValue > constraints.maxValue) {
            newErrors[field.id] = `Must not exceed ${constraints.maxValue}`;
          }
        }
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }
  
  async function handleSave() {
    if (!entityType) return;
    if (!validateForm()) return;
    
    setSaving(true);
    setSaveError(null);
    
    try {
      const payload = {
        data: formData,
        visibility
      };
      
      let response;
      
      if (isNew) {
        response = await api.post<Entity>('/api/entities', {
          entityTypeId: entityType.id,
          ...payload
        });
      } else {
        response = await api.patch<Entity>(`/api/entities/${id}`, payload);
      }
      
      if (response.success && response.data) {
        setIsDirty(false);
        
        if (isNew) {
          route(`/admin/entities/${response.data.id}`);
        } else {
          setEntity(response.data);
        }
      } else {
        setSaveError(response.error?.message || 'Failed to save entity');
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save entity');
    } finally {
      setSaving(false);
    }
  }
  
  async function handleSubmitForApproval() {
    if (!entity) return;
    
    setSaving(true);
    setSaveError(null);
    
    const response = await api.post(`/api/entities/${entity.id}/transition`, {
      action: 'submitForApproval'
    });
    
    if (response.success) {
      // Reload entity
      loadEntity(entity.id);
    } else {
      setSaveError(response.error?.message || 'Failed to submit for approval');
    }
    
    setSaving(false);
  }
  
  // Render loading state
  if (authLoading.value || loading) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  // Render type selector for new entities
  if (isNew && !entityType) {
    const types = entityTypes.value;
    
    return (
      <div class="container-default py-12">
        <div class="mb-8">
          <h1 class="heading-1 mb-2">Create New Entity</h1>
          <p class="body-text">Select an entity type to get started.</p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map(type => (
            <a
              key={type.id}
              href={`/admin/entities/new?type=${type.id}`}
              class="card p-6 hover:ring-2 hover:ring-primary-500 transition-all"
            >
              <h3 class="heading-4 mb-2">{type.name}</h3>
              {type.description && (
                <p class="body-text text-sm">{type.description}</p>
              )}
              <div class="mt-4 text-sm text-surface-500">
                {type.fields?.length || 0} fields
              </div>
            </a>
          ))}
        </div>
        
        {types.length === 0 && (
          <div class="text-center py-16">
            <span class="i-lucide-layers text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
            <h3 class="heading-3 mb-2">No Entity Types Available</h3>
            <p class="body-text">
              Contact a superadmin to set up entity types for your organization.
            </p>
          </div>
        )}
      </div>
    );
  }
  
  // Group fields by section
  const sections = entityType?.sections || [{ id: 'default', name: 'Fields', displayOrder: 0 }];
  const fieldsBySection = new Map<string, FieldDefinition[]>();
  
  sections.forEach(section => {
    fieldsBySection.set(section.id, []);
  });
  
  entityType?.fields.forEach(field => {
    const sectionId = field.sectionId || 'default';
    const sectionFields = fieldsBySection.get(sectionId) || [];
    sectionFields.push(field);
    fieldsBySection.set(sectionId, sectionFields);
  });
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-center justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/admin" class="hover:text-surface-700 dark:hover:text-surface-200">Admin</a>
            <span class="i-lucide-chevron-right"></span>
            <a href="/admin/entities" class="hover:text-surface-700 dark:hover:text-surface-200">Entities</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">
              {isNew ? 'Create' : entity?.data?.name || 'Edit'}
            </span>
          </nav>
          <h1 class="heading-1">
            {isNew ? `New ${entityType?.name}` : `Edit ${entityType?.name}`}
          </h1>
        </div>
        
        <div class="flex items-center gap-3">
          {entity?.status === 'draft' && (
            <button
              type="button"
              onClick={handleSubmitForApproval}
              class="btn-secondary"
              disabled={saving || isDirty}
            >
              <span class="i-lucide-send mr-2"></span>
              Submit for Approval
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
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
          This entity is <strong>{entity.status}</strong>
          {entity.status !== 'draft' && ' and cannot be edited.'}
        </div>
      )}
      
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
                    .map(field => (
                      <FieldRenderer
                        key={field.id}
                        field={field}
                        value={formData[field.id]}
                        onChange={(value) => handleFieldChange(field.id, value)}
                        error={errors[field.id]}
                        disabled={entity?.status !== 'draft' && !!entity}
                      />
                    ))
                  }
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Sidebar */}
        <div class="lg:col-span-1 space-y-6">
          {/* Visibility */}
          <div class="card p-6">
            <h3 class="heading-4 mb-4">Visibility</h3>
            
            <div class="space-y-3">
              <label class="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800">
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                  class="mt-1"
                  disabled={entity?.status !== 'draft' && !!entity}
                />
                <div>
                  <span class="font-medium text-surface-900 dark:text-surface-100">Private</span>
                  <p class="text-sm text-surface-500">Only visible to your organization</p>
                </div>
              </label>
              
              <label class="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800">
                <input
                  type="radio"
                  name="visibility"
                  value="platform"
                  checked={visibility === 'platform'}
                  onChange={() => setVisibility('platform')}
                  class="mt-1"
                  disabled={entity?.status !== 'draft' && !!entity}
                />
                <div>
                  <span class="font-medium text-surface-900 dark:text-surface-100">Platform</span>
                  <p class="text-sm text-surface-500">Visible to all authenticated users</p>
                </div>
              </label>
              
              {entityType?.allowPublic && (
                <label class="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                    class="mt-1"
                    disabled={entity?.status !== 'draft' && !!entity}
                  />
                  <div>
                    <span class="font-medium text-surface-900 dark:text-surface-100">Public</span>
                    <p class="text-sm text-surface-500">Visible to everyone, including anonymous users</p>
                  </div>
                </label>
              )}
            </div>
          </div>
          
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
      
      {/* Unsaved changes warning */}
      {isDirty && (
        <div class="fixed bottom-6 right-6 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <span class="i-lucide-alert-circle"></span>
          Unsaved changes
        </div>
      )}
    </div>
  );
}
