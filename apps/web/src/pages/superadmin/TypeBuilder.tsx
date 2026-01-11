/**
 * Type Builder Page
 * 
 * Visual editor for creating and editing entity types.
 * Includes drag-and-drop field ordering and constraint configuration.
 * 
 * Features:
 * - Visual field type selector with icons
 * - Section management with reordering
 * - Field constraints editor (min/max, options, file types, etc.)
 * - Preview panel showing form layout
 * - Auto-generated slug and plural names
 */

import { useEffect, useState, useMemo } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import type { EntityType, FieldDefinition, FieldSection, FieldType, SelectOption, EntityTypeListItem } from '@1cc/shared';
import { FIELD_TYPES } from '@1cc/shared';

// Props interface for the TypeBuilder component
interface TypeBuilderProps {
  id?: string;
}

// Generate a valid snake_case ID from a name
function generateId(name: string, prefix: string = ''): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 30);
  
  // Add a short timestamp suffix to ensure uniqueness
  const suffix = Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${base}_${suffix}` : `${base}_${suffix}`;
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

// Field type metadata with labels, icons, and descriptions
const FIELD_TYPE_META: Record<FieldType, { label: string; icon: string; description: string }> = {
  string: { 
    label: 'Short Text', 
    icon: 'i-lucide-type', 
    description: 'Single line of text' 
  },
  text: { 
    label: 'Long Text', 
    icon: 'i-lucide-align-left', 
    description: 'Multi-line textarea' 
  },
  markdown: { 
    label: 'Rich Text', 
    icon: 'i-lucide-file-text', 
    description: 'Markdown formatted content' 
  },
  number: { 
    label: 'Number', 
    icon: 'i-lucide-hash', 
    description: 'Numeric value' 
  },
  boolean: { 
    label: 'Toggle', 
    icon: 'i-lucide-toggle-left', 
    description: 'Yes/No switch' 
  },
  date: { 
    label: 'Date', 
    icon: 'i-lucide-calendar', 
    description: 'Date picker' 
  },
  select: { 
    label: 'Dropdown', 
    icon: 'i-lucide-chevron-down', 
    description: 'Single selection from options' 
  },
  multiselect: { 
    label: 'Multi-Select', 
    icon: 'i-lucide-list-checks', 
    description: 'Multiple selections from options' 
  },
  link: { 
    label: 'Entity Link', 
    icon: 'i-lucide-link', 
    description: 'Reference to another entity' 
  },
  image: { 
    label: 'Image', 
    icon: 'i-lucide-image', 
    description: 'Image upload with preview' 
  },
  logo: { 
    label: 'Logo', 
    icon: 'i-lucide-badge', 
    description: 'Logo/avatar image' 
  },
  file: { 
    label: 'File', 
    icon: 'i-lucide-file-up', 
    description: 'File attachment' 
  },
  country: { 
    label: 'Country', 
    icon: 'i-lucide-globe', 
    description: 'Country selector with flags' 
  }
};

/**
 * Field Type Selector Component
 * Displays a grid of field type options with icons and descriptions
 */
function FieldTypeSelector({ 
  value, 
  onChange 
}: { 
  value: FieldType; 
  onChange: (type: FieldType) => void 
}) {
  console.log('[FieldTypeSelector] Rendering with value:', value);
  
  return (
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {(FIELD_TYPES as readonly FieldType[]).map(type => {
        const meta = FIELD_TYPE_META[type];
        const isSelected = value === type;
        
        return (
          <button
            key={type}
            type="button"
            onClick={() => {
              console.log('[FieldTypeSelector] Selected type:', type);
              onChange(type);
            }}
            class={`p-3 rounded-lg border text-left transition-all group ${
              isSelected 
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-500' 
                : 'border-surface-200 dark:border-surface-700 hover:border-primary-300 hover:bg-surface-50 dark:hover:bg-surface-800'
            }`}
          >
            <div class="flex items-center gap-2 mb-1">
              <span class={`${meta.icon} text-lg ${
                isSelected ? 'text-primary-600' : 'text-surface-500 group-hover:text-primary-500'
              }`}></span>
            </div>
            <p class={`text-xs font-medium ${
              isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100'
            }`}>
              {meta.label}
            </p>
            <p class="text-xs text-surface-500 mt-0.5 line-clamp-1">{meta.description}</p>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Field Constraints Editor Component
 * Renders type-specific constraint inputs
 */
function FieldConstraintsEditor({ 
  field, 
  entityTypes,
  onChange 
}: { 
  field: Partial<FieldDefinition>; 
  entityTypes: EntityTypeListItem[];
  onChange: (constraints: FieldDefinition['constraints']) => void 
}) {
  const constraints = field.constraints || {};
  
  // Helper to update a single constraint value
  const updateConstraint = (key: string, value: unknown) => {
    console.log('[FieldConstraintsEditor] Updating constraint:', key, value);
    onChange({ ...constraints, [key]: value });
  };
  
  // Render different constraint editors based on field type
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
                placeholder="0"
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
                placeholder="No limit"
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
            <p class="text-xs text-surface-500 mt-1">Regular expression to validate input</p>
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
              placeholder="No minimum"
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
              placeholder="No maximum"
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
    
    case 'link':
      return (
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Link to Entity Type
            </label>
            <select
              value={constraints.linkEntityTypeId || ''}
              onChange={(e) => updateConstraint('linkEntityTypeId', (e.target as HTMLSelectElement).value || undefined)}
              class="input"
            >
              <option value="">Select entity type...</option>
              {entityTypes.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
            <p class="text-xs text-surface-500 mt-1">Which type of entity can be linked</p>
          </div>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.allowMultiple ?? false}
              onChange={(e) => updateConstraint('allowMultiple', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded border-surface-300"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Allow multiple links</span>
          </label>
        </div>
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
              placeholder={field.type === 'file' ? 'e.g., .pdf, .doc, .docx' : 'e.g., image/png, image/jpeg, .webp'}
            />
            <p class="text-xs text-surface-500 mt-1">Comma-separated MIME types or extensions</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Max File Size
            </label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                value={constraints.maxFileSize ? constraints.maxFileSize / 1048576 : ''}
                onInput={(e) => {
                  const mb = parseFloat((e.target as HTMLInputElement).value);
                  updateConstraint('maxFileSize', mb ? Math.round(mb * 1048576) : undefined);
                }}
                class="input flex-1"
                min="0.1"
                step="0.1"
                placeholder="5"
              />
              <span class="text-surface-500 text-sm">MB</span>
            </div>
          </div>
        </div>
      );
    
    case 'country':
      return (
        <div class="space-y-3">
          <p class="text-sm text-surface-600 dark:text-surface-400 mb-3">
            Configure what country data to store:
          </p>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeCountryName ?? true}
              onChange={(e) => updateConstraint('includeCountryName', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded border-surface-300"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include country name</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeCountryCode ?? true}
              onChange={(e) => updateConstraint('includeCountryCode', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded border-surface-300"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include country code (ISO)</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeDialCode ?? false}
              onChange={(e) => updateConstraint('includeDialCode', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded border-surface-300"
            />
            <span class="text-sm text-surface-700 dark:text-surface-300">Include dial code (+1, +44, etc.)</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={constraints.includeFlag ?? true}
              onChange={(e) => updateConstraint('includeFlag', (e.target as HTMLInputElement).checked)}
              class="w-4 h-4 rounded border-surface-300"
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
  // Add a new empty option
  const addOption = () => {
    console.log('[SelectOptionsEditor] Adding new option');
    onChange([...options, { value: '', label: '' }]);
  };
  
  // Update a specific field in an option
  const updateOption = (index: number, field: keyof SelectOption, value: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };
  
  // Auto-fill value from label if empty
  const autoFillValue = (index: number, label: string) => {
    if (!options[index].value && label) {
      const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      updateOption(index, 'value', value);
    }
  };
  
  // Remove an option
  const removeOption = (index: number) => {
    console.log('[SelectOptionsEditor] Removing option at index:', index);
    onChange(options.filter((_, i) => i !== index));
  };
  
  return (
    <div>
      <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
        Options
      </label>
      <div class="space-y-2">
        {options.map((option, index) => (
          <div key={index} class="flex items-center gap-2 animate-fade-in">
            <input
              type="text"
              value={option.label}
              onInput={(e) => updateOption(index, 'label', (e.target as HTMLInputElement).value)}
              onBlur={(e) => autoFillValue(index, (e.target as HTMLInputElement).value)}
              class="input flex-1"
              placeholder="Display label"
            />
            <input
              type="text"
              value={option.value}
              onInput={(e) => updateOption(index, 'value', (e.target as HTMLInputElement).value)}
              class="input flex-1 font-mono text-sm"
              placeholder="value_key"
            />
            <input
              type="color"
              value={option.color || '#6366f1'}
              onInput={(e) => updateOption(index, 'color', (e.target as HTMLInputElement).value)}
              class="w-10 h-10 rounded cursor-pointer border border-surface-200 dark:border-surface-700"
              title="Badge color"
            />
            <button
              type="button"
              onClick={() => removeOption(index)}
              class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              title="Remove option"
            >
              <span class="i-lucide-trash-2"></span>
            </button>
          </div>
        ))}
      </div>
      
      {options.length === 0 && (
        <p class="text-sm text-surface-500 py-4 text-center bg-surface-50 dark:bg-surface-800 rounded-lg">
          No options defined. Add at least one option.
        </p>
      )}
      
      <button
        type="button"
        onClick={addOption}
        class="mt-3 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
      >
        <span class="i-lucide-plus"></span>
        Add Option
      </button>
    </div>
  );
}

/**
 * Field Editor Modal
 * Full-featured editor for creating and editing field definitions
 */
function FieldEditorModal({
  field,
  sections,
  entityTypes,
  onSave,
  onClose
}: {
  field: Partial<FieldDefinition> | null;
  sections: FieldSection[];
  entityTypes: EntityTypeListItem[];
  onSave: (field: Partial<FieldDefinition>) => void;
  onClose: () => void;
}) {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'FieldEditorModal:520',message:'FieldEditorModal rendered',data:{fieldId:field?.id,fieldName:field?.name,hasField:!!field},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C,E'})}).catch(()=>{});
  // #endregion
  const [editingField, setEditingField] = useState<Partial<FieldDefinition>>(
    field || { ...defaultField, sectionId: sections[0]?.id || '' }
  );
  
  // Sync local state when the field prop changes (e.g., when editing a different field)
  // Only depend on field.id to avoid resetting when other things change
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'FieldEditorModal:526',message:'useEffect triggered',data:{fieldId:field?.id,fieldName:field?.name,hasField:!!field},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    if (field) {
      console.log('[FieldEditorModal] Field prop changed, syncing state:', field.name, field.id);
      setEditingField({ ...field });
    } else {
      console.log('[FieldEditorModal] No field, setting defaults');
      setEditingField({ ...defaultField, sectionId: sections[0]?.id || '' });
    }
  }, [field?.id]); // Only re-sync when field ID changes
  
  console.log('[FieldEditorModal] Current editing field:', editingField.name, editingField.id);
  
  if (!field && !editingField) return null;
  
  // Handle save with validation
  const handleSave = () => {
    if (!editingField.name || !editingField.type) {
      console.warn('[FieldEditorModal] Cannot save - missing required fields');
      return;
    }
    console.log('[FieldEditorModal] Saving field:', editingField);
    onSave(editingField);
  };
  
  // Check if field type has constraints
  const hasConstraints = editingField.type && [
    'string', 'text', 'markdown', 'number', 'select', 'multiselect', 
    'image', 'logo', 'file', 'country', 'link'
  ].includes(editingField.type);
  
  return (
    <div 
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in" 
      onClick={onClose}
    >
      <div 
        class="bg-white dark:bg-surface-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="p-6 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <h2 class="heading-3">{field?.id ? 'Edit Field' : 'Add New Field'}</h2>
          <button
            type="button"
            onClick={onClose}
            class="p-2 text-surface-500 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg transition-colors"
          >
            <span class="i-lucide-x text-xl"></span>
          </button>
        </div>
        
        {/* Content */}
        <div class="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Check if this is a built-in field */}
          {(() => {
            const isBuiltInField = editingField.id === 'entity_name' || editingField.id === 'entity_slug';
            return (
              <>
                {/* Field Name */}
                <div>
                  <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                    Field Name <span class="text-red-500">*</span>
                    {isBuiltInField && (
                      <span class="ml-2 text-xs text-primary-600">(Built-in field)</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={editingField.name || ''}
                    onInput={(e) => setEditingField({ ...editingField, name: (e.target as HTMLInputElement).value })}
                    class="input"
                    placeholder="e.g., Company Name"
                    autoFocus
                    disabled={isBuiltInField}
                  />
                  {isBuiltInField && (
                    <p class="text-xs text-surface-500 mt-1">Built-in field names cannot be changed</p>
                  )}
                </div>
                
                {/* Field Type - disabled for built-in fields */}
                <div>
                  <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                    Field Type <span class="text-red-500">*</span>
                  </label>
                  {isBuiltInField ? (
                    <div class="p-3 bg-surface-100 dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                      <span class="text-surface-600 dark:text-surface-400">
                        {FIELD_TYPE_META[editingField.type || 'string'].label} (cannot be changed for built-in fields)
                      </span>
                    </div>
                  ) : (
                    <FieldTypeSelector
                      value={editingField.type || 'string'}
                      onChange={(type) => setEditingField({ ...editingField, type, constraints: {} })}
                    />
                  )}
                </div>
              </>
            );
          })()}
          
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
              placeholder="Describe what this field is for..."
            />
            <p class="text-xs text-surface-500 mt-1">Shown below the field as guidance for editors</p>
          </div>
          
          {/* Options */}
          <div class="flex flex-wrap gap-6">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingField.required || false}
                onChange={(e) => setEditingField({ ...editingField, required: (e.target as HTMLInputElement).checked })}
                class="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
              />
              <span class="text-sm text-surface-700 dark:text-surface-300">Required field</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingField.showInTable || false}
                onChange={(e) => setEditingField({ ...editingField, showInTable: (e.target as HTMLInputElement).checked })}
                class="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
              />
              <span class="text-sm text-surface-700 dark:text-surface-300">Show in table view</span>
            </label>
          </div>
          
          {/* Type-specific constraints */}
          {hasConstraints && (
            <div class="pt-4 border-t border-surface-200 dark:border-surface-700">
              <h4 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                <span class="i-lucide-settings-2"></span>
                Field Constraints
              </h4>
              <FieldConstraintsEditor
                field={editingField}
                entityTypes={entityTypes}
                onChange={(constraints) => setEditingField({ ...editingField, constraints })}
              />
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div class="p-6 border-t border-surface-200 dark:border-surface-700 flex justify-end gap-3 bg-surface-50 dark:bg-surface-900">
          <button type="button" onClick={onClose} class="btn-ghost">
            Cancel
          </button>
          <button 
            type="button" 
            onClick={handleSave} 
            class="btn-primary"
            disabled={!editingField.name || !editingField.type}
          >
            <span class={`mr-2 ${field?.id ? 'i-lucide-check' : 'i-lucide-plus'}`}></span>
            {field?.id ? 'Update Field' : 'Add Field'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Preview Panel Component
 * Shows how the entity form will look with current fields
 */
function PreviewPanel({ 
  sections, 
  fields,
  typeName
}: { 
  sections: FieldSection[]; 
  fields: FieldDefinition[];
  typeName: string;
}) {
  return (
    <div class="card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="heading-4 flex items-center gap-2">
          <span class="i-lucide-eye"></span>
          Form Preview
        </h3>
      </div>
      
      {fields.length === 0 ? (
        <div class="text-center py-8 bg-surface-50 dark:bg-surface-900 rounded-lg">
          <span class="i-lucide-layout-list text-3xl text-surface-300 mb-2"></span>
          <p class="text-sm text-surface-500">Add fields to see preview</p>
        </div>
      ) : (
        <div class="border border-surface-200 dark:border-surface-700 rounded-lg p-4 bg-surface-50 dark:bg-surface-900 space-y-6">
          {/* Mock header */}
          <div class="border-b border-surface-200 dark:border-surface-700 pb-4">
            <div class="h-3 w-24 bg-surface-200 dark:bg-surface-700 rounded mb-2"></div>
            <div class="h-5 w-48 bg-surface-300 dark:bg-surface-600 rounded"></div>
          </div>
          
          {/* Sections with fields */}
          {sections.map(section => {
            // Use the passed 'fields' prop to filter section fields
            const sectionFields = fields.filter(f => f.sectionId === section.id);
            if (sectionFields.length === 0) return null;
            
            return (
              <div key={section.id} class="space-y-3">
                <h5 class="text-xs font-semibold text-surface-500 uppercase tracking-wider">
                  {section.name}
                </h5>
                <div class="space-y-3">
                  {sectionFields.map(field => (
                    <div key={field.id} class="space-y-1">
                      <div class="flex items-center gap-1">
                        <span class={`${FIELD_TYPE_META[field.type].icon} text-xs text-surface-400`}></span>
                        <span class="text-xs font-medium text-surface-600 dark:text-surface-400">
                          {field.name}
                          {field.required && <span class="text-red-500 ml-0.5">*</span>}
                        </span>
                      </div>
                      {/* Field placeholder based on type */}
                      {field.type === 'boolean' ? (
                        <div class="h-6 w-12 bg-surface-200 dark:bg-surface-700 rounded-full"></div>
                      ) : field.type === 'text' || field.type === 'markdown' ? (
                        <div class="h-16 bg-surface-200 dark:bg-surface-700 rounded"></div>
                      ) : (
                        <div class="h-8 bg-surface-200 dark:bg-surface-700 rounded"></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Main Type Builder Component
 * Visual editor for creating and editing entity types
 */
export function TypeBuilder({ id }: TypeBuilderProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  // Default fields that every entity type must have (name and slug)
  // These are used as templates for new entity types
  // IMPORTANT: Field IDs 'name' and 'slug' are standard across all entity types
  const getDefaultEntityFields = (mainSectionId: string): FieldDefinition[] => [
    {
      id: 'name',
      name: 'Name',
      type: 'string',
      required: true,
      description: 'Display name for this entity',
      displayOrder: 0,
      sectionId: mainSectionId,
      showInTable: true,
      constraints: { minLength: 1, maxLength: 200 }
    },
    {
      id: 'slug',
      name: 'Slug',
      type: 'string',
      required: true,
      description: 'URL-friendly identifier (auto-generated from name)',
      displayOrder: 1,
      sectionId: mainSectionId,
      showInTable: false,
      constraints: { pattern: '^[-a-z0-9]+$' }
    }
  ];
  
  // Form state
  const [name, setName] = useState('');
  const [pluralName, setPluralName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [defaultVisibility, setDefaultVisibility] = useState<'public' | 'authenticated' | 'members'>('authenticated');
  const [sections, setSections] = useState<FieldSection[]>([
    { id: 'main', name: 'Main Information', displayOrder: 0 }
  ]);
  // ALL fields including built-in name/slug (they have special IDs: entity_name, entity_slug)
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  
  // UI state
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Modal state
  const [editingField, setEditingField] = useState<Partial<FieldDefinition> | null>(null);
  const [showFieldModal, setShowFieldModal] = useState(false);
  
  // Available entity types for link fields
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  
  // Track if slug was manually edited
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  
  const isNew = !id;
  
  console.log('[TypeBuilder] Rendering. isNew:', isNew, 'id:', id);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[TypeBuilder] Not authorized, redirecting to home');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Initialize default fields for new entity types
  useEffect(() => {
    if (isNew && fields.length === 0) {
      console.log('[TypeBuilder] Initializing default fields for new type');
      setFields(getDefaultEntityFields('main'));
    }
  }, [isNew]);
  
  // Load existing type for editing
  useEffect(() => {
    if (id && isSuperadmin.value) {
      console.log('[TypeBuilder] Loading type:', id);
      loadType(id);
    }
  }, [id, isSuperadmin.value]);
  
  // Load available entity types for link constraints
  useEffect(() => {
    if (isSuperadmin.value) {
      loadEntityTypes();
    }
  }, [isSuperadmin.value]);
  
  // Auto-generate slug from name
  useEffect(() => {
    if (isNew && name && !slugManuallyEdited) {
      const generatedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      console.log('[TypeBuilder] Auto-generated slug:', generatedSlug);
      setSlug(generatedSlug);
    }
  }, [name, isNew, slugManuallyEdited]);
  
  // Auto-generate plural from name
  useEffect(() => {
    if (isNew && name && !pluralName) {
      const generated = name.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some(v => name.endsWith(v))
        ? name.slice(0, -1) + 'ies' 
        : name + 's';
      console.log('[TypeBuilder] Auto-generated plural:', generated);
      setPluralName(generated);
    }
  }, [name, isNew]);
  
  // Load entity types for link field configuration
  async function loadEntityTypes() {
    console.log('[TypeBuilder] Loading entity types');
    const response = await api.get('/api/entity-types') as { success: boolean; data?: { items: EntityTypeListItem[] } };
    
    if (response.success && response.data) {
      setEntityTypes(response.data.items);
      console.log('[TypeBuilder] Loaded entity types:', response.data.items.length);
    }
  }
  
  // Load existing type data
  async function loadType(typeId: string) {
    setLoading(true);
    console.log('[TypeBuilder] Fetching type:', typeId);
    
    const response = await api.get(`/api/entity-types/${typeId}`) as { success: boolean; data?: EntityType };
    
    if (response.success && response.data) {
      const type = response.data;
      console.log('[TypeBuilder] Loaded type:', type.name);
      
      setName(type.name);
      setPluralName(type.pluralName);
      setSlug(type.slug);
      setSlugManuallyEdited(true); // Don't auto-update slug when editing
      setDescription(type.description || '');
      setDefaultVisibility(type.defaultVisibility as 'public' | 'authenticated' | 'members');
      setSections(type.sections);
      // Load ALL fields including built-in ones
      setFields(type.fields);
    } else {
      setError('Failed to load entity type');
      console.error('[TypeBuilder] Failed to load type');
    }
    
    setLoading(false);
  }
  
  // Add a new section
  function handleAddSection() {
    const newSection: FieldSection = {
      id: generateId('section', 'sec'),
      name: `Section ${sections.length + 1}`,
      displayOrder: sections.length
    };
    console.log('[TypeBuilder] Adding section:', newSection);
    setSections([...sections, newSection]);
  }
  
  // Update section properties
  function handleUpdateSection(index: number, updates: Partial<FieldSection>) {
    const updated = [...sections];
    updated[index] = { ...updated[index], ...updates };
    setSections(updated);
  }
  
  // Remove a section and move its fields
  function handleRemoveSection(index: number) {
    if (sections.length <= 1) {
      console.warn('[TypeBuilder] Cannot remove last section');
      return;
    }
    
    const sectionId = sections[index].id;
    console.log('[TypeBuilder] Removing section:', sectionId);
    
    // Move fields from removed section to first remaining section
    const remainingSections = sections.filter((_, i) => i !== index);
    const targetSectionId = remainingSections[0].id;
    
    setFields(fields.map(f => 
      f.sectionId === sectionId ? { ...f, sectionId: targetSectionId } : f
    ));
    setSections(remainingSections);
  }
  
  // Move section up/down
  function handleMoveSection(index: number, direction: 'up' | 'down') {
    if (
      (direction === 'up' && index === 0) || 
      (direction === 'down' && index === sections.length - 1)
    ) {
      return;
    }
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...sections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    
    // Update display orders
    updated.forEach((s, i) => s.displayOrder = i);
    
    setSections(updated);
    console.log('[TypeBuilder] Moved section', direction);
  }
  
  // Open modal to add new field
  function handleAddField() {
    console.log('[TypeBuilder] Opening add field modal');
    // Use a timestamp-based temporary ID to ensure the modal gets a new key
    setEditingField({ ...defaultField, id: `new-${Date.now()}`, sectionId: sections[0]?.id || '' });
    setShowFieldModal(true);
  }
  
  // Open modal to edit existing field
  function handleEditField(field: FieldDefinition) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1016',message:'handleEditField called',data:{fieldId:field.id,fieldName:field.name,fieldType:field.type,hasId:!!field.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
    // #endregion
    console.log('[TypeBuilder] Opening edit field modal:', field.name);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1018',message:'Before setEditingField',data:{showFieldModal,editingFieldId:editingField?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    setEditingField({ ...field });
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1019',message:'Before setShowFieldModal',data:{fieldId:field.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    setShowFieldModal(true);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1020',message:'After setShowFieldModal',data:{fieldId:field.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
  }
  
  // Save field from modal
  function handleSaveField(fieldData: Partial<FieldDefinition>) {
    console.log('[TypeBuilder] Saving field:', fieldData);
    
    // Check if this is a new field (temporary ID starts with 'new-') or existing field
    const isNewField = !fieldData.id || fieldData.id.startsWith('new-');
    
    if (!isNewField) {
      // Update existing field (including built-in fields)
      console.log('[TypeBuilder] Updating existing field:', fieldData.id);
      setFields(fields.map(f => 
        f.id === fieldData.id ? { ...f, ...fieldData } as FieldDefinition : f
      ));
    } else {
      // Add new field with generated ID
      console.log('[TypeBuilder] Adding new field');
      const newField: FieldDefinition = {
        ...fieldData,
        id: generateId(fieldData.name || 'field', 'fld'),
        displayOrder: fields.length
      } as FieldDefinition;
      setFields([...fields, newField]);
    }
    
    setShowFieldModal(false);
    setEditingField(null);
  }
  
  // Remove a field (built-in fields cannot be removed)
  function handleRemoveField(fieldId: string) {
    // Don't allow removing built-in fields
    if (fieldId === 'entity_name' || fieldId === 'entity_slug') {
      console.warn('[TypeBuilder] Cannot remove built-in field:', fieldId);
      return;
    }
    console.log('[TypeBuilder] Removing field:', fieldId);
    setFields(fields.filter(f => f.id !== fieldId));
  }
  
  // Move field up/down within section
  function handleMoveField(fieldId: string, direction: 'up' | 'down') {
    const fieldIndex = fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;
    
    const field = fields[fieldIndex];
    const sectionFields = fields.filter(f => f.sectionId === field.sectionId);
    const indexInSection = sectionFields.findIndex(f => f.id === fieldId);
    
    if (
      (direction === 'up' && indexInSection === 0) || 
      (direction === 'down' && indexInSection === sectionFields.length - 1)
    ) {
      return;
    }
    
    // Swap display orders
    const swapIndex = direction === 'up' ? indexInSection - 1 : indexInSection + 1;
    const swapField = sectionFields[swapIndex];
    
    setFields(fields.map(f => {
      if (f.id === fieldId) return { ...f, displayOrder: swapField.displayOrder };
      if (f.id === swapField.id) return { ...f, displayOrder: field.displayOrder };
      return f;
    }));
    
    console.log('[TypeBuilder] Moved field', direction);
  }
  
  // Save entity type to API
  async function handleSave() {
    console.log('[TypeBuilder] Starting save');
    
    // Validate required fields
    if (!name || !slug || !pluralName) {
      setError('Please fill in all required fields (name, plural name, and slug)');
      return;
    }
    
    // Validate select/multiselect fields have options
    const invalidFields = allFields.filter(f => 
      (f.type === 'select' || f.type === 'multiselect') && 
      (!f.constraints?.options || f.constraints.options.length === 0)
    );
    
    if (invalidFields.length > 0) {
      setError(`Please add options to the following fields: ${invalidFields.map(f => f.name).join(', ')}`);
      return;
    }
    
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    
    // Prepare payload - strip internal IDs for create, keep for update
    const payload = {
      name,
      pluralName,
      slug,
      description: description || undefined,
      defaultVisibility,
      sections: isNew 
        ? sections.map(({ id, ...s }) => s)
        : sections,
      fields: isNew 
        ? fields.map(({ id, ...f }) => f)
        : fields
    };
    
    console.log('[TypeBuilder] Submitting payload:', payload);
    
    const response = isNew
      ? await api.post('/api/entity-types', payload)
      : await api.patch(`/api/entity-types/${id}`, payload);
    
    if (response.success) {
      console.log('[TypeBuilder] Save successful');
      setSuccessMessage(isNew ? 'Entity type created successfully!' : 'Entity type updated successfully!');
      
      // Redirect after short delay to show success message
      setTimeout(() => {
        route('/super/types');
      }, 1000);
    } else {
      console.error('[TypeBuilder] Save failed:', response.error);
      setError(response.error?.message || 'Failed to save entity type');
    }
    
    setSaving(false);
  }
  
  // All fields for display (sorted)
  const allFields = useMemo(() => {
    return fields;
  }, [fields]);
  
  // Sorted fields for display
  const sortedFields = useMemo(() => {
    return [...allFields].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [allFields]);
  
  // Show loading state
  if (authLoading.value || loading) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <div class="text-center">
          <span class="i-lucide-loader-2 animate-spin text-4xl text-primary-500 mb-4"></span>
          <p class="text-surface-500">Loading type builder...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div class="container-wide py-8 lg:py-12">
      {/* Header with breadcrumb navigation */}
      <div class="mb-8">
        <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-4">
          <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
            Superadmin
          </a>
          <span class="i-lucide-chevron-right text-xs"></span>
          <a href="/super/types" class="hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
            Entity Types
          </a>
          <span class="i-lucide-chevron-right text-xs"></span>
          <span class="text-surface-900 dark:text-surface-100 font-medium">
            {isNew ? 'Create New Type' : 'Edit Type'}
          </span>
        </nav>
        
        <div class="flex items-center justify-between">
          <h1 class="heading-1 flex items-center gap-3">
            <span class={`p-2 rounded-lg ${isNew ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-accent-100 dark:bg-accent-900/30'}`}>
              <span class={`text-2xl ${isNew ? 'i-lucide-plus-square text-primary-600' : 'i-lucide-edit-3 text-accent-600'}`}></span>
            </span>
            {isNew ? 'Create Entity Type' : `Edit: ${name || 'Entity Type'}`}
          </h1>
        </div>
        
        {/* Description */}
        <p class="text-surface-600 dark:text-surface-400 mt-2 max-w-2xl">
          {isNew 
            ? 'Define a new content type with custom fields and sections. Entity types determine the structure of your content.'
            : 'Modify the structure and settings of this entity type. Changes will apply to all existing entities of this type.'
          }
        </p>
      </div>
      
      {/* Error message */}
      {error && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3 animate-slide-down">
          <span class="i-lucide-alert-circle text-red-500 text-xl flex-shrink-0 mt-0.5"></span>
          <div>
            <p class="font-medium text-red-700 dark:text-red-400">Error</p>
            <p class="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
          <button 
            onClick={() => setError(null)}
            class="ml-auto text-red-500 hover:text-red-700 p-1"
          >
            <span class="i-lucide-x"></span>
          </button>
        </div>
      )}
      
      {/* Success message */}
      {successMessage && (
        <div class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3 animate-slide-down">
          <span class="i-lucide-check-circle text-green-500 text-xl"></span>
          <p class="text-green-700 dark:text-green-400">{successMessage}</p>
        </div>
      )}
      
      <div class="grid grid-cols-1 xl:grid-cols-4 gap-6 lg:gap-8">
        {/* Left column - Basic info and visibility */}
        <div class="xl:col-span-1 space-y-6">
          {/* Basic Information Card */}
          <div class="card p-6">
            <h2 class="heading-4 mb-4 flex items-center gap-2">
              <span class="i-lucide-info text-primary-500"></span>
              Basic Information
            </h2>
            
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
                <p class="text-xs text-surface-500 mt-1">Used in "Create new Tool"</p>
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
                <p class="text-xs text-surface-500 mt-1">Used in "Browse all Tools"</p>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  URL Slug <span class="text-red-500">*</span>
                </label>
                <div class="flex items-center">
                  <span class="text-surface-400 text-sm mr-1">/browse/</span>
                  <input
                    type="text"
                    value={slug}
                    onInput={(e) => {
                      setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                      setSlugManuallyEdited(true);
                    }}
                    class="input flex-1 font-mono text-sm"
                    placeholder="tools"
                  />
                </div>
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
                  placeholder="Describe what this entity type is for..."
                />
              </div>
            </div>
          </div>
          
          {/* Visibility Settings Card */}
          <div class="card p-6">
            <h2 class="heading-4 mb-4 flex items-center gap-2">
              <span class="i-lucide-eye text-primary-500"></span>
              Default Visibility
            </h2>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Visibility for new entities
                </label>
                <select
                  value={defaultVisibility}
                  onChange={(e) => setDefaultVisibility((e.target as HTMLSelectElement).value as 'public' | 'authenticated' | 'members')}
                  class="input"
                >
                  <option value="public">🌍 Public — Everyone (SEO indexable)</option>
                  <option value="authenticated">👥 Authenticated — All logged-in users</option>
                  <option value="members">🔒 Members — Organization members only</option>
                </select>
                <p class="text-xs text-surface-500 mt-1">
                  This sets the default visibility when creating new entities of this type. 
                  Users can change visibility per entity.
                </p>
              </div>
            </div>
          </div>
          
          {/* Preview on larger screens */}
          <div class="hidden xl:block">
            <PreviewPanel sections={sections} fields={sortedFields} typeName={name} />
          </div>
        </div>
        
        {/* Right column - Sections & Fields */}
        <div class="xl:col-span-3 space-y-6">
          {/* Sections Card */}
          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="heading-4 flex items-center gap-2">
                <span class="i-lucide-layout-grid text-primary-500"></span>
                Sections
              </h2>
              <button 
                type="button" 
                onClick={handleAddSection} 
                class="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 font-medium"
              >
                <span class="i-lucide-plus"></span>
                Add Section
              </button>
            </div>
            
            <p class="text-sm text-surface-500 mb-4">
              Organize fields into logical groups. Each section appears as a collapsible block in the edit form.
            </p>
            
            <div class="space-y-2">
              {sections.map((section, index) => (
                <div 
                  key={section.id} 
                  class="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-700 group"
                >
                  {/* Reorder buttons */}
                  <div class="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMoveSection(index, 'up')}
                      disabled={index === 0}
                      class="p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <span class="i-lucide-chevron-up text-sm"></span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveSection(index, 'down')}
                      disabled={index === sections.length - 1}
                      class="p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <span class="i-lucide-chevron-down text-sm"></span>
                    </button>
                  </div>
                  
                  <input
                    type="text"
                    value={section.name}
                    onInput={(e) => handleUpdateSection(index, { name: (e.target as HTMLInputElement).value })}
                    class="input flex-1"
                    placeholder="Section name"
                  />
                  
                  <span class="text-xs text-surface-400 bg-surface-100 dark:bg-surface-800 px-2 py-1 rounded">
                    {allFields.filter(f => f.sectionId === section.id).length} fields
                  </span>
                  
                  {sections.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSection(index)}
                      class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove section"
                    >
                      <span class="i-lucide-trash-2"></span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Fields Card */}
          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="heading-4 flex items-center gap-2">
                <span class="i-lucide-list text-primary-500"></span>
                Fields
                <span class="text-sm font-normal text-surface-500">({allFields.length} total)</span>
              </h2>
              <button type="button" onClick={handleAddField} class="btn-primary text-sm">
                <span class="i-lucide-plus mr-1"></span>
                Add Field
              </button>
            </div>
            
            {allFields.length > 0 ? (
              <div class="space-y-6">
                {sections.map(section => {
                  const sectionFields = sortedFields.filter(f => f.sectionId === section.id);
                  if (sectionFields.length === 0) return null;
                  
                  return (
                    <div key={section.id}>
                      <h4 class="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span class="i-lucide-folder-open text-xs"></span>
                        {section.name}
                      </h4>
                      <div class="space-y-2">
                        {sectionFields.map((field, fieldIndex) => {
                          // Check if this is a built-in/default field
                          const isBuiltIn = field.id === 'entity_name' || field.id === 'entity_slug';
                          
                          // #region agent log
                          if (!isBuiltIn) {
                            fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1448',message:'Rendering custom field',data:{fieldId:field.id,fieldName:field.name,fieldType:field.type,hasId:!!field.id,isCompleteField:!!(field.id && field.name && field.type)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                          }
                          // #endregion
                          
                          return (
                            <div 
                              key={field.id}
                              class={`flex items-center gap-3 p-3 rounded-lg border transition-colors group ${
                                isBuiltIn 
                                  ? 'bg-primary-50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800'
                                  : 'bg-surface-50 dark:bg-surface-900 border-surface-200 dark:border-surface-700 hover:border-primary-300 dark:hover:border-primary-700 cursor-pointer'
                              }`}
                              onClick={(e) => {
                                // #region agent log
                                if (!isBuiltIn) {
                                  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1484',message:'Field div clicked - opening editor',data:{fieldId:field.id,targetTagName:(e.target as HTMLElement).tagName,currentTargetTagName:(e.currentTarget as HTMLElement).tagName,isButton:(e.target as HTMLElement).closest('button') !== null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                                }
                                // #endregion
                                // Open field editor when clicking on the field row (but not on action buttons)
                                const target = e.target as HTMLElement;
                                const clickedButton = target.closest('button');
                                // Only open editor if we didn't click on a button (buttons have their own handlers)
                                if (!clickedButton && !isBuiltIn) {
                                  // #region agent log
                                  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1490',message:'Opening field editor from row click',data:{fieldId:field.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                                  // #endregion
                                  handleEditField(field);
                                }
                              }}
                            >
                              {/* Reorder buttons - hidden for built-in fields */}
                              <div class={`flex flex-col gap-0.5 transition-opacity ${isBuiltIn ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveField(field.id, 'up');
                                  }}
                                  disabled={fieldIndex === 0 || isBuiltIn}
                                  class="p-0.5 text-surface-400 hover:text-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <span class="i-lucide-chevron-up text-xs"></span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveField(field.id, 'down');
                                  }}
                                  disabled={fieldIndex === sectionFields.length - 1 || isBuiltIn}
                                  class="p-0.5 text-surface-400 hover:text-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <span class="i-lucide-chevron-down text-xs"></span>
                                </button>
                              </div>
                              
                              {/* Field type icon */}
                              <div class={`p-2 rounded-lg ${isBuiltIn ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-surface-100 dark:bg-surface-800'}`}>
                                <span class={`${FIELD_TYPE_META[field.type].icon} text-lg ${isBuiltIn ? 'text-primary-600' : 'text-surface-500'}`}></span>
                              </div>
                              
                              {/* Field info */}
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                  <span class="font-medium text-surface-900 dark:text-surface-100">
                                    {field.name}
                                  </span>
                                  {isBuiltIn && (
                                    <span class="px-1.5 py-0.5 text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 rounded flex items-center gap-1">
                                      <span class="i-lucide-lock text-xs"></span>
                                      Built-in
                                    </span>
                                  )}
                                  {field.required && !isBuiltIn && (
                                    <span class="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
                                      Required
                                    </span>
                                  )}
                                  {field.showInTable && (
                                    <span class="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                                      Table
                                    </span>
                                  )}
                                </div>
                                <div class="flex items-center gap-2 mt-0.5">
                                  <span class="text-sm text-surface-500">{FIELD_TYPE_META[field.type].label}</span>
                                  {field.description && (
                                    <span class="text-xs text-surface-400 truncate max-w-xs">
                                      — {field.description}
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              {/* Actions - edit button for all fields, delete only for custom fields */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  // #region agent log
                                  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1520',message:'Edit button clicked',data:{fieldId:field.id,fieldName:field.name,isBuiltIn,eventType:e.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                                  // #endregion
                                  e.stopPropagation();
                                  handleEditField(field);
                                }}
                                class="p-2 text-surface-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                                title="Edit field"
                              >
                                <span class="i-lucide-pencil"></span>
                              </button>
                              {!isBuiltIn && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1568',message:'Delete button clicked',data:{fieldId:field.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                                    // #endregion
                                    e.stopPropagation();
                                    handleRemoveField(field.id);
                                  }}
                                  class="p-2 text-surface-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  title="Remove field"
                                >
                                  <span class="i-lucide-trash-2"></span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                
                {/* Show unassigned fields */}
                {allFields.filter(f => !sections.find(s => s.id === f.sectionId)).length > 0 && (
                  <div>
                    <h4 class="text-sm font-semibold text-amber-600 mb-2">⚠️ Unassigned Fields</h4>
                    <p class="text-xs text-surface-500 mb-2">These fields are not assigned to a valid section.</p>
                  </div>
                )}
              </div>
            ) : (
              <div class="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border-2 border-dashed border-surface-200 dark:border-surface-700">
                <span class="i-lucide-layout-list text-4xl text-surface-300 dark:text-surface-600 mb-3"></span>
                <h3 class="font-semibold text-surface-700 dark:text-surface-300 mb-1">No custom fields yet</h3>
                <p class="text-surface-500 text-sm mb-4">
                  The built-in Name and Slug fields are already included. Add custom fields below.
                </p>
                <button type="button" onClick={handleAddField} class="btn-primary">
                  <span class="i-lucide-plus mr-1"></span>
                  Add Custom Field
                </button>
              </div>
            )}
          </div>
          
          {/* Preview on mobile/tablet */}
          <div class="xl:hidden">
            <PreviewPanel sections={sections} fields={sortedFields} typeName={name} />
          </div>
          
          {/* Actions */}
          <div class="flex items-center justify-between pt-4 border-t border-surface-200 dark:border-surface-700">
            <a href="/super/types" class="btn-ghost">
              <span class="i-lucide-arrow-left mr-2"></span>
              Cancel
            </a>
            
            <div class="flex items-center gap-3">
              {/* Validation summary */}
              <div class="text-sm text-surface-500 hidden sm:block">
                {!name || !slug ? (
                  <span class="text-amber-600">Fill in required info</span>
                ) : (
                  <span class="text-green-600 flex items-center gap-1">
                    <span class="i-lucide-check text-xs"></span>
                    Ready to save
                  </span>
                )}
              </div>
              
              <button
                type="button"
                onClick={handleSave}
                class="btn-primary"
                disabled={saving || !name || !slug}
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
      </div>
      
      {/* Field Editor Modal */}
      {/* #region agent log */}
      {(() => {
        fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1618',message:'Modal render check',data:{showFieldModal,hasEditingField:!!editingField,editingFieldId:editingField?.id,shouldRender:showFieldModal && !!editingField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C,E'})}).catch(()=>{});
        return null;
      })()}
      {/* #endregion */}
      {showFieldModal && editingField && (
        <FieldEditorModal
          key={editingField.id || 'new-field'}
          field={editingField}
          sections={sections}
          entityTypes={entityTypes}
          onSave={handleSaveField}
          onClose={() => {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TypeBuilder.tsx:1626',message:'Modal onClose called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            console.log('[TypeBuilder] Closing field modal');
            setShowFieldModal(false);
            setEditingField(null);
          }}
        />
      )}
    </div>
  );
}
