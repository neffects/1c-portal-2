/**
 * CSV Utilities
 * 
 * Client-side CSV parsing and generation for entity import/export.
 * Handles the template row format and field type mappings.
 */

import type { Entity, EntityType, FieldDefinition, FieldType } from '@1cc/shared';

/**
 * Import error with source tracking
 */
export interface ImportError {
  rowIndex: number; // 0-based index in data array
  csvRow?: number; // 1-based CSV row number (rowIndex + 3 for CSV with header + template)
  field?: string;
  message: string;
  source: 'parse' | 'validation' | 'server';
}

/**
 * Parse result from CSV parsing
 */
export interface CSVParseResult {
  success: boolean;
  data: Record<string, unknown>[];
  errors: ImportError[];
  headers: string[];
}

/**
 * Template example values by field type
 */
const TEMPLATE_EXAMPLES: Record<FieldType, string> = {
  string: 'Example text',
  text: 'Longer text content...',
  markdown: '# Heading\n\nParagraph text',
  number: '123',
  boolean: 'true',
  date: '2024-01-15',
  select: 'option_value',
  multiselect: 'option1,option2',
  link: 'abc1234',
  weblink: 'https://example.com',
  image: 'https://example.com/image.jpg',
  logo: 'https://example.com/logo.png',
  file: 'https://example.com/document.pdf',
  country: 'US'
};

/**
 * Generate template hint for a field (shown in template row)
 */
function getFieldTemplateHint(field: FieldDefinition): string {
  const type = field.type;
  let hint = `[${type}]`;
  
  if (field.required) {
    hint += ' REQUIRED';
  }
  
  // Add constraint hints
  if (field.constraints) {
    const c = field.constraints;
    
    if (c.options && c.options.length > 0) {
      const values = c.options.map(o => o.value).slice(0, 5);
      hint += ` Options: ${values.join(', ')}`;
      if (c.options.length > 5) {
        hint += '...';
      }
    }
    
    if (c.minLength !== undefined || c.maxLength !== undefined) {
      const parts = [];
      if (c.minLength !== undefined) parts.push(`min ${c.minLength}`);
      if (c.maxLength !== undefined) parts.push(`max ${c.maxLength}`);
      hint += ` (${parts.join(', ')} chars)`;
    }
    
    if (c.minValue !== undefined || c.maxValue !== undefined) {
      const parts = [];
      if (c.minValue !== undefined) parts.push(`min ${c.minValue}`);
      if (c.maxValue !== undefined) parts.push(`max ${c.maxValue}`);
      hint += ` (${parts.join(', ')})`;
    }
  }
  
  return hint;
}

/**
 * Slug format regex for validation
 */
export const SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * Generate a URL-safe slug from a string (client-side)
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length
}

/**
 * Validate slug format
 */
export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && slug.length > 0 && slug.length <= 100;
}

/**
 * Entity ID format regex for validation
 */
export const ENTITY_ID_REGEX = /^[a-z0-9]+$/;

/**
 * Validate entity ID format (7 lowercase alphanumeric characters)
 */
export function isValidEntityId(id: string): boolean {
  return typeof id === 'string' && id.length === 7 && ENTITY_ID_REGEX.test(id);
}

/**
 * Generate template row for CSV export
 * 
 * Name and Slug are always system fields (entity.name, entity.slug).
 * Entity types may have Name/Slug fields with auto-generated IDs - these are skipped.
 */
export function generateTemplateRow(entityType: EntityType): Record<string, string> {
  const template: Record<string, string> = {
    id: '[7-char alphanumeric or empty for new]',
    organizationId: '[7-char org ID or empty for global]',
    organizationSlug: '[org slug or empty for global]',
    name: '[entity name - required]',
    slug: '[lowercase-with-hyphens or auto-generated]',
    visibility: '[public|authenticated|members]'
  };
  
  // Add dynamic fields from entity type (excluding Name and Slug - they're system fields)
  for (const field of entityType.fields) {
    // Skip Name and Slug fields - they're always system fields regardless of their ID
    if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
      continue;
    }
    
    template[field.id] = getFieldTemplateHint(field);
  }
  
  return template;
}

/**
 * Escape a value for CSV (handle quotes, commas, newlines)
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  let str: string;
  
  if (typeof value === 'object') {
    // Handle arrays (multiselect) and objects (weblink)
    if (Array.isArray(value)) {
      str = value.join(',');
    } else {
      str = JSON.stringify(value);
    }
  } else {
    str = String(value);
  }
  
  // If contains comma, quote, or newline, wrap in quotes and escape inner quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  
  return str;
}

/**
 * Generate CSV string from entities
 * 
 * Expects entities to have name and slug stored at the top level (not in data).
 * Entity types should use standard field IDs 'name' and 'slug' for Name/Slug fields.
 */
export function generateCSV(entities: Entity[], entityType: EntityType): string {
  const lines: string[] = [];
  
  // Find any fields that are actually Name or Slug fields (by name, regardless of ID)
  // These may have auto-generated IDs like 'field_0_...' but should be treated as system fields
  const nameFieldId = entityType.fields.find(f => f.name === 'Name')?.id;
  const slugFieldId = entityType.fields.find(f => f.name === 'Slug')?.id;
  
  // Debug: log field mapping
  console.log('[CSV Export] Entity type fields:', entityType.fields.map(f => ({ id: f.id, name: f.name })));
  console.log('[CSV Export] Name field ID:', nameFieldId, 'Slug field ID:', slugFieldId);
  
  // Create header row with friendly names
  // Format: "Field Name|field_id" to preserve mapping for parsing
  // System fields: Id, Organization, Organization Slug, Name, Slug, Visibility (read from entity top-level, not data)
  const headerRow: string[] = ['Id|id', 'Organization|organizationId', 'Organization Slug|organizationSlug', 'Name|name', 'Slug|slug', 'Visibility|visibility'];
  const fieldMapping: Array<{ name: string; id: string; isSystemField: boolean }> = [
    { name: 'Id', id: 'id', isSystemField: true },
    { name: 'Organization', id: 'organizationId', isSystemField: true },
    { name: 'Organization Slug', id: 'organizationSlug', isSystemField: true },
    { name: 'Name', id: 'name', isSystemField: true },
    { name: 'Slug', id: 'slug', isSystemField: true },
    { name: 'Visibility', id: 'visibility', isSystemField: true }
  ];
  
  // Add dynamic fields from entity type (excluding Name and Slug - they're system fields)
  for (const field of entityType.fields) {
    // Skip Name and Slug fields - they're always system fields regardless of their ID
    // Check both field.id and field.name to handle legacy entity types with auto-generated IDs
    if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
      console.log('[CSV Export] Skipping system field:', field.name, field.id);
      continue;
    }
    
    headerRow.push(`${field.name}|${field.id}`);
    fieldMapping.push({ name: field.name, id: field.id, isSystemField: false });
  }
  
  // Row 1: Headers with friendly names
  lines.push(headerRow.join(','));
  
  // Row 2: Template row
  const template = generateTemplateRow(entityType);
  const templateValues = fieldMapping.map(f => {
    return escapeCSVValue(template[f.id] || '');
  });
  lines.push(templateValues.join(','));
  
  // Row 3+: Entity data
  console.log('[CSV Export] Generating CSV for', entities.length, 'entities');
  if (entities.length === 0) {
    console.warn('[CSV Export] WARNING: No entities provided to export');
  }
  
  for (const entity of entities) {
    console.log('[CSV Export] Processing entity:', entity.id, entity.name);
    const rowValues = fieldMapping.map(f => {
      if (f.isSystemField) {
        // System fields: read from entity top-level
        if (f.id === 'id') {
          return escapeCSVValue(entity.id);
        }
        if (f.id === 'organizationId') {
          return escapeCSVValue(entity.organizationId || '');
        }
        if (f.id === 'organizationSlug') {
          // Organization slug: read from computed property (added by backend export endpoint)
          const orgSlug = (entity as Entity & { organizationSlug?: string | null }).organizationSlug;
          return escapeCSVValue(orgSlug || '');
        }
        if (f.id === 'name') {
          // Name: prefer entity.name, fall back to entity.data[nameFieldId] for legacy entities
          const name = entity.name || (nameFieldId ? entity.data?.[nameFieldId] as string : '');
          return escapeCSVValue(name || '');
        }
        if (f.id === 'slug') {
          // Slug: prefer entity.slug, fall back to entity.data[slugFieldId] for legacy entities
          const slug = entity.slug || (slugFieldId ? entity.data?.[slugFieldId] as string : '');
          return escapeCSVValue(slug || '');
        }
        if (f.id === 'visibility') {
          return escapeCSVValue(entity.visibility);
        }
      }
      // Data fields: read from entity.data (safely handle undefined data)
      return escapeCSVValue(entity.data?.[f.id]);
    });
    lines.push(rowValues.join(','));
  }
  
  console.log('[CSV Export] Generated CSV with', lines.length, 'total lines (2 header rows +', entities.length, 'data rows)');
  
  const csvContent = lines.join('\n');
  console.log('[CSV Export] Final CSV length:', csvContent.length, 'characters');
  return csvContent;
}

/**
 * Parse a CSV line respecting quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === ',') {
        result.push(current.trim());
        current = '';
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

/**
 * Parse CSV text into data objects
 * Skips the template row (row 2)
 */
export function parseCSV(text: string, skipTemplateRow = true): CSVParseResult {
  const errors: ImportError[] = [];
  const data: Record<string, unknown>[] = [];
  
  // Split into lines, handling both \n and \r\n
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  
  if (lines.length === 0) {
    return {
      success: false,
      data: [],
      errors: [{ rowIndex: 0, message: 'CSV file is empty', source: 'parse' }],
      headers: []
    };
  }
  
  // Parse header row
  const rawHeaders = parseCSVLine(lines[0]);
  
  if (rawHeaders.length === 0) {
    return {
      success: false,
      data: [],
      errors: [{ rowIndex: 0, message: 'No headers found in CSV', source: 'parse' }],
      headers: []
    };
  }
  
  // Extract field IDs from headers (format: "Field Name|field_id" or just "field_id" for backwards compatibility)
  const headerToFieldId = new Map<string, string>();
  const fieldIds: string[] = [];
  
  for (const header of rawHeaders) {
    // Check if header is in format "Name|field_id"
    const pipeIndex = header.lastIndexOf('|');
    if (pipeIndex > 0) {
      const fieldId = header.substring(pipeIndex + 1);
      headerToFieldId.set(header, fieldId);
      fieldIds.push(fieldId);
    } else {
      // Backwards compatibility: use header as-is
      headerToFieldId.set(header, header.toLowerCase());
      fieldIds.push(header.toLowerCase());
    }
  }
  
  // Determine start row (skip template row if present)
  const startRow = skipTemplateRow && lines.length > 2 ? 2 : 1;
  
  // Parse data rows
  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    const csvRow = i + 1; // 1-based row number
    const rowIndex = i - startRow; // 0-based data index
    
    try {
      const values = parseCSVLine(line);
      
      // Create object from headers and values, using field IDs as keys
      const row: Record<string, unknown> = {};
      
      for (let j = 0; j < rawHeaders.length; j++) {
        const rawHeader = rawHeaders[j];
        const fieldId = headerToFieldId.get(rawHeader) || rawHeader.toLowerCase();
        const value = values[j] !== undefined ? values[j] : '';
        
        // Always include the value, even if empty (important for required fields like name/slug)
        // This allows us to detect empty values vs missing columns
        row[fieldId] = value;
      }
      
      data.push(row);
    } catch (error) {
      errors.push({
        rowIndex,
        csvRow,
        message: `Failed to parse row: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'parse'
      });
    }
  }
  
  return {
    success: errors.length === 0,
    data,
    errors,
    headers: fieldIds
  };
}

/**
 * Convert parsed CSV/JSON data to entity import format
 * Performs type coercion based on field definitions
 * Handles system fields: id, organizationId, slug, visibility
 */
export function convertToImportData(
  data: Record<string, unknown>[],
  entityType: EntityType
): { entities: Array<{ data: Record<string, unknown>; visibility?: string; slug?: string; name?: string; organizationId?: string | null; organizationSlug?: string; id?: string }>; errors: ImportError[] } {
  const entities: Array<{ data: Record<string, unknown>; visibility?: string; slug?: string; name?: string; organizationId?: string | null; organizationSlug?: string; id?: string }> = [];
  const errors: ImportError[] = [];
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const entityData: Record<string, unknown> = {};
    let visibility: string | undefined;
    let slug: string | undefined;
    let name: string | undefined;
    let organizationId: string | null | undefined;
    let organizationSlug: string | undefined;
    let id: string | undefined;
    
    // Extract entity ID if present
    if (row.id !== undefined && row.id !== null && row.id !== '') {
      const idValue = String(row.id).trim();
      if (isValidEntityId(idValue)) {
        id = idValue;
      } else {
        errors.push({
          rowIndex: i,
          csvRow: i + 3,
          field: 'id',
          message: `Invalid entity ID format: "${idValue}". Must be exactly 7 lowercase alphanumeric characters`,
          source: 'validation'
        });
      }
    }
    // Note: Empty ID means create new entity (ID will be generated)
    
    // Extract organizationId or organizationSlug (header is 'Organization|organizationId' or 'Organization Slug|organizationSlug')
    // organizationSlug takes precedence if both are provided
    const orgSlugValue = row['organizationSlug'] as string | undefined;
    const orgIdValue = row['organizationId'] as string | undefined;
    
    if (orgSlugValue !== undefined && orgSlugValue !== null && orgSlugValue !== '') {
      // Organization slug provided - backend will resolve it
      organizationSlug = String(orgSlugValue).trim();
      // Don't set organizationId when slug is provided - backend will resolve
    } else if (orgIdValue !== undefined) {
      // Organization ID provided
      if (orgIdValue === '' || orgIdValue === null) {
        // Empty or null means global entity
        organizationId = null;
      } else if (typeof orgIdValue === 'string' && orgIdValue.length === 7 && /^[a-z0-9]+$/.test(orgIdValue)) {
        organizationId = orgIdValue;
      } else if (typeof orgIdValue === 'string' && orgIdValue.trim() !== '') {
        errors.push({
          rowIndex: i,
          csvRow: i + 3,
          field: 'organizationId',
          message: `Invalid organization ID: "${orgIdValue}". Must be 7 lowercase alphanumeric characters or empty for global`,
          source: 'validation'
        });
      }
    }
    
    // Extract visibility if present
    if (row.visibility && typeof row.visibility === 'string') {
      const visValue = row.visibility.toLowerCase();
      if (['public', 'authenticated', 'members'].includes(visValue)) {
        visibility = visValue;
      } else {
        errors.push({
          rowIndex: i,
          csvRow: i + 3,
          field: 'visibility',
          message: `Invalid visibility: "${row.visibility}". Must be public, authenticated, or members`,
          source: 'validation'
        });
      }
    }
    
    // Extract name if present (common property, will be moved to top-level by backend)
    // Name is REQUIRED - validate it exists and is not empty
    const nameValue = row.name !== undefined && row.name !== null ? String(row.name).trim() : '';
    
    if (!nameValue || nameValue === '') {
      // Name is missing or empty - this is an error (but continue to collect other errors)
      errors.push({
        rowIndex: i,
        csvRow: i + 3,
        field: 'name',
        message: 'Name is required and cannot be empty',
        source: 'validation'
      });
      // Don't set name - will skip adding to entities at the end
    } else {
      name = nameValue;
      // Include in entityData so backend can extract it
      entityData.name = name;
    }
    
    // Extract or generate slug
    if (row.slug && typeof row.slug === 'string' && row.slug.trim() !== '') {
      const slugValue = row.slug.trim();
      if (isValidSlug(slugValue)) {
        slug = slugValue;
        // Also include in entityData so backend can extract it
        entityData.slug = slug;
      } else {
        errors.push({
          rowIndex: i,
          csvRow: i + 3,
          field: 'slug',
          message: `Invalid slug format: "${slugValue}". Must contain only lowercase letters, numbers, and hyphens`,
          source: 'validation'
        });
      }
    }
    // Note: If slug is not provided, it will be auto-generated from name on the server
    // We check if name is available and pre-generate it for client-side preview
    
    // Process each field (skip name and slug as they're common properties already handled)
    for (const field of entityType.fields) {
      // Skip Name and Slug fields - they're always system fields regardless of their ID
      // Entity types may have Name/Slug with auto-generated IDs like 'field_0_...'
      if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
        continue;
      }
      
      const rawValue = row[field.id];
      
      // Skip undefined values (will use defaults or be caught by required check)
      if (rawValue === undefined || rawValue === '') {
        if (field.required) {
          errors.push({
            rowIndex: i,
            csvRow: i + 3,
            field: field.id,
            message: `Required field '${field.name}' is missing`,
            source: 'validation'
          });
        }
        continue;
      }
      
      // Coerce value based on field type
      try {
        entityData[field.id] = coerceFieldValue(rawValue, field, i, errors);
      } catch (error) {
        errors.push({
          rowIndex: i,
          csvRow: i + 3,
          field: field.id,
          message: error instanceof Error ? error.message : 'Invalid value',
          source: 'validation'
        });
      }
    }
    
    // Auto-generate slug from name if not provided
    if (!slug && name) {
      slug = generateSlug(name);
      entityData.slug = slug;
    }
    
    // Only add entity if name is valid (required field)
    // This ensures we collect all validation errors before skipping
    if (!name || name.trim() === '') {
      // Name validation error already logged above, skip this entity
      continue;
    }
    
    // Ensure name and slug are in entityData for backend extraction
    entityData.name = name;
    if (slug) {
      entityData.slug = slug;
    }
    
    entities.push({ data: entityData, visibility, slug, name, organizationId, organizationSlug, id });
  }
  
  return { entities, errors };
}

/**
 * Coerce a raw value to the correct type for a field
 */
function coerceFieldValue(
  value: unknown,
  field: FieldDefinition,
  rowIndex: number,
  errors: ImportError[]
): unknown {
  const strValue = String(value).trim();
  
  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
      return strValue;
      
    case 'number': {
      const num = Number(strValue);
      if (isNaN(num)) {
        errors.push({
          rowIndex,
          csvRow: rowIndex + 3,
          field: field.id,
          message: `Field '${field.name}' must be a number, got: "${strValue}"`,
          source: 'validation'
        });
        return undefined;
      }
      return num;
    }
    
    case 'boolean': {
      const lower = strValue.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
        return false;
      }
      errors.push({
        rowIndex,
        csvRow: rowIndex + 3,
        field: field.id,
        message: `Field '${field.name}' must be true/false, got: "${strValue}"`,
        source: 'validation'
      });
      return undefined;
    }
    
    case 'date':
      // Validate date format
      const date = new Date(strValue);
      if (isNaN(date.getTime())) {
        errors.push({
          rowIndex,
          csvRow: rowIndex + 3,
          field: field.id,
          message: `Field '${field.name}' must be a valid date, got: "${strValue}"`,
          source: 'validation'
        });
        return undefined;
      }
      return strValue;
      
    case 'select': {
      // Validate against options
      if (field.constraints?.options) {
        const validValues = field.constraints.options.map(o => o.value);
        if (!validValues.includes(strValue)) {
          errors.push({
            rowIndex,
            csvRow: rowIndex + 3,
            field: field.id,
            message: `Field '${field.name}' must be one of: ${validValues.join(', ')}`,
            source: 'validation'
          });
          return undefined;
        }
      }
      return strValue;
    }
    
    case 'multiselect': {
      // Split comma-separated values
      const values = strValue.split(',').map(v => v.trim()).filter(v => v !== '');
      
      // Validate against options
      if (field.constraints?.options) {
        const validValues = field.constraints.options.map(o => o.value);
        for (const v of values) {
          if (!validValues.includes(v)) {
            errors.push({
              rowIndex,
              csvRow: rowIndex + 3,
              field: field.id,
              message: `Field '${field.name}' contains invalid option: "${v}". Valid: ${validValues.join(', ')}`,
              source: 'validation'
            });
          }
        }
      }
      return values;
    }
    
    case 'link': {
      // Handle single or multiple entity IDs
      if (field.constraints?.allowMultiple) {
        return strValue.split(',').map(v => v.trim()).filter(v => v !== '');
      }
      return strValue;
    }
    
    case 'weblink': {
      // Handle URL or URL|Alias format
      if (strValue.includes('|')) {
        const [url, alias] = strValue.split('|', 2);
        return { url: url.trim(), alias: alias.trim() };
      }
      return strValue;
    }
    
    case 'image':
    case 'logo':
    case 'file':
      // Just pass through as URL string
      return strValue;
      
    case 'country':
      // Country code
      return strValue.toUpperCase();
      
    default:
      return strValue;
  }
}

/**
 * Validate entity data against entity type schema (client-side)
 * Returns list of validation errors
 */
export function validateImportData(
  entities: Array<{ data: Record<string, unknown>; visibility?: string }>,
  entityType: EntityType
): ImportError[] {
  const errors: ImportError[] = [];
  
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    
    // Check required fields (skip Name/Slug - they're handled as system fields)
    for (const field of entityType.fields) {
      // Skip Name and Slug fields - they're system fields validated separately
      if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
        continue;
      }
      
      if (field.required) {
        const value = entity.data[field.id];
        if (value === undefined || value === null || value === '') {
          errors.push({
            rowIndex: i,
            csvRow: i + 3,
            field: field.id,
            message: `Required field '${field.name}' is missing`,
            source: 'validation'
          });
        }
      }
    }
    
    // Validate field constraints (skip Name/Slug)
    for (const field of entityType.fields) {
      // Skip Name and Slug fields - they're system fields
      if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
        continue;
      }
      
      const value = entity.data[field.id];
      if (value === undefined || value === null) continue;
      
      const fieldErrors = validateFieldConstraints(value, field, i);
      errors.push(...fieldErrors);
    }
  }
  
  return errors;
}

/**
 * Validate a field value against its constraints
 */
function validateFieldConstraints(
  value: unknown,
  field: FieldDefinition,
  rowIndex: number
): ImportError[] {
  const errors: ImportError[] = [];
  const c = field.constraints;
  
  if (!c) return errors;
  
  // String length constraints
  if (typeof value === 'string') {
    if (c.minLength !== undefined && value.length < c.minLength) {
      errors.push({
        rowIndex,
        csvRow: rowIndex + 3,
        field: field.id,
        message: `Field '${field.name}' must be at least ${c.minLength} characters`,
        source: 'validation'
      });
    }
    if (c.maxLength !== undefined && value.length > c.maxLength) {
      errors.push({
        rowIndex,
        csvRow: rowIndex + 3,
        field: field.id,
        message: `Field '${field.name}' must not exceed ${c.maxLength} characters`,
        source: 'validation'
      });
    }
  }
  
  // Number range constraints
  if (typeof value === 'number') {
    if (c.minValue !== undefined && value < c.minValue) {
      errors.push({
        rowIndex,
        csvRow: rowIndex + 3,
        field: field.id,
        message: `Field '${field.name}' must be at least ${c.minValue}`,
        source: 'validation'
      });
    }
    if (c.maxValue !== undefined && value > c.maxValue) {
      errors.push({
        rowIndex,
        csvRow: rowIndex + 3,
        field: field.id,
        message: `Field '${field.name}' must not exceed ${c.maxValue}`,
        source: 'validation'
      });
    }
  }
  
  return errors;
}

/**
 * Download a string as a file
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
}

/**
 * Download entities as CSV
 */
export function downloadCSV(entities: Entity[], entityType: EntityType, filename?: string): void {
  const csv = generateCSV(entities, entityType);
  const name = filename || `${entityType.slug}-export-${new Date().toISOString().split('T')[0]}.csv`;
  downloadFile(csv, name, 'text/csv;charset=utf-8');
}

/**
 * Download entities as JSON
 */
export function downloadJSON(entities: Entity[], entityType: EntityType, filename?: string): void {
  const exportData = {
    entityType: {
      id: entityType.id,
      name: entityType.name,
      pluralName: entityType.pluralName,
      slug: entityType.slug,
      fields: entityType.fields
    },
    entities: entities.map(e => ({
      id: e.id,
      organizationId: e.organizationId,
      name: e.name,
      slug: e.slug,
      visibility: e.visibility,
      data: e.data
    })),
    exportedAt: new Date().toISOString()
  };
  
  const json = JSON.stringify(exportData, null, 2);
  const name = filename || `${entityType.slug}-export-${new Date().toISOString().split('T')[0]}.json`;
  downloadFile(json, name, 'application/json');
}
