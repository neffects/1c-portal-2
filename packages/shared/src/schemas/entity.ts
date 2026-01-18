/**
 * Entity validation schemas
 */

import { z } from 'zod';
import { ENTITY_STATUSES, VISIBILITY_SCOPES, ENTITY_ID_LENGTH } from '../constants';

/**
 * Entity ID schema (7-char NanoID format)
 */
export const entityIdSchema = z
  .string()
  .length(ENTITY_ID_LENGTH, `Entity ID must be exactly ${ENTITY_ID_LENGTH} characters`)
  .regex(/^[a-z0-9]+$/, 'Entity ID can only contain lowercase letters and numbers');

/**
 * Entity status schema
 */
export const entityStatusSchema = z.enum(ENTITY_STATUSES);

/**
 * Visibility scope schema
 */
export const visibilityScopeSchema = z.enum(VISIBILITY_SCOPES);

/**
 * Entity slug schema
 */
export const entitySlugSchema = z
  .string()
  .min(1, 'Slug is required')
  .max(100, 'Slug must not exceed 100 characters')
  .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens');

/**
 * Create entity request schema
 * 
 * name and slug are top-level required fields (stored as entity.name and entity.slug)
 * data contains only dynamic fields defined by the entity type
 */
export const createEntityRequestSchema = z.object({
  entityTypeId: entityIdSchema,
  name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
  slug: entitySlugSchema,
  data: z.record(z.unknown()).optional().default({}), // Dynamic fields only
  visibility: visibilityScopeSchema.optional(),
  organizationId: entityIdSchema.nullable().optional() // Allow null for global entities (superadmin only)
});

/**
 * Update entity request schema (atomic field updates)
 * 
 * name and slug can be updated as top-level fields
 * data contains only dynamic fields defined by the entity type
 */
export const updateEntityRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: entitySlugSchema.optional(),
  data: z.record(z.unknown()).optional(),
  visibility: visibilityScopeSchema.optional()
}).refine(
  data => data.name !== undefined || data.slug !== undefined || data.data !== undefined || data.visibility !== undefined,
  { message: 'At least one field must be provided for update' }
);

/**
 * Entity transition actions
 * 
 * Standard actions:
 * - submitForApproval: draft -> pending
 * - approve: pending -> published
 * - reject: pending -> draft
 * - archive: published -> archived
 * - restore: archived/deleted -> draft
 * - delete: draft -> deleted (soft delete)
 * 
 * Superadmin-only actions:
 * - superDelete: Any status -> permanently removed (hard delete)
 */
export const entityTransitionActionSchema = z.enum([
  'submitForApproval',
  'approve',
  'reject',
  'archive',
  'restore',
  'delete',
  'superDelete' // Superadmin only - permanently removes entity from storage
]);

/**
 * Entity transition request schema
 */
export const entityTransitionRequestSchema = z.object({
  action: entityTransitionActionSchema,
  feedback: z.string().max(1000).optional()
});

/**
 * Entity query parameters schema
 */
export const entityQueryParamsSchema = z.object({
  typeId: entityIdSchema.optional(),
  status: entityStatusSchema.optional(),
  visibility: visibilityScopeSchema.optional(),
  organizationId: entityIdSchema.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Entity version query schema
 */
export const entityVersionQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional()
});

/**
 * Export query parameters schema
 */
export const exportQuerySchema = z.object({
  typeId: entityIdSchema,
  status: entityStatusSchema.optional(),
  organizationId: entityIdSchema.nullable().optional()
});

/**
 * Single entity for bulk import
 * Supports per-row id, organizationId, organizationSlug, and slug
 * - id: optional - if provided, updates existing entity or creates with that ID
 * - organizationId: optional - organization ID (can use organizationSlug instead)
 * - organizationSlug: optional - organization slug (alternative to organizationId)
 * - slug: optional - entity slug (can be used with slug lookup if id is empty)
 * - shouldUpdate: optional - per-entity update flag (for mixed mode)
 * - updateMode: optional - per-entity update mode override (in-place or increment-version)
 * - If id is empty/missing, a new entity is created with a generated ID
 */
export const bulkImportEntitySchema = z.object({
  id: entityIdSchema.optional(), // Entity ID for update or create with specific ID
  data: z.record(z.unknown()),
  visibility: visibilityScopeSchema.optional(),
  slug: z.string()
    .max(100, 'Slug must not exceed 100 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  organizationId: entityIdSchema.nullable().optional(), // Per-row org ID (overrides request-level)
  organizationSlug: z.string().optional(), // Per-row org slug (alternative to organizationId)
  shouldUpdate: z.boolean().optional(), // Per-entity update flag (for mixed mode)
  updateMode: z.enum(['in-place', 'increment-version']).optional() // Per-entity update mode override
});

/**
 * Bulk import request schema
 */
export const bulkImportRequestSchema = z.object({
  entityTypeId: entityIdSchema,
  organizationId: entityIdSchema.nullable().optional(), // Target org (null for global) - default for all entities
  importMode: z.enum(['add-new', 'update', 'mixed']).optional().default('add-new'), // Import mode: add-new only, update only, or mixed (per-entity)
  updateMode: z.enum(['in-place', 'increment-version']).optional().default('increment-version'), // Global update mode (per-entity can override)
  entities: z.array(bulkImportEntitySchema).min(1).max(1000)
});

/**
 * Bulk import error schema (for validation errors)
 */
export const bulkImportErrorSchema = z.object({
  rowIndex: z.number(), // 0-based index in entities array
  field: z.string().optional(), // Field that caused error (if applicable)
  message: z.string()
});

// Type exports
export type CreateEntityInput = z.infer<typeof createEntityRequestSchema>;
export type UpdateEntityInput = z.infer<typeof updateEntityRequestSchema>;
export type EntityTransitionInput = z.infer<typeof entityTransitionRequestSchema>;
export type EntityQueryParams = z.infer<typeof entityQueryParamsSchema>;
export type ExportQueryParams = z.infer<typeof exportQuerySchema>;
export type BulkImportEntity = z.infer<typeof bulkImportEntitySchema>;
export type BulkImportRequest = z.infer<typeof bulkImportRequestSchema>;
export type BulkImportError = z.infer<typeof bulkImportErrorSchema>;
