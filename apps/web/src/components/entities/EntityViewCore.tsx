/**
 * EntityViewCore Component
 * 
 * Shared component for displaying entity details in a read-only view.
 * Used by both admin and superadmin entity view pages.
 */

import type { Entity, EntityType, FieldDefinition } from '@1cc/shared';

interface EntityViewCoreProps {
  /** Base path for navigation links (/admin or /super) */
  basePath: string;
  /** Entity to display */
  entity: Entity;
  /** Entity type definition */
  entityType: EntityType;
  /** Organization name for display */
  orgName?: string | null;
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

export function EntityViewCore({ basePath, entity, entityType, orgName }: EntityViewCoreProps) {
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
    : (orgName || 'Organization');
  
  // Technical fields to exclude from section display - using actual field objects
  const technicalFieldIds = new Set(
    [nameField?.id, descriptionField?.id, slugField?.id].filter(Boolean) as string[]
  );
  const isTechnicalField = (fieldId: string) => technicalFieldIds.has(fieldId);
  
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
    <div class="max-w-4xl mx-auto">
      {/* Top Navigation */}
      <div class="flex items-center justify-between mb-8">
        <a 
          href={`${basePath}/entity-types/${entityType.id}`}
          class="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
        >
          <span class="i-lucide-arrow-left"></span>
          <span>Back to {entityType.pluralName}</span>
        </a>
        
        <a 
          href={`${basePath}/entities/${entity.id}/edit`}
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
  );
}
