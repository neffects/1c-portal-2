/**
 * Configuration validation schemas
 */

import { z } from 'zod';

/**
 * URL schema that accepts both absolute and relative URLs
 */
const urlOrPathSchema = z.string().min(1).refine(
  (val) => {
    // Accept absolute URLs (http://, https://)
    if (val.startsWith('http://') || val.startsWith('https://')) {
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }
    // Accept relative paths starting with /
    if (val.startsWith('/')) {
      return true;
    }
    return false;
  },
  { message: 'Must be a valid URL (http:// or https://) or a relative path starting with /' }
);

/**
 * Branding configuration schema
 */
export const brandingConfigSchema = z.object({
  rootOrgId: z.string().min(1).optional(),
  siteName: z.string().min(1, 'Site name is required').max(100, 'Site name must not exceed 100 characters'),
  defaultTheme: z.enum(['light', 'dark']).default('light').optional(),
  logoUrl: urlOrPathSchema,
  logoDarkUrl: urlOrPathSchema.optional(),
  faviconUrl: urlOrPathSchema.optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Primary color must be a valid hex color (e.g., #FF5733)').optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Accent color must be a valid hex color (e.g., #FF5733)').optional(),
  privacyPolicyUrl: z.string().url('Privacy policy URL must be a valid URL').optional()
});

/**
 * Update branding configuration request schema
 */
export const updateBrandingRequestSchema = brandingConfigSchema.partial().required({
  siteName: true,
  logoUrl: true
});
