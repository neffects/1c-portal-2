/**
 * Super Entity Editor Page
 * 
 * Superadmin page for creating and editing entities.
 * Allows editing entities from any organization or global entities.
 */

import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { FieldRenderer } from '../../components/fields';
import { slugify } from '../../lib/utils';
import type { Entity, EntityType, EntityTypeListItem, FieldDefinition, OrganizationListItem } from '@1cc/shared';

interface SuperEntityEditorProps {
  id?: string;
  typeId?: string;
}

export function SuperEntityEditor({ id, typeId }: SuperEntityEditorProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [entity, setEntity] = useState<Entity | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [creatableTypes, setCreatableTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [manuallyEditedFields, setManuallyEditedFields] = useState<Set<string>>(new Set());
  const [hasBeenSaved, setHasBeenSaved] = useState(false);
  
  // Organization state
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null); // null = global
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [entityOrgName, setEntityOrgName] = useState<string | null>(null);
  
  const isNew = !id;
  
  // Redirect if not authorized
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load creatable entity types for new entity type selector
  useEffect(() => {
    if (isNew && !typeId && isSuperadmin.value) {
      loadCreatableTypes();
    }
  }, [isNew, typeId, isSuperadmin.value]);
  
  // Load organizations
  useEffect(() => {
    if (isSuperadmin.value) {
      loadOrganizations();
    }
  }, [isSuperadmin.value]);
  
  // Load organization name when entity is loaded
  useEffect(() => {
    if (entity && entity.organizationId && organizations.length > 0) {
      const org = organizations.find(o => o.id === entity.organizationId);
      if (org) {
        setEntityOrgName(org.name);
      } else {
        loadOrganizationName(entity.organizationId);
      }
    } else if (entity && entity.organizationId === null) {
      setEntityOrgName(null);
    }
  }, [entity, organizations]);
  
  // Load full entity type definition when typeId is selected or entity is loaded
  useEffect(() => {
    if (isNew && typeId && !entityType) {
      loadEntityTypeDefinition(typeId, true);
    } else if (entity && !entityType) {
      loadEntityTypeDefinition(entity.entityTypeId, false);
    }
  }, [typeId, entity, isNew, entityType]);
  
  // Load existing entity
  useEffect(() => {
    if (id && isSuperadmin.value) {
      loadEntity(id);
    }
  }, [id, isSuperadmin.value]);
  
  async function loadCreatableTypes() {
    setLoadingTypes(true);
    console.log('[SuperEntityEditor] Loading entity types...');
    
    try {
      const response = await api.get('/api/entity-types') as {
        success: boolean;
        data?: { items: EntityTypeListItem[] };
      };
      
      if (response.success && response.data) {
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setCreatableTypes(activeTypes);
        console.log('[SuperEntityEditor] Loaded', activeTypes.length, 'entity types');
      } else {
        console.error('[SuperEntityEditor] Failed to load types:', response);
        setCreatableTypes([]);
      }
    } catch (err) {
      console.error('[SuperEntityEditor] Error loading types:', err);
      setCreatableTypes([]);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  async function loadOrganizations() {
    setLoadingOrgs(true);
    console.log('[SuperEntityEditor] Loading organizations...');
    
    try {
      const response = await api.get('/api/organizations') as {
        success: boolean;
        data?: { items: OrganizationListItem[] };
      };
      
      if (response.success && response.data) {
        setOrganizations(response.data.items);
        console.log('[SuperEntityEditor] Loaded', response.data.items.length, 'organizations');
      } else {
        console.error('[SuperEntityEditor] Failed to load organizations:', response);
        setOrganizations([]);
      }
    } catch (err) {
      console.error('[SuperEntityEditor] Error loading organizations:', err);
      setOrganizations([]);
    } finally {
      setLoadingOrgs(false);
    }
  }
  
  async function loadEntityTypeDefinition(typeId: string, initializeForm: boolean = true) {
    console.log('[SuperEntityEditor] Loading entity type definition:', typeId);
    
    try {
      const response = await api.get(`/api/entity-types/${typeId}`) as {
        success: boolean;
        data?: EntityType;
      };
      
      if (response.success && response.data) {
        const type = response.data;
        setEntityType(type);
        if (initializeForm) {
          initializeFormData(type);
          setManuallyEditedFields(new Set());
          setHasBeenSaved(false);
        }
        console.log('[SuperEntityEditor] Loaded entity type definition:', type.name);
      } else {
        console.error('[SuperEntityEditor] Failed to load entity type:', response);
        setSaveError('Failed to load entity type definition');
      }
    } catch (err) {
      console.error('[SuperEntityEditor] Error loading entity type:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to load entity type definition');
    }
  }
  
  function initializeFormData(type: EntityType) {
    const data: Record<string, unknown> = {};
    
    type.fields.forEach(field => {
      if (field.defaultValue !== undefined) {
        data[field.id] = field.defaultValue;
      } else {
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
    
    if (data.name && typeof data.name === 'string') {
      data.slug = slugify(data.name);
    }
    
    setFormData(data);
  }
  
  async function loadEntity(entityId: string) {
    setLoading(true);
    console.log('[SuperEntityEditor] Loading entity:', entityId);
    
    try {
      const response = await api.get<Entity>(`/api/entities/${entityId}`);
      
      if (response.success && response.data) {
        const loadedEntity = response.data;
        setEntity(loadedEntity);
        setFormData(loadedEntity.data);
        setHasBeenSaved(true);
        
        if (loadedEntity.organizationId) {
          loadOrganizationName(loadedEntity.organizationId);
        } else {
          setEntityOrgName(null);
        }
        console.log('[SuperEntityEditor] Entity loaded successfully:', entityId);
      } else {
        console.error('[SuperEntityEditor] Failed to load entity:', response);
        setSaveError(response.error?.message || 'Failed to load entity');
        route('/super/entities');
      }
    } catch (err) {
      console.error('[SuperEntityEditor] Error loading entity:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to load entity');
      route('/super/entities');
    } finally {
      setLoading(false);
    }
  }
  
  async function loadOrganizationName(orgId: string) {
    const orgInList = organizations.find(o => o.id === orgId);
    if (orgInList) {
      setEntityOrgName(orgInList.name);
      return;
    }
    
    try {
      const response = await api.get(`/api/organizations/${orgId}`) as {
        success: boolean;
        data?: { name: string; id: string };
      };
      
      if (response.success && response.data) {
        setEntityOrgName(response.data.name);
      } else {
        setEntityOrgName(null);
      }
    } catch (err) {
      console.error('[SuperEntityEditor] Error loading organization name:', err);
      setEntityOrgName(null);
    }
  }
  
  function handleFieldChange(fieldId: string, value: unknown) {
    const isNameField = fieldId === 'name' || (entityType && entityType.fields.find(f => f.id === fieldId)?.name?.toLowerCase() === 'name');
    
    if (isNew && !hasBeenSaved && isNameField && typeof value === 'string') {
      const slugFieldId = entityType 
        ? entityType.fields.find(f => f.id === 'slug' || f.name?.toLowerCase() === 'slug')?.id || 'slug'
        : 'slug';
      
      if (!manuallyEditedFields.has(slugFieldId)) {
        const slugValue = slugify(value);
        setFormData(prev => ({ 
          ...prev, 
          [fieldId]: value,
          [slugFieldId]: slugValue 
        }));
        setManuallyEditedFields(prev => new Set(prev).add(fieldId));
      } else {
        setFormData(prev => ({ ...prev, [fieldId]: value }));
        setManuallyEditedFields(prev => new Set(prev).add(fieldId));
      }
    } else {
      setFormData(prev => ({ ...prev, [fieldId]: value }));
      setManuallyEditedFields(prev => new Set(prev).add(fieldId));
    }
    
    setIsDirty(true);
    
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
      
      if (field.required) {
        if (value === undefined || value === null || value === '') {
          newErrors[field.id] = 'This field is required';
        } else if (Array.isArray(value) && value.length === 0) {
          newErrors[field.id] = 'Please select at least one option';
        }
      }
      
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
        data: formData
      };
      
      let response;
      
      if (isNew) {
        const createPayload: Record<string, unknown> = {
          entityTypeId: entityType.id,
          ...payload,
          organizationId: selectedOrgId // null = global, string = specific org
        };
        
        response = await api.post<Entity>('/api/entities', createPayload);
      } else {
        response = await api.patch<Entity>(`/api/entities/${id}`, payload);
      }
      
      if (response.success && response.data) {
        setIsDirty(false);
        setHasBeenSaved(true);
        
        if (isNew) {
          route(`/super/entities/${response.data.id}/edit`);
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
    return (
      <div class="container-default py-12">
        <div class="mb-8">
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <a href="/super/entities" class="hover:text-surface-700 dark:hover:text-surface-200">Entities</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">Create</span>
          </nav>
          <h1 class="heading-1 mb-2">Create New Entity</h1>
          <p class="body-text">Select an entity type to get started.</p>
        </div>
        
        {loadingTypes ? (
          <div class="flex items-center justify-center py-16">
            <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
          </div>
        ) : (
          <>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatableTypes.map(type => (
                <a
                  key={type.id}
                  href={`/super/entities/new/${type.id}`}
                  class="card p-6 hover:ring-2 hover:ring-primary-500 transition-all"
                >
                  <h3 class="heading-4 mb-2">{type.name}</h3>
                  {type.description && (
                    <p class="body-text text-sm">{type.description}</p>
                  )}
                  <div class="mt-4 text-sm text-surface-500">
                    {type.fieldCount} fields
                  </div>
                </a>
              ))}
            </div>
            
            {creatableTypes.length === 0 && (
              <div class="text-center py-16">
                <span class="i-lucide-layers text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
                <h3 class="heading-3 mb-2">No Entity Types Available</h3>
                <p class="body-text">
                  Create an entity type first to start creating entities.
                </p>
                <a href="/super/types/new" class="btn-primary mt-4">
                  Create Entity Type
                </a>
              </div>
            )}
          </>
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
  
  // Get org display text
  const getOrgDisplayText = () => {
    if (isNew) {
      if (selectedOrgId === null) {
        return <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>;
      }
      const org = organizations.find(o => o.id === selectedOrgId);
      return org?.name || 'Select Organization';
    } else {
      if (entity?.organizationId === null) {
        return <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>;
      }
      return entityOrgName || entity?.organizationId || 'Organization';
    }
  };
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-center justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <a href="/super/entities" class="hover:text-surface-700 dark:hover:text-surface-200">Entities</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">
              {isNew ? 'Create' : entity?.data?.name || 'Edit'}
            </span>
          </nav>
          <h1 class="heading-1">
            {isNew ? `New ${entityType?.name}` : `Edit ${entityType?.name}`}
          </h1>
          <div class="mt-2 flex items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
            <span class="flex items-center gap-1">
              <span class="i-lucide-building-2 text-base"></span>
              {getOrgDisplayText()}
            </span>
          </div>
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
          This entity is <strong>{entity.status}</strong> and cannot be edited.
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
                    .map(field => {
                      const isSlugField = field.id === 'slug';
                      const showSlugHelper = isNew && isSlugField;
                      
                      return (
                        <div key={field.id}>
                          <FieldRenderer
                            field={field}
                            value={formData[field.id]}
                            onChange={(value) => handleFieldChange(field.id, value)}
                            error={errors[field.id]}
                            disabled={entity?.status !== 'draft' && !!entity}
                          />
                          {showSlugHelper && (
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
          {isNew ? (
            <div class="card p-6">
              <h3 class="heading-4 mb-4">Organization</h3>
              {loadingOrgs ? (
                <div class="flex items-center justify-center py-4">
                  <span class="i-lucide-loader-2 animate-spin text-xl text-primary-500"></span>
                </div>
              ) : (
                <select
                  value={selectedOrgId === null ? 'global' : (selectedOrgId || 'global')}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    setSelectedOrgId(value === 'global' ? null : value);
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
          ) : entity && (
            <div class="card p-6">
              <h3 class="heading-4 mb-4">Organization</h3>
              <div class="text-surface-900 dark:text-surface-100">
                {entity.organizationId === null 
                  ? <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>
                  : (entityOrgName || entity.organizationId)}
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
