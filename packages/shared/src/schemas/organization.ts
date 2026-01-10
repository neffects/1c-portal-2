/**
 * Organization validation schemas
 */

import { z } from 'zod';

/**
 * Organization slug validation
 */
export const orgSlugSchema = z
  .string()
  .min(2, 'Slug must be at least 2 characters')
  .max(50, 'Slug must not exceed 50 characters')
  .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
  .refine(s => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with a hyphen');

/**
 * Domain whitelist item schema
 */
export const domainSchema = z
  .string()
  .min(3, 'Domain must be at least 3 characters')
  .max(255, 'Domain must not exceed 255 characters')
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i, 'Invalid domain format')
  .toLowerCase();

/**
 * Organization profile schema
 */
export const organizationProfileSchema = z.object({
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
  logoDarkUrl: z.string().url().optional(),
  website: z.string().url().optional(),
  contactEmail: z.string().email().optional()
});

/**
 * Organization settings schema
 */
export const organizationSettingsSchema = z.object({
  domainWhitelist: z.array(domainSchema).max(20).default([]),
  allowSelfSignup: z.boolean().default(false),
  branding: z.object({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
  }).optional()
});

/**
 * Create organization request schema
 */
export const createOrganizationRequestSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must not exceed 100 characters'),
  slug: orgSlugSchema,
  description: z.string().max(500).optional(),
  domainWhitelist: z.array(domainSchema).max(20).optional(),
  allowSelfSignup: z.boolean().optional()
});

/**
 * Update organization request schema
 */
export const updateOrganizationRequestSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  slug: orgSlugSchema.optional(),
  profile: organizationProfileSchema.partial().optional(),
  settings: organizationSettingsSchema.partial().optional()
});

/**
 * Entity type permissions schema
 */
export const entityTypePermissionsSchema = z.object({
  viewable: z.array(z.string().length(7)),
  creatable: z.array(z.string().length(7))
});

/**
 * Update entity type permissions request schema
 */
export const updateEntityTypePermissionsRequestSchema = z.object({
  viewable: z.array(z.string().length(7)).optional(),
  creatable: z.array(z.string().length(7)).optional()
});

// Type exports
export type CreateOrganizationInput = z.infer<typeof createOrganizationRequestSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationRequestSchema>;
export type EntityTypePermissionsInput = z.infer<typeof entityTypePermissionsSchema>;
