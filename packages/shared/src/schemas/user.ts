/**
 * User validation schemas
 */

import { z } from 'zod';
import { USER_ROLES } from '../constants';
import { emailSchema } from './auth';

/**
 * User role schema
 */
export const userRoleSchema = z.enum(USER_ROLES);

/**
 * Organization role schema (excludes superadmin)
 */
export const orgRoleSchema = z.enum(['org_admin', 'org_member']);

/**
 * User invitation request schema
 */
export const inviteUserRequestSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema,
  note: z.string().max(500).optional()
});

/**
 * Update user role request schema
 */
export const updateUserRoleRequestSchema = z.object({
  role: orgRoleSchema
});

/**
 * User preferences schema
 */
export const userPreferencesSchema = z.object({
  notifications: z.object({
    emailAlerts: z.boolean().default(true),
    alertFrequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    digestTime: z.string().optional()
  }).optional(),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    language: z.string().default('en')
  }).optional()
});

/**
 * Update user preferences request schema
 */
export const updateUserPreferencesRequestSchema = userPreferencesSchema.partial();

/**
 * Entity flag request schema
 */
export const flagEntityRequestSchema = z.object({
  entityId: z.string().length(7),
  note: z.string().max(500).optional()
});

/**
 * User profile update schema
 */
export const updateUserProfileSchema = z.object({
  name: z.string().min(1).max(100).optional()
});

/**
 * Add existing user to organization request schema (superadmin only)
 * This allows adding users who already exist in the system to an organization
 */
export const addUserToOrgRequestSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema
});

// Type exports
export type InviteUserInput = z.infer<typeof inviteUserRequestSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleRequestSchema>;
export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;
export type FlagEntityInput = z.infer<typeof flagEntityRequestSchema>;
export type AddUserToOrgInput = z.infer<typeof addUserToOrgRequestSchema>;