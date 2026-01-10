/**
 * Authentication validation schemas
 */

import { z } from 'zod';

/**
 * Email validation schema
 */
export const emailSchema = z
  .string()
  .email('Invalid email address')
  .min(5, 'Email must be at least 5 characters')
  .max(255, 'Email must not exceed 255 characters')
  .toLowerCase();

/**
 * Magic link request schema
 */
export const magicLinkRequestSchema = z.object({
  email: emailSchema
});

/**
 * Magic link verification schema
 */
export const verifyTokenSchema = z.object({
  token: z
    .string()
    .min(32, 'Invalid token')
    .max(128, 'Invalid token')
});

/**
 * JWT payload schema
 */
export const jwtPayloadSchema = z.object({
  sub: z.string(),
  email: emailSchema,
  role: z.enum(['superadmin', 'org_admin', 'org_member']),
  organizationId: z.string().nullable(),
  iat: z.number(),
  exp: z.number()
});

/**
 * Refresh token request schema
 */
export const refreshTokenRequestSchema = z.object({
  token: z.string()
});

// Type exports
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
export type JWTPayloadInput = z.infer<typeof jwtPayloadSchema>;
