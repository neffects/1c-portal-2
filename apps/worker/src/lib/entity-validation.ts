/**
 * Entity Field Validation
 * 
 * Provides field-level validation for entity data.
 * Validates individual fields before merging to ensure invalid data never enters entity JSON.
 */

import type { FieldDefinition, EntityType, EntityBundle, BundleEntity, Entity, EntityLatestPointer, EntityStub } from '@1cc/shared';
import { ValidationError, ConflictError } from '../middleware/error';
import { readJSON, getEntityTypePath } from './r2';
import { slugIndexExists } from './slug-index';
import type { AppAbility } from './abilities';

/**
 * Validate a single field value against its field definition
 * @throws ValidationError if the field value is invalid
 */
export function validateFieldValue(field: FieldDefinition, value: unknown): void {
  const constraints = field.constraints || {};
  
  // Type-specific validation
  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
      if (typeof value !== 'string') {
        throw new ValidationError(`Field '${field.name}' must be a string`);
      }
      if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        throw new ValidationError(`Field '${field.name}' must be at least ${constraints.minLength} characters`);
      }
      if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        throw new ValidationError(`Field '${field.name}' must not exceed ${constraints.maxLength} characters`);
      }
      // Pattern validation
      if (constraints.pattern && typeof value === 'string') {
        try {
          // Ensure pattern is properly formatted (escape special characters if needed)
          // HTML pattern attributes don't need anchors, but backend validation does
          let pattern = constraints.pattern;
          // If pattern doesn't start with ^, add it for full string matching
          if (!pattern.startsWith('^')) {
            pattern = '^' + pattern;
          }
          // If pattern doesn't end with $, add it for full string matching
          if (!pattern.endsWith('$')) {
            pattern = pattern + '$';
          }
          const regex = new RegExp(pattern);
          if (!regex.test(value)) {
            throw new ValidationError(
              constraints.patternMessage || `Field '${field.name}' does not match required pattern`
            );
          }
        } catch (error) {
          // Invalid regex pattern - skip pattern validation
          console.warn(`[Validation] Invalid regex pattern for field ${field.id}:`, constraints.pattern, error);
          // Don't throw - allow the value through if pattern is invalid
        }
      }
      break;
      
    case 'number':
      if (typeof value !== 'number') {
        throw new ValidationError(`Field '${field.name}' must be a number`);
      }
      if (constraints.minValue !== undefined && value < constraints.minValue) {
        throw new ValidationError(`Field '${field.name}' must be at least ${constraints.minValue}`);
      }
      if (constraints.maxValue !== undefined && value > constraints.maxValue) {
        throw new ValidationError(`Field '${field.name}' must not exceed ${constraints.maxValue}`);
      }
      break;
      
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new ValidationError(`Field '${field.name}' must be a boolean`);
      }
      break;
      
    case 'date':
      // Date can be string (ISO format) or number (timestamp)
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new ValidationError(`Field '${field.name}' must be a date (string or number)`);
      }
      if (typeof value === 'string') {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new ValidationError(`Field '${field.name}' must be a valid date string`);
        }
      }
      break;
      
    case 'select':
      if (constraints.options) {
        const validValues = constraints.options.map(o => o.value);
        if (!validValues.includes(value as string)) {
          throw new ValidationError(`Field '${field.name}' must be one of: ${validValues.join(', ')}`);
        }
      }
      break;
      
    case 'multiselect':
      if (!Array.isArray(value)) {
        throw new ValidationError(`Field '${field.name}' must be an array`);
      }
      if (constraints.options) {
        const validValues = constraints.options.map(o => o.value);
        for (const v of value) {
          if (!validValues.includes(v as string)) {
            throw new ValidationError(`Field '${field.name}' contains invalid value: ${v}`);
          }
        }
      }
      break;
      
    case 'link':
      // Link can be a string (single link) or array of strings (multiple links)
      if (constraints.allowMultiple) {
        if (!Array.isArray(value)) {
          throw new ValidationError(`Field '${field.name}' must be an array`);
        }
        for (const v of value) {
          if (typeof v !== 'string') {
            throw new ValidationError(`Field '${field.name}' must contain only strings`);
          }
        }
      } else {
        if (typeof value !== 'string') {
          throw new ValidationError(`Field '${field.name}' must be a string`);
        }
      }
      break;
      
    case 'file':
    case 'image':
    case 'logo':
      // File/image/logo can be string (URL/path) or object with file metadata
      if (typeof value !== 'string' && typeof value !== 'object') {
        throw new ValidationError(`Field '${field.name}' must be a string or object`);
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Validate file metadata structure if provided
        const fileObj = value as Record<string, unknown>;
        if (fileObj.url && typeof fileObj.url !== 'string') {
          throw new ValidationError(`Field '${field.name}' file object must have a string 'url' property`);
        }
      }
      break;
      
    case 'weblink':
      // WebLink can be null, an object with url (and optional alias), or a string (legacy format)
      if (value === null) {
        // Null is allowed (empty link)
        break;
      }
      if (typeof value === 'string') {
        // Legacy format: just a URL string - validate it's a valid URL
        try {
          const url = new URL(value);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new ValidationError(`Field '${field.name}' must be a valid HTTP or HTTPS URL`);
          }
          if (constraints.requireHttps && url.protocol !== 'https:') {
            throw new ValidationError(`Field '${field.name}' must be a valid HTTPS URL`);
          }
        } catch (error) {
          if (error instanceof ValidationError) {
            throw error;
          }
          throw new ValidationError(`Field '${field.name}' must be a valid URL`);
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Modern format: object with url and optional alias
        const linkObj = value as Record<string, unknown>;
        if (!linkObj.url || typeof linkObj.url !== 'string') {
          throw new ValidationError(`Field '${field.name}' must have a 'url' property (string)`);
        }
        // Validate URL
        try {
          const url = new URL(linkObj.url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new ValidationError(`Field '${field.name}' URL must be HTTP or HTTPS`);
          }
          if (constraints.requireHttps && url.protocol !== 'https:') {
            throw new ValidationError(`Field '${field.name}' URL must be HTTPS`);
          }
        } catch (error) {
          if (error instanceof ValidationError) {
            throw error;
          }
          throw new ValidationError(`Field '${field.name}' must have a valid URL`);
        }
        // Validate alias if present
        if (linkObj.alias !== undefined && typeof linkObj.alias !== 'string') {
          throw new ValidationError(`Field '${field.name}' alias must be a string if provided`);
        }
      } else {
        throw new ValidationError(`Field '${field.name}' must be null, a string URL, or an object with url property`);
      }
      break;
      
    case 'country':
      // Country can be string (country code) or object with country data
      if (typeof value !== 'string' && typeof value !== 'object') {
        throw new ValidationError(`Field '${field.name}' must be a string or object`);
      }
      break;
      
    default:
      // Unknown field type - allow any value but log warning
      console.warn(`[Validation] Unknown field type '${field.type}' for field ${field.id}, skipping type validation`);
  }
}

/**
 * Validate entity data against type schema
 * Checks all fields including required field validation
 * 
 * Note: Name and Slug are system fields (entity.name, entity.slug) validated separately.
 * Entity types may incorrectly have Name/Slug as dynamic fields - these are skipped here.
 */
export function validateEntityData(data: Record<string, unknown>, entityType: EntityType): void {
  const errors: string[] = [];
  
  for (const field of entityType.fields) {
    // Skip Name and Slug fields - they're system fields validated separately
    // Entity types may have these with auto-generated IDs like 'field_0_...'
    if (field.id === 'name' || field.id === 'slug' || field.name === 'Name' || field.name === 'Slug') {
      console.log('[Validation] Skipping system field:', field.name, field.id);
      continue;
    }
    
    const value = data[field.id];
    
    // Check required fields
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`Field '${field.name}' is required`);
      continue;
    }
    
    // Skip validation if value is not provided (and not required)
    if (value === undefined || value === null) continue;
    
    // Validate the field value
    try {
      validateFieldValue(field, value);
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(error.message);
      } else {
        errors.push(`Field '${field.name}': ${error instanceof Error ? error.message : 'Invalid value'}`);
      }
    }
  }
  
  if (errors.length > 0) {
    throw new ValidationError('Entity data validation failed', { fields: errors });
  }
}

/**
 * Validate and filter entity field updates
 * Returns only valid fields that can be merged
 * @throws ValidationError if any fields are invalid
 * 
 * Note: System fields like 'name' and 'slug' are always allowed even if not in entity type definition
 */
export function validateEntityFields(
  updates: Record<string, unknown>,
  entityType: EntityType
): Record<string, unknown> {
  const validatedFields: Record<string, unknown> = {};
  const fieldErrors: string[] = [];
  
  // System fields that are always required and allowed even if not in entity type
  const systemFields = ['name', 'slug'];
  
  for (const [fieldId, value] of Object.entries(updates)) {
    // Find the field definition
    const fieldDef = entityType.fields.find(f => f.id === fieldId);
    
    // Allow system fields even if not in entity type definition
    const isSystemField = systemFields.includes(fieldId);
    
    if (!fieldDef && !isSystemField) {
      // Field doesn't exist in entity type and is not a system field - reject it
      fieldErrors.push(`Field '${fieldId}' is not defined in this entity type`);
      continue;
    }
    
    // For system fields without a definition, use basic validation
    if (isSystemField && !fieldDef) {
      // Basic validation for system fields
      if (fieldId === 'name' || fieldId === 'slug') {
        if (value !== undefined && value !== null && typeof value !== 'string') {
          fieldErrors.push(`Field '${fieldId}' must be a string`);
          continue;
        }
        // Allow empty strings - requirement check happens at API level
        // This ensures slug is always in validatedFields even if empty
      }
      validatedFields[fieldId] = value;
      continue;
    }
    
    // Validate this specific field value using field definition
    try {
      validateFieldValue(fieldDef!, value);
      validatedFields[fieldId] = value; // Only add if valid
    } catch (error) {
      if (error instanceof ValidationError) {
        fieldErrors.push(error.message);
      } else {
        fieldErrors.push(`Field '${fieldDef!.name}': ${error instanceof Error ? error.message : 'Invalid value'}`);
      }
    }
  }
  
  // If any fields are invalid, reject the entire request
  if (fieldErrors.length > 0) {
    throw new ValidationError('Invalid field values', { fields: fieldErrors });
  }
  
  return validatedFields;
}

/**
 * Check if a slug is unique for the given entity type and organization
 * Uses slug index for efficient checking (O(1) file existence check)
 * 
 * @param bucket - R2 bucket instance
 * @param entityTypeId - The entity type ID
 * @param organizationId - The organization ID (null for global entities)
 * @param slug - The slug to check
 * @param ability - User's CASL ability (required for R2 access)
 * @throws ConflictError if slug already exists
 */
export async function checkSlugUniqueness(
  bucket: R2Bucket,
  entityTypeId: string,
  organizationId: string | null,
  slug: string,
  ability: AppAbility | null
): Promise<void> {
  console.log('[SlugValidation] Checking slug uniqueness:', { entityTypeId, organizationId, slug });
  
  // Get entity type to get typeSlug for slug index path
  const entityType = await readJSON<EntityType>(bucket, getEntityTypePath(entityTypeId), ability, 'read', 'EntityType');
  if (!entityType) {
    throw new ValidationError(`Entity type ${entityTypeId} not found`);
  }
  
  const typeSlug = entityType.slug;
  
  // Check slug index - if file exists, slug is already taken
  const exists = await slugIndexExists(bucket, organizationId, typeSlug, slug, ability);
  
  if (exists) {
    console.log('[SlugValidation] Slug conflict detected via slug index:', slug);
    const orgContext = organizationId 
      ? `in this organization` 
      : `for this entity type`;
    throw new ConflictError(
      `Slug '${slug}' already exists ${orgContext}`
    );
  }
  
  console.log('[SlugValidation] Slug is unique:', slug);
}
