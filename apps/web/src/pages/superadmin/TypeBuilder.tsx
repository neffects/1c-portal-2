/**
 * Type Builder Page
 * 
 * Visual editor for creating and editing entity types.
 * Includes drag-and-drop field ordering and constraint configuration.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityType, FieldDefinition, FieldSection, FieldType, SelectOption } from '@1cc/shared';
import { FIELD_TYPES, VISIBILITY_SCOPES } from '@1cc/shared';

interface TypeBuilderProps {
  id?: string;
}

// Default field template
const defaultField: Omit<FieldDefinition, 'id'> = {
  name: '',
  type: 'string',
  required: false,
  displayOrder: 0,
  sectionId: '',
  showInTable: false
};

// Default section template
const defaultSection: Omit<FieldSection, 'id'> = {
  name: '',
  displayOrder: 0
};

/**
 * Field Type Selector
 */
function FieldTypeSelector({ value, onChange }: { value: FieldType; onChange: (type: FieldType) => void }) {
  const typeLabels: Record<FieldType, { label: string; icon: string }> = {
    string: { label: 'Short Text', icon: 'i-lucide-type' },
    text: { label: 'Long Text', icon: 'i-lucide-align-left' },
    markdown: { label: 'Rich Text', icon: 'i-lucide-file-text' },
    number: { label: 'Number', icon: 'i-lucide-hash' },
    boolean: { label: 'Toggle', icon: 'i-lucide-toggle-left' },
    date: { label: 'Date', icon: 'i-lucide-calendar' },
    select: { label: 'Dropdown', icon: 'i-lucide-chevron-down' },
    multiselect: { label: 'Multi-Select', icon: 'i-lucide-list-checks' },
    link: { label: 'Entity Link', icon: 'i-lucide-link' },
    image: { label: 'Image', icon: 'i-lucide-image' },
    logo: { label: 'Logo', icon: 'i-lucide-image' },
    file: { label: 'File', icon: 'i-lucide-file' },
    country: { label: 'Country', icon: 'i-lucide-globe' }
  };
  
  return (
    <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {(FIELD_TYPES as readonly FieldType[]).map(type => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          class={`p-3 rounded-lg border text-left transition-all ${
            value === type 
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' 
              : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
          }`}
        >
          <span class={`${typeLabels[type].icon} text-lg mb-1 ${value === type ? 'text-primary-600' : 'text-surface-500'}`}></span>
          <p class="text-xs font-medium text-surface-900 dark:text-surface-100">{typeLabels[type].label}</p>
        </button>
      ))}
    </div>
  );
}

/**
 * Field Constraints Editor
 */
function FieldConstraintsEditor({ 
  field, 
  onChange 
}: { 
  field: Partial<FieldDefinition>; 
  onChange: (constraints: FieldDefinition['constraints']) => void 
}) {
  const constraints = field.constraints || {};
  
  const updateConstraint = (key: string, value: unknown) => {
    onChange({ ...constraints, [key]: value });
  };
  
  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
      return (
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Min Length
              </label>
              <input
                type="number"
                value={constraints.minLength || ''}
                onInput={(e) => updateConstraint('minLength', parseInt((e.target as HTMLInputElement).value) || undefined)}
                class="input"
                min="0"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Max Length
              </label>
              <input
                type="number"
                value={constraints.maxLength || ''}
                onInput={(e) => updateConstraint('maxLength', parseInt((e.target as HTMLInputElement).value) || undefined)}
                class="input"
                min="1"
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Validation Pattern (Regex)
            </label>
            <input
              type="text"
              value={constraints.pattern || ''}
              onInput={(e) => updateConstraint('pattern', (e.target as HTMLInputElement).value || undefined)}
              class="input font-mono text-sm"
              placeholder="e.g., ^[A-Z][a-z]+$"
            />
          </div>
        </div>
      );
    
    case 'number':
      return (
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Min Value
            </label>
            <input
              type="number"
              value={constraints.minValue ?? ''}
              onInput={(e) => updateConstraint('minValue', parseFloat((e.target as HTMLInputElement).value) || undefined)}
              class="input"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Max Value
            </label>
            <input
              type="number"
              value={constraints.maxValue ?? ''}
              onInput={(e) => updateConstraint('maxValue', parseFloat((e.target as HTMLInputElement).value) || undefined)}
              class="input"
            />
          </div>
        </div>
      );
    
    case 'select':
    case 'multiselect':
      return (
        <SelectOptionsEditor
          options={constraints.options || []}
          onChange={(options) => updateConstraint('options', options)}
        />
      );
    
    case 'image':
    case 'logo':
    case 'file':
      return (
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Allowed File Types
            </label>
            <input
              type="text"
              value={(constraints.fileTypes || []).join(', ')}
              onInput={(e) => updateConstraint(
                'fileTypes', 
                (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)
              )}
              class="input"
              placeholder="e.g., image/png, image/jpeg, .pdf"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Max File Size (bytes)
            </label>
            <input
              type="number"
              value={constraints.maxFileSize || ''}
              onInput={(e) => updateConstraint('maxFileSize', parseInt((e.target as HTMLInputElement).value) || undefined)}
              class="input"
              placeholder="e.g., 5242880 (5MB)"
            />
          </div>
        </div>
      );
    
    case 'country':
      return (
        <div class="space-y-3">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeCountryName ?? true}
              onChange={(e) => updateConstraint('includeCountryName', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include country name</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeCountryCode ?? true}
              onChange={(e) => updateConstraint('includeCountryCode', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include country code (ISO)</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeDialCode ?? false}
              onChange={(e) => updateConstraint('includeDialCode', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include dial code</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeFlag ?? true}
              onChange={(e) => updateConstraint('includeFlag', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include flag emoji</span>
          </label>
        </div>
      );
    
    default:
      return null;
  }
}

/**
 * Select Options Editor for select/multiselect fields
 */
function SelectOptionsEditor({ 
  options, 
  onChange 
}: { 
  options: SelectOption[]; 
  onChange: (options: SelectOption[]) => void 
}) {
  const addOption = () => {
    onChange([...options, { value: '', label: '' }]);
  };
  
  const updateOption = (index: number, field: keyof SelectOption, value: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };
  
  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };
  
  return (
    <div>
      <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
        Options
      </label>
      <div class="space-y-2">
        {options.map((option, index) => (
          <div key={index} class="flex items-center gap-2">
            <input
              type="text"
              value={option.value}
              onInput={(e) => updateOption(index, 'value', (e.target as HTMLInputElement).value)}
              class="input flex-1"
              placeholder="Value"
            />
            <input
              type="text"
              value={option.label}
              onInput={(e) => updateOption(index, 'label', (e.target as HTMLInputElement).value)}
              class="input flex-1"
              placeholder="Label"
            />
            <input
              type="color"
              value={option.color || '#6366f1'}
              onInput={(e) => updateOption(index, 'color', (e.target as HTMLInputElement).value)}
              class="w-10 h-10 rounded cursor-pointer"
            />
            <button
              type="button"
              onClick={() => removeOption(index)}
              class="p-2 text-red-500 hover:bg-red-50 rounded"
            >
              <span class="i-lucide-trash-2"></span>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        class="mt-2 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
      >
        <span class="i-lucide-plus"></span>
        Add Option
      </button>
    </div>
  );
}

/**
 * Field Editor Modal
 */
function FieldEditorModal({
  field,
  sections,
  onSave,
  onClose
}: {
  field: Partial<FieldDefinition> | null;
  sections: FieldSection[];
  onSave: (field: Partial<FieldDefinition>) => void;
  onClose: () => void;
}) {
  const [editingField, setEditingField] = useState<Partial<FieldDefinition>>(
    field || { ...defaultField, sectionId: sections[0]?.id || '' }
  );
  
  if (!field && !editingField) return null;
  
  const handleSave = () => {
    if (!editingField.name || !editingField.type) return;
    onSave(editingField);
  };
  
  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        class="bg-white dark:bg-surface-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="p-6 border-b border-surface-200 dark:border-surface-700">
          <h2 class="heading-3">{field?.id ? 'Edit Field' : 'Add Field'}</h2>
        </div>
        
        <div class="p-6 space-y-6">
          {/* Field Name */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Field Name <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={editingField.name || ''}
              onInput={(e) => setEditingField({ ...editingField, name: (e.target as HTMLInputElement).value })}
              class="input"
              placeholder="e.g., Company Name"
            />
          </div>
          
          {/* Field Type */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Field Type <span class="text-red-500">*</span>
            </label>
            <FieldTypeSelector
              value={editingField.type || 'string'}
              onChange={(type) => setEditingField({ ...editingField, type, constraints: {} })}
            />
          </div>
          
          {/* Section */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Section
            </label>
            <select
              value={editingField.sectionId || ''}
              onChange={(e) => setEditingField({ ...editingField, sectionId: (e.target as HTMLSelectElement).value })}
              class="input"
            >
              {sections.map(section => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
          
          {/* Description */}
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Help Text
            </label>
            <input
              type="text"
              value={editingField.description || ''}
              onInput={(e) => setEditingField({ ...editingField, description: (e.target as HTMLInputElement).value })}
              class="input"
              placeholder="Describe what this field is for"
            />
          </div>
          
          {/* Options */}
          <div class="flex flex-wrap gap-4">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editingField.required || false}
                onChange={(e) => setEditingField({ ...editingField, required: (e.target as HTMLInputElement).checked })}
                class="w-4 h-4 rounded"
              />
              <span class="text-sm text-surface-700 dark:text-surface-300">Required</span>
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editingField.showInTable || false}
                onChange={(e) => setEditingField({ ...editingField, showInTable: (e.target as HTMLInputElement).checked })}
                class="w-4 h-4 rounded"
              />
              <span class="text-sm text-surface-700 dark:text-surface-300">Show in table view</span>
            </label>
          </div>
          
          {/* Type-specific constraints */}
          {editingField.type && ['string', 'text', 'markdown', 'number', 'select', 'multiselect', 'image', 'logo', 'file', 'country'].includes(editingField.type) && (
            <div class="pt-4 border-t border-surface-200 dark:border-surface-700">
              <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-3">Constraints</h4>
              <FieldConstraintsEditor
                field={editingField}
                onChange={(constraints) => setEditingField({ ...editingField, constraints })}
              />
            </div>
          )}
        </div>
        
        <div class="p-6 border-t border-surface-200 dark:border-surface-700 flex justify-end gap-3">
          <button type="button" onClick={onClose} class="btn-ghost">Cancel</button>
          <button 
            type="button" 
            onClick={handleSave} 
            class="btn-primary"
            disabled={!editingField.name}
          >
            {field?.id ? 'Update Field' : 'Add Field'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main Type Builder Component
 */
export function TypeBuilder({ id }: TypeBuilderProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [name, setName] = useState('');
  const [pluralName, setPluralName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [allowPublic, setAllowPublic] = useState(false);
  const [defaultVisibility, setDefaultVisibility] = useState<'public' | 'platform' | 'private'>('platform');
  const [sections, setSections] = useState<FieldSection[]>([
    { id: 'main', name: 'Main Information', displayOrder: 0 }
  ]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [editingField, setEditingField] = useState<Partial<FieldDefinition> | null>(null);
  const [showFieldModal, setShowFieldModal] = useState(false);
  
  const isNew = !id;
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load existing type
  useEffect(() => {
    if (id && isSuperadmin.value) {
      loadType(id);
    }
  }, [id, isSuperadmin.value]);
  
  // Auto-generate slug from name
  useEffect(() => {
    if (isNew && name && !slug) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  }, [name, isNew]);
  
  // Auto-generate plural from name
  useEffect(() => {
    if (isNew && name && !pluralName) {
      setPluralName(name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
    }
  }, [name, isNew]);
  
  async function loadType(typeId: string) {
    setLoading(true);
    const response = await api.get(`/api/entity-types/${typeId}`) as { success: boolean; data?: EntityType };
    
    if (response.success && response.data) {
      const type = response.data;
      setName(type.name);
      setPluralName(type.pluralName);
      setSlug(type.slug);
      setDescription(type.description || '');
      setAllowPublic(type.allowPublic);
      setDefaultVisibility(type.defaultVisibility);
      setSections(type.sections);
      setFields(type.fields);
    }
    setLoading(false);
  }
  
  function handleAddSection() {
    const newSection: FieldSection = {
      id: `section_${Date.now()}`,
      name: `Section ${sections.length + 1}`,
      displayOrder: sections.length
    };
    setSections([...sections, newSection]);
  }
  
  function handleUpdateSection(index: number, updates: Partial<FieldSection>) {
    const updated = [...sections];
    updated[index] = { ...updated[index], ...updates };
    setSections(updated);
  }
  
  function handleRemoveSection(index: number) {
    if (sections.length <= 1) return;
    const sectionId = sections[index].id;
    // Move fields to first section
    setFields(fields.map(f => f.sectionId === sectionId ? { ...f, sectionId: sections[0].id } : f));
    setSections(sections.filter((_, i) => i !== index));
  }
  
  function handleAddField() {
    setEditingField({ ...defaultField, sectionId: sections[0]?.id || '' });
    setShowFieldModal(true);
  }
  
  function handleEditField(field: FieldDefinition) {
    setEditingField(field);
    setShowFieldModal(true);
  }
  
  function handleSaveField(fieldData: Partial<FieldDefinition>) {
    if (fieldData.id) {
      // Update existing
      setFields(fields.map(f => f.id === fieldData.id ? { ...f, ...fieldData } as FieldDefinition : f));
    } else {
      // Add new
      const newField: FieldDefinition = {
        ...fieldData,
        id: `field_${Date.now()}`,
        displayOrder: fields.length
      } as FieldDefinition;
      setFields([...fields, newField]);
    }
    setShowFieldModal(false);
    setEditingField(null);
  }
  
  function handleRemoveField(fieldId: string) {
    setFields(fields.filter(f => f.id !== fieldId));
  }
  
  async function handleSave() {
    if (!name || !slug || !pluralName || fields.length === 0) {
      setError('Please fill in all required fields and add at least one field');
      return;
    }
    
    setSaving(true);
    setError(null);
    
    const payload = {
      name,
      pluralName,
      slug,
      description: description || undefined,
      allowPublic,
      defaultVisibility,
      sections: sections.map(({ id, ...s }) => s),
      fields: fields.map(({ id, ...f }) => f)
    };
    
    const response = isNew
      ? await api.post('/api/entity-types', payload)
      : await api.patch(`/api/entity-types/${id}`, payload);
    
    if (response.success) {
      route('/super/types');
    } else {
      setError(response.error?.message || 'Failed to save entity type');
    }
    
    setSaving(false);
  }
  
  if (authLoading.value || loading) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="mb-8">
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
          <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
          <span class="i-lucide-chevron-right"></span>
          <a href="/super/types" class="hover:text-surface-700 dark:hover:text-surface-200">Entity Types</a>
          <span class="i-lucide-chevron-right"></span>
          <span class="text-surface-900 dark:text-surface-100">{isNew ? 'Create' : 'Edit'}</span>
        </nav>
        <h1 class="heading-1">{isNew ? 'Create Entity Type' : `Edit ${name}`}</h1>
      </div>
      
      {error && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          <span class="i-lucide-alert-circle mr-2"></span>
          {error}
        </div>
      )}
      
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column - Basic info */}
        <div class="lg:col-span-1 space-y-6">
          <div class="card p-6">
            <h2 class="heading-4 mb-4">Basic Information</h2>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Name (Singular) <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  class="input"
                  placeholder="e.g., Tool"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Name (Plural) <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pluralName}
                  onInput={(e) => setPluralName((e.target as HTMLInputElement).value)}
                  class="input"
                  placeholder="e.g., Tools"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  URL Slug <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={slug}
                  onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  class="input font-mono"
                  placeholder="e.g., tools"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                  class="input"
                  rows={3}
                  placeholder="Describe this entity type..."
                />
              </div>
            </div>
          </div>
          
          <div class="card p-6">
            <h2 class="heading-4 mb-4">Visibility Settings</h2>
            
            <div class="space-y-4">
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allowPublic}
                  onChange={(e) => setAllowPublic((e.target as HTMLInputElement).checked)}
                  class="w-5 h-5 rounded"
                />
                <div>
                  <span class="text-surface-900 dark:text-surface-100 font-medium">Allow Public Visibility</span>
                  <p class="text-sm text-surface-500">Entities can be published publicly</p>
                </div>
              </label>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Default Visibility
                </label>
                <select
                  value={defaultVisibility}
                  onChange={(e) => setDefaultVisibility((e.target as HTMLSelectElement).value as 'public' | 'platform' | 'private')}
                  class="input"
                >
                  <option value="private">Private (Organization only)</option>
                  <option value="platform">Platform (All authenticated users)</option>
                  {allowPublic && <option value="public">Public (Everyone)</option>}
                </select>
              </div>
            </div>
          </div>
        </div>
        
        {/* Right column - Sections & Fields */}
        <div class="lg:col-span-2 space-y-6">
          {/* Sections */}
          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="heading-4">Sections</h2>
              <button type="button" onClick={handleAddSection} class="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <span class="i-lucide-plus"></span>
                Add Section
              </button>
            </div>
            
            <div class="space-y-3">
              {sections.map((section, index) => (
                <div key={section.id} class="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <span class="i-lucide-grip-vertical text-surface-400 cursor-move"></span>
                  <input
                    type="text"
                    value={section.name}
                    onInput={(e) => handleUpdateSection(index, { name: (e.target as HTMLInputElement).value })}
                    class="input flex-1"
                    placeholder="Section name"
                  />
                  {sections.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSection(index)}
                      class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <span class="i-lucide-trash-2"></span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Fields */}
          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="heading-4">Fields ({fields.length})</h2>
              <button type="button" onClick={handleAddField} class="btn-primary text-sm">
                <span class="i-lucide-plus mr-1"></span>
                Add Field
              </button>
            </div>
            
            {fields.length > 0 ? (
              <div class="space-y-3">
                {sections.map(section => {
                  const sectionFields = fields.filter(f => f.sectionId === section.id);
                  if (sectionFields.length === 0) return null;
                  
                  return (
                    <div key={section.id}>
                      <h4 class="text-sm font-medium text-surface-500 mb-2">{section.name}</h4>
                      <div class="space-y-2">
                        {sectionFields.map(field => (
                          <div 
                            key={field.id}
                            class="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                          >
                            <span class="i-lucide-grip-vertical text-surface-400 cursor-move"></span>
                            <div class="flex-1">
                              <div class="flex items-center gap-2">
                                <span class="font-medium text-surface-900 dark:text-surface-100">{field.name}</span>
                                {field.required && <span class="text-red-500 text-xs">Required</span>}
                              </div>
                              <span class="text-sm text-surface-500">{field.type}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleEditField(field)}
                              class="p-2 text-surface-500 hover:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 rounded"
                            >
                              <span class="i-lucide-pencil"></span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveField(field.id)}
                              class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <span class="i-lucide-trash-2"></span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div class="text-center py-8">
                <span class="i-lucide-layers text-4xl text-surface-300 mb-2"></span>
                <p class="text-surface-500">No fields yet. Add your first field above.</p>
              </div>
            )}
          </div>
          
          {/* Actions */}
          <div class="flex items-center justify-between pt-4">
            <a href="/super/types" class="btn-ghost">Cancel</a>
            <button
              type="button"
              onClick={handleSave}
              class="btn-primary"
              disabled={saving || !name || !slug || fields.length === 0}
            >
              {saving ? (
                <>
                  <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                  Saving...
                </>
              ) : (
                <>
                  <span class="i-lucide-save mr-2"></span>
                  {isNew ? 'Create Type' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      
      {/* Field Editor Modal */}
      {showFieldModal && (
        <FieldEditorModal
          field={editingField}
          sections={sections}
          onSave={handleSaveField}
          onClose={() => {
            setShowFieldModal(false);
            setEditingField(null);
          }}
        />
      )}
    </div>
  );
}
