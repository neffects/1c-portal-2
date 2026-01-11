/**
 * Entity Type validation schemas
 */

import { z } from 'zod';
import { FIELD_TYPES, VISIBILITY_SCOPES } from '../constants';
import { entityIdSchema, entitySlugSchema, visibilityScopeSchema } from './entity';

/**
 * Field type schema
 */
export const fieldTypeSchema = z.enum(FIELD_TYPES);

/**
 * Select option schema
 */
export const selectOptionSchema = z.object({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});

/**
 * Field constraints schema
 */
export const fieldConstraintsSchema = z.object({
  // String/Text/Markdown
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  
  // Number
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  
  // Select/Multiselect
  options: z.array(selectOptionSchema).optional(),
  
  // Link
  linkEntityTypeId: z.string().length(7).optional(),
  allowMultiple: z.boolean().optional(),
  
  // WebLink
  allowAlias: z.boolean().optional(),
  requireHttps: z.boolean().optional(),
  
  // File/Image/Logo
  fileTypes: z.array(z.string()).optional(),
  maxFileSize: z.number().int().positive().optional(),
  
  // Country
  includeCountryName: z.boolean().optional(),
  includeCountryCode: z.boolean().optional(),
  includeDialCode: z.boolean().optional(),
  includeFlag: z.boolean().optional(),
  
  // Validation pattern
  pattern: z.string().optional(),
  patternMessage: z.string().max(200).optional()
}).optional();

/**
 * Field definition schema
 */
export const fieldDefinitionSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Field ID must be lowercase with underscores'),
  name: z.string().min(1).max(100),
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  description: z.string().max(500).optional(),
  constraints: fieldConstraintsSchema,
  displayOrder: z.number().int().nonnegative(),
  sectionId: z.string().min(1).max(50),
  showInTable: z.boolean().default(false),
  defaultValue: z.unknown().optional()
});

/**
 * Field section schema
 */
export const fieldSectionSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Section ID must be lowercase with underscores'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  displayOrder: z.number().int().nonnegative(),
  collapsible: z.boolean().optional(),
  defaultCollapsed: z.boolean().optional()
});

/**
 * Table display config schema
 */
export const tableDisplayConfigSchema = z.object({
  showName: z.boolean().default(true),
  showStatus: z.boolean().default(true),
  showUpdated: z.boolean().default(true),
  showOrganization: z.boolean().optional(),
  additionalColumns: z.array(z.string()).optional(),
  defaultSortField: z.string().optional(),
  defaultSortDirection: z.enum(['asc', 'desc']).optional()
});

/**
 * Create entity type request schema
 * Visibility options: 'public' | 'authenticated' | 'members'
 */
export const createEntityTypeRequestSchema = z.object({
  name: z.string().min(1).max(100),
  pluralName: z.string().min(1).max(100),
  slug: entitySlugSchema,
  description: z.string().max(500).optional(),
  defaultVisibility: visibilityScopeSchema.default('authenticated'),
  fields: z.array(fieldDefinitionSchema.omit({ id: true })).min(1),
  sections: z.array(fieldSectionSchema.omit({ id: true })).min(1)
});

/**
 * Update entity type request schema
 * Visibility options: 'public' | 'authenticated' | 'members'
 */
export const updateEntityTypeRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pluralName: z.string().min(1).max(100).optional(),
  slug: entitySlugSchema.optional(),
  description: z.string().max(500).optional(),
  defaultVisibility: visibilityScopeSchema.optional(),
  fields: z.array(fieldDefinitionSchema).optional(),
  sections: z.array(fieldSectionSchema).optional(),
  tableDisplayConfig: tableDisplayConfigSchema.optional()
});

/**
 * Entity type query parameters schema
 */
export const entityTypeQueryParamsSchema = z.object({
  search: z.string().max(100).optional(),
  includeInactive: z.coerce.boolean().default(false),
  // Permission filter: 'viewable' (default) or 'creatable'
  // - viewable: types the user's org can view (for browsing)
  // - creatable: types the user's org can create (for entity creation forms)
  permission: z.enum(['viewable', 'creatable']).default('viewable'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

// Type exports
export type FieldDefinitionInput = z.infer<typeof fieldDefinitionSchema>;
export type FieldSectionInput = z.infer<typeof fieldSectionSchema>;
export type CreateEntityTypeInput = z.infer<typeof createEntityTypeRequestSchema>;
export type UpdateEntityTypeInput = z.infer<typeof updateEntityTypeRequestSchema>;
