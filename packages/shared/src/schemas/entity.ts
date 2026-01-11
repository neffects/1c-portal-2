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
 */
export const createEntityRequestSchema = z.object({
  entityTypeId: entityIdSchema,
  data: z.record(z.unknown()),
  visibility: visibilityScopeSchema.optional(),
  organizationId: entityIdSchema.nullable().optional() // Allow null for global entities (superadmin only)
});

/**
 * Update entity request schema (atomic field updates)
 */
export const updateEntityRequestSchema = z.object({
  data: z.record(z.unknown()).optional(),
  visibility: visibilityScopeSchema.optional()
}).refine(
  data => data.data !== undefined || data.visibility !== undefined,
  { message: 'At least one field must be provided for update' }
);

/**
 * Entity transition actions
 */
export const entityTransitionActionSchema = z.enum([
  'submitForApproval',
  'approve',
  'reject',
  'archive',
  'restore',
  'delete'
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
 * Supports per-row id, organizationId, and slug
 * - id: optional - if provided, updates existing entity or creates with that ID
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
  organizationId: entityIdSchema.nullable().optional() // Per-row org (overrides request-level)
});

/**
 * Bulk import request schema
 */
export const bulkImportRequestSchema = z.object({
  entityTypeId: entityIdSchema,
  organizationId: entityIdSchema.nullable().optional(), // Target org (null for global)
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
