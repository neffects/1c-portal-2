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
import { slugify, checkDuplicatesInBundle, type DuplicateCheckResult } from '../../lib/utils';
import type { Entity, EntityType, EntityTypeListItem, FieldDefinition, OrganizationListItem, EntityBundle, BundleEntity } from '@1cc/shared';

interface EntityEditorProps {
  orgSlug?: string;
  id?: string;
  typeId?: string;
}

export function EntityEditor({ orgSlug, id, typeId: typeIdProp }: EntityEditorProps) {
  const { currentOrganization } = useAuth();
  
  // Helper to get org identifier (slug or ID fallback)
  const getOrgIdentifier = (): string => {
    if (orgSlug) return orgSlug;
    const org = currentOrganization.value;
    return org?.slug || org?.id || '';
  };
  
  const effectiveOrgId = getOrgIdentifier();
  // Read typeId from URL query string if not provided as prop (for /admin/entities/new?type=xxx pattern)
  const urlParams = new URLSearchParams(window.location.search);
  const typeIdFromQuery = urlParams.get('type');
  const typeId = typeIdProp || typeIdFromQuery || undefined;
  const { isAuthenticated, isOrgAdmin, isSuperadmin, loading: authLoading, organizationId, user, userId } = useAuth();
  const { entityTypes } = useSync();
  
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
  const [hasBeenSaved, setHasBeenSaved] = useState(false); // Track if entity has been saved at least once
  const [adminOrganizations, setAdminOrganizations] = useState<OrganizationListItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(organizationId.value);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [entityOrgName, setEntityOrgName] = useState<string | null>(null);
  
  // Duplicate checking state
  const [orgBundle, setOrgBundle] = useState<EntityBundle | null>(null);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckResult>({});
  
  const isNew = !id;
  
  // Redirect if not authorized
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isOrgAdmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isOrgAdmin.value]);
  
  // Load creatable entity types for new entity type selector
  useEffect(() => {
    if (isNew && !typeId && isOrgAdmin.value) {
      loadCreatableTypes();
    }
  }, [isNew, typeId, isOrgAdmin.value]);
  
  // Load organizations where user is an admin when creating new entity or editing
  useEffect(() => {
    if (isOrgAdmin.value) {
      loadAdminOrganizations();
    }
  }, [isOrgAdmin.value]);
  
  // Load organization name when entity is loaded
  useEffect(() => {
    if (entity && entity.organizationId && adminOrganizations.length > 0) {
      const org = adminOrganizations.find(o => o.id === entity.organizationId);
      if (org) {
        setEntityOrgName(org.name);
      } else {
        // Organization not in admin list, fetch it separately
        loadOrganizationName(entity.organizationId);
      }
    } else if (entity && entity.organizationId === null) {
      setEntityOrgName(null); // Global entity
    }
  }, [entity, adminOrganizations]);
  
  // Update selected org when default organization changes
  useEffect(() => {
    if (isNew && organizationId.value && !selectedOrgId) {
      setSelectedOrgId(organizationId.value);
    }
  }, [isNew, organizationId.value]);
  
  // Load full entity type definition when typeId is selected or entity is loaded
  useEffect(() => {
    if (isNew && typeId && !entityType) {
      // Loading type for new entity - initialize form data
      loadEntityTypeDefinition(typeId, true);
    } else if (entity && !entityType) {
      // Loading type for existing entity - don't initialize form data (already loaded from entity)
      loadEntityTypeDefinition(entity.entityTypeId, false);
    }
  }, [typeId, entity, isNew, entityType]);
  
  // Load org bundle for duplicate checking when entity type and org are known
  useEffect(() => {
    const effectiveTypeId = entityType?.id || typeId;
    const effectiveOrg = isNew ? selectedOrgId : entity?.organizationId;
    
    if (effectiveTypeId && effectiveOrg) {
      loadOrgBundle(effectiveOrg, effectiveTypeId);
    }
  }, [entityType?.id, typeId, selectedOrgId, entity?.organizationId, isNew]);
  
  // Run duplicate check when name or slug changes
  useEffect(() => {
    if (!orgBundle) {
      setDuplicateCheck({});
      return;
    }
    
    const name = (formData.name as string) || '';
    const slug = (formData.slug as string) || '';
    const excludeId = isNew ? undefined : entity?.id;
    
    const result = checkDuplicatesInBundle(orgBundle, name, slug, excludeId);
    setDuplicateCheck(result);
    
    console.log('[EntityEditor] Duplicate check result:', result);
  }, [formData.name, formData.slug, orgBundle, isNew, entity?.id]);
  
  async function loadOrgBundle(orgId: string, typeId: string) {
    setLoadingBundle(true);
    console.log('[EntityEditor] Loading org bundle for duplicate checking:', orgId, typeId);
    
    try {
      const response = await api.get(`/manifests/bundles/org/${orgId}/${typeId}`) as {
        success: boolean;
        data?: EntityBundle;
      };
      
      if (response.success && response.data) {
        setOrgBundle(response.data);
        console.log('[EntityEditor] Loaded org bundle with', response.data.entities?.length || 0, 'entities');
      } else {
        console.log('[EntityEditor] No bundle found or empty response');
        setOrgBundle(null);
      }
    } catch (err) {
      console.error('[EntityEditor] Error loading org bundle:', err);
      setOrgBundle(null);
    } finally {
      setLoadingBundle(false);
    }
  }
  
  async function loadCreatableTypes() {
    setLoadingTypes(true);
    console.log('[EntityEditor] Loading creatable entity types...');
    
    try {
      const response = await api.get('/api/entity-types?permission=creatable') as {
        success: boolean;
        data?: { items: EntityTypeListItem[] };
      };
      
      if (response.success && response.data) {
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setCreatableTypes(activeTypes);
        console.log('[EntityEditor] Loaded', activeTypes.length, 'creatable entity types');
      } else {
        console.error('[EntityEditor] Failed to load creatable types:', response);
        setCreatableTypes([]);
      }
    } catch (err) {
      console.error('[EntityEditor] Error loading creatable types:', err);
      setCreatableTypes([]);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  async function loadAdminOrganizations() {
    setLoadingOrgs(true);
    console.log('[EntityEditor] Loading organizations where user is admin...');
    
    try {
      const response = await api.get('/api/organizations?adminOnly=true') as {
        success: boolean;
        data?: { items: OrganizationListItem[] };
      };
      
      if (response.success && response.data) {
        setAdminOrganizations(response.data.items);
        // Set default to current org if available, otherwise first org, or null for superadmin
        if (!selectedOrgId) {
          if (organizationId.value) {
            const defaultOrg = response.data.items.find(o => o.id === organizationId.value);
            if (defaultOrg) {
              setSelectedOrgId(defaultOrg.id);
            } else if (response.data.items.length > 0) {
              setSelectedOrgId(response.data.items[0].id);
            }
          } else if (response.data.items.length > 0) {
            setSelectedOrgId(response.data.items[0].id);
          }
        }
        console.log('[EntityEditor] Loaded', response.data.items.length, 'admin organizations');
      } else {
        console.error('[EntityEditor] Failed to load organizations:', response);
        setAdminOrganizations([]);
      }
    } catch (err) {
      console.error('[EntityEditor] Error loading organizations:', err);
      setAdminOrganizations([]);
    } finally {
      setLoadingOrgs(false);
    }
  }
  
  async function loadEntityTypeDefinition(typeId: string, initializeForm: boolean = true) {
    console.log('[EntityEditor] Loading entity type definition:', typeId, 'initializeForm:', initializeForm);
    
    try {
      const response = await api.get(`/api/entity-types/${typeId}`) as {
        success: boolean;
        data?: EntityType;
      };
      
      if (response.success && response.data) {
        const type = response.data;
        setEntityType(type);
        if (initializeForm) {
          // Only initialize form data for new entities
          initializeFormData(type);
          // Reset manually edited fields for new entity
          setManuallyEditedFields(new Set());
          // Reset hasBeenSaved for new entity
          setHasBeenSaved(false);
        }
        console.log('[EntityEditor] Loaded entity type definition:', type.name);
      } else {
        console.error('[EntityEditor] Failed to load entity type:', response);
        setSaveError('Failed to load entity type definition');
      }
    } catch (err) {
      console.error('[EntityEditor] Error loading entity type:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to load entity type definition');
    }
  }
  
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
    
    // Auto-generate slug from name if name has a default value
    // Name and slug are hard-coded required fields that always exist
    if (data.name && typeof data.name === 'string') {
      data.slug = slugify(data.name);
      console.log('[EntityEditor] Auto-generated slug from default name:', data.slug);
    }
    
    setFormData(data);
  }
  
  async function loadEntity(entityId: string) {
    setLoading(true);
    
    const response = await api.get<Entity>(`/api/entities/${entityId}`);
    
    if (response.success && response.data) {
      const loadedEntity = response.data;
      setEntity(loadedEntity);
      setFormData(loadedEntity.data);
      // Entity already exists, so it has been saved
      setHasBeenSaved(true);
      
      // Load organization name if entity has an organization
      if (loadedEntity.organizationId) {
        loadOrganizationName(loadedEntity.organizationId);
      } else {
        setEntityOrgName(null); // Global entity
      }
    } else {
      route('/admin');
    }
    
    setLoading(false);
  }
  
  async function loadOrganizationName(orgId: string) {
    // First try to find in adminOrganizations list
    const orgInList = adminOrganizations.find(o => o.id === orgId);
    if (orgInList) {
      setEntityOrgName(orgInList.name);
      return;
    }
    
    // If not found, fetch from API
    try {
      const response = await api.get(`/api/organizations/${orgId}`) as {
        success: boolean;
        data?: { name: string; id: string };
      };
      
      if (response.success && response.data) {
        setEntityOrgName(response.data.name);
        console.log('[EntityEditor] Loaded organization name:', response.data.name);
      } else {
        setEntityOrgName(null);
      }
    } catch (err) {
      console.error('[EntityEditor] Error loading organization name:', err);
      setEntityOrgName(null);
    }
  }
  
  function handleFieldChange(fieldId: string, value: unknown) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:224',message:'handleFieldChange called',data:{fieldId,valueType:typeof value,valueStr:String(value).substring(0,50),isNew,manuallyEditedFields:Array.from(manuallyEditedFields)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Auto-populate slug from name field when creating new entity
    // Name and slug are hard-coded required fields that always exist
    // Find name field by ID or by name property (for backward compatibility)
    const isNameField = fieldId === 'name' || (entityType && entityType.fields.find(f => f.id === fieldId)?.name?.toLowerCase() === 'name');
    
    // Update both name and slug in a single state update for immediate sync
    // Only auto-generate slug if: creating new entity AND entity hasn't been saved yet
    if (isNew && !hasBeenSaved && isNameField && typeof value === 'string') {
      // Find slug field by ID or by name property (for backward compatibility)
      const slugFieldId = entityType 
        ? entityType.fields.find(f => f.id === 'slug' || f.name?.toLowerCase() === 'slug')?.id || 'slug'
        : 'slug';
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:232',message:'Name field condition met',data:{fieldId,value,isNew,slugFieldId,slugManuallyEdited:manuallyEditedFields.has(slugFieldId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      // Auto-populate slug if it hasn't been manually edited
      // This allows the slug to auto-update as the user types, but if they manually edit
      // the slug, it won't be overwritten
      if (!manuallyEditedFields.has(slugFieldId)) {
        const slugValue = slugify(value);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:238',message:'Generating slug',data:{nameValue:value,slugValue,slugFieldId,formDataBefore:JSON.stringify(formData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        console.log('[EntityEditor] Auto-generating slug from name:', slugValue);
        // Update both name and slug in a single state update
        setFormData(prev => {
          const updated = { 
            ...prev, 
            [fieldId]: value,
            [slugFieldId]: slugValue 
          };
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:248',message:'setFormData callback - updating slug',data:{fieldId,value,slugValue,slugFieldId,prevSlug:prev[slugFieldId],updatedSlug:updated[slugFieldId]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          return updated;
        });
        // Mark name as manually edited, but NOT slug (so it keeps auto-updating)
        setManuallyEditedFields(prev => new Set(prev).add(fieldId));
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:258',message:'Slug manually edited - skipping auto-gen',data:{fieldId,value,slugFieldId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // Just update the name field (slug was manually edited, don't overwrite)
        setFormData(prev => ({ ...prev, [fieldId]: value }));
        // Mark name as manually edited
        setManuallyEditedFields(prev => new Set(prev).add(fieldId));
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:266',message:'Name condition not met',data:{fieldId,isNew,isNameField,valueType:typeof value,fieldName:entityType?.fields.find(f => f.id === fieldId)?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      // Update the field normally
      setFormData(prev => ({ ...prev, [fieldId]: value }));
      // Mark field as manually edited
      setManuallyEditedFields(prev => new Set(prev).add(fieldId));
    }
    
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
    
    // Check for duplicate slug (blocking)
    if (duplicateCheck.slugMatch) {
      newErrors.slug = 'This slug is already in use. Please choose a different slug.';
    }
    
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
  
  // Check if save should be blocked due to duplicate slug
  const hasDuplicateSlug = !!duplicateCheck.slugMatch;
  
  async function handleSave() {
    if (!entityType) return;
    if (!validateForm()) return;
    
    setSaving(true);
    setSaveError(null);
    
    // #region agent log
    const slugField = entityType.fields.find(f => f.id === 'slug' || f.name?.toLowerCase() === 'slug');
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:348',message:'handleSave called',data:{isNew,slugFieldId:slugField?.id,slugFieldPattern:slugField?.constraints?.pattern,slugValue:formData[slugField?.id || 'slug'],allFieldPatterns:entityType.fields.filter(f => f.constraints?.pattern).map(f => ({id:f.id,name:f.name,pattern:f.constraints?.pattern}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'J'})}).catch(()=>{});
    // #endregion
    
    try {
      const payload = {
        data: formData
      };
      
      let response;
      
      if (isNew) {
        const createPayload: Record<string, unknown> = {
          entityTypeId: entityType.id,
          ...payload
        };
        
        // Determine target organization ID
        // null = global entity (superadmin only), use default org otherwise
        let targetOrgId: string;
        if (selectedOrgId === null) {
          // Global entity - superadmin only, but still need to use org route structure
          // For now, use user's default org (API will handle global entities differently)
          if (!organizationId.value) {
            throw new Error('You must belong to an organization to create entities');
          }
          targetOrgId = organizationId.value;
          // Note: Global entities (null orgId) may need special handling
        } else {
          targetOrgId = selectedOrgId || organizationId.value!;
        }
        
        // Remove organizationId from payload - it's in the URL path
        delete createPayload.organizationId;
        
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:375',message:'Sending create request',data:{payload:JSON.stringify(createPayload).substring(0,200),targetOrgId},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        
        // Use organization-scoped route: /api/orgs/:orgId/entities
        response = await api.post<Entity>(`/api/orgs/${targetOrgId}/entities`, createPayload);
      } else {
        response = await api.patch<Entity>(`/api/entities/${id}`, payload);
      }
      
      if (response.success && response.data) {
        setIsDirty(false);
        // Mark entity as saved - slug should no longer auto-update
        setHasBeenSaved(true);
        
        if (isNew) {
          route(`/admin/${effectiveOrgId}/entities/${response.data.id}/edit`);
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
    return (
      <div class="container-default py-12">
        <div class="mb-8">
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
                  href={`/admin/entities/new/${type.id}`}
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
                  Contact a superadmin to set up entity types for your organization.
                </p>
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
          <div class="mt-2 flex items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
            <span class="flex items-center gap-1">
              <span class="i-lucide-building-2 text-base"></span>
              {isNew ? (
                selectedOrgId === null 
                  ? <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>
                  : (adminOrganizations.find(o => o.id === selectedOrgId)?.name || user.value?.organizationName || 'Your Organization')
              ) : (
                entity?.organizationId === null 
                  ? <span class="text-primary-600 dark:text-primary-400 font-medium">Global (Platform-wide)</span>
                  : (entityOrgName || user.value?.organizationName || entity?.organizationId || 'Organization')
              )}
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
            disabled={saving || !isDirty || hasDuplicateSlug}
            title={hasDuplicateSlug ? 'Cannot save: duplicate slug exists' : undefined}
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
      
      {/* Duplicate name warning banner (non-blocking) */}
      {duplicateCheck.nameMatch && (
        <div class="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="i-lucide-alert-triangle"></span>
            <span>
              An entity with this name already exists: <strong>"{duplicateCheck.nameMatch.data?.name}"</strong>
            </span>
          </div>
          <a 
            href={`/admin/${effectiveOrgId}/entities/${duplicateCheck.nameMatch.id}`}
            class="text-amber-800 dark:text-amber-300 hover:underline flex items-center gap-1"
            target="_blank"
          >
            View <span class="i-lucide-external-link text-sm"></span>
          </a>
        </div>
      )}
      
      {/* Duplicate slug error banner (blocking) */}
      {duplicateCheck.slugMatch && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="i-lucide-alert-circle"></span>
            <span>
              This slug is already in use by: <strong>"{duplicateCheck.slugMatch.data?.name}"</strong>. Please choose a different slug.
            </span>
          </div>
          <a 
            href={`/admin/${effectiveOrgId}/entities/${duplicateCheck.slugMatch.id}`}
            class="text-red-800 dark:text-red-300 hover:underline flex items-center gap-1"
            target="_blank"
          >
            View <span class="i-lucide-external-link text-sm"></span>
          </a>
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
                    .map(field => {
                      // Special handling for slug field - show helper text for auto-generation
                      const isSlugField = field.id === 'slug';
                      const showSlugHelper = isNew && isSlugField;
                      
                      return (
                        <div key={field.id}>
                          {/* #region agent log */}
                          {field.id === 'slug' && (() => {
                            fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EntityEditor.tsx:580',message:'Rendering slug field',data:{fieldId:field.id,formDataSlug:formData.slug,formDataName:formData.name,allFormDataKeys:Object.keys(formData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
                            return null;
                          })()}
                          {/* #endregion */}
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
                  value={selectedOrgId === null ? 'global' : (selectedOrgId || '')}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    setSelectedOrgId(value === 'global' ? null : value);
                  }}
                  class="input w-full"
                  disabled={saving}
                >
                  {isSuperadmin.value && (
                    <option value="global">Global (Platform-wide)</option>
                  )}
                  {adminOrganizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
              <p class="text-sm text-surface-500 mt-2">
                {isSuperadmin.value 
                  ? 'Select the organization this entity belongs to, or choose Global for platform-wide entities'
                  : 'Select the organization this entity belongs to'}
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
