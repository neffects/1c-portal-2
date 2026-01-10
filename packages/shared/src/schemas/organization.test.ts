/**
 * Organization Schema Tests
 *
 * Tests for organization validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  orgSlugSchema,
  domainSchema,
  organizationProfileSchema,
  organizationSettingsSchema,
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
  entityTypePermissionsSchema
} from './organization';

describe('Organization Schemas', () => {
  describe('orgSlugSchema', () => {
    it('should accept valid slugs', () => {
      expect(orgSlugSchema.safeParse('my-org').success).toBe(true);
      expect(orgSlugSchema.safeParse('org123').success).toBe(true);
      expect(orgSlugSchema.safeParse('ab').success).toBe(true);
    });

    it('should reject slugs less than 2 chars', () => {
      expect(orgSlugSchema.safeParse('a').success).toBe(false);
    });

    it('should reject slugs over 50 chars', () => {
      const longSlug = 'a'.repeat(51);
      expect(orgSlugSchema.safeParse(longSlug).success).toBe(false);
    });

    it('should reject slugs with uppercase', () => {
      expect(orgSlugSchema.safeParse('My-Org').success).toBe(false);
    });

    it('should reject slugs starting with hyphen', () => {
      expect(orgSlugSchema.safeParse('-my-org').success).toBe(false);
    });

    it('should reject slugs ending with hyphen', () => {
      expect(orgSlugSchema.safeParse('my-org-').success).toBe(false);
    });

    it('should reject slugs with special characters', () => {
      expect(orgSlugSchema.safeParse('my_org').success).toBe(false);
      expect(orgSlugSchema.safeParse('my.org').success).toBe(false);
      expect(orgSlugSchema.safeParse('my org').success).toBe(false);
    });
  });

  describe('domainSchema', () => {
    it('should accept valid domains', () => {
      expect(domainSchema.safeParse('example.com').success).toBe(true);
      expect(domainSchema.safeParse('sub.example.com').success).toBe(true);
      expect(domainSchema.safeParse('my-company.co.uk').success).toBe(true);
    });

    it('should convert to lowercase', () => {
      const result = domainSchema.safeParse('EXAMPLE.COM');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('example.com');
      }
    });

    it('should reject domains less than 3 chars', () => {
      expect(domainSchema.safeParse('ab').success).toBe(false);
    });

    it('should reject domains over 255 chars', () => {
      const longDomain = 'a'.repeat(256);
      expect(domainSchema.safeParse(longDomain).success).toBe(false);
    });

    it('should reject domains starting with hyphen', () => {
      expect(domainSchema.safeParse('-example.com').success).toBe(false);
    });

    it('should reject domains that start or end with special chars', () => {
      expect(domainSchema.safeParse('.example.com').success).toBe(false);
    });
  });

  describe('organizationProfileSchema', () => {
    it('should accept valid profile', () => {
      const result = organizationProfileSchema.safeParse({
        description: 'A test organization',
        logoUrl: 'https://example.com/logo.png',
        website: 'https://example.com',
        contactEmail: 'contact@example.com'
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty profile', () => {
      const result = organizationProfileSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject description over 500 chars', () => {
      const result = organizationProfileSchema.safeParse({
        description: 'a'.repeat(501)
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid URL', () => {
      const result = organizationProfileSchema.safeParse({
        website: 'not-a-url'
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = organizationProfileSchema.safeParse({
        contactEmail: 'not-an-email'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('organizationSettingsSchema', () => {
    it('should accept valid settings', () => {
      const result = organizationSettingsSchema.safeParse({
        domainWhitelist: ['example.com', 'test.com'],
        allowSelfSignup: true,
        branding: {
          primaryColor: '#FF5500',
          accentColor: '#0055FF'
        }
      });
      expect(result.success).toBe(true);
    });

    it('should use defaults for empty object', () => {
      const result = organizationSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.domainWhitelist).toEqual([]);
        expect(result.data.allowSelfSignup).toBe(false);
      }
    });

    it('should reject more than 20 domains', () => {
      const domains = Array(21).fill('example.com').map((d, i) => `${i}.${d}`);
      const result = organizationSettingsSchema.safeParse({
        domainWhitelist: domains
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid hex color', () => {
      const result = organizationSettingsSchema.safeParse({
        branding: {
          primaryColor: 'red'
        }
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid 6-digit hex colors', () => {
      const result = organizationSettingsSchema.safeParse({
        branding: {
          primaryColor: '#AABBCC'
        }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createOrganizationRequestSchema', () => {
    it('should accept valid create request', () => {
      const result = createOrganizationRequestSchema.safeParse({
        name: 'Test Organization',
        slug: 'test-org'
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const result = createOrganizationRequestSchema.safeParse({
        name: 'Test Organization',
        slug: 'test-org',
        description: 'A test organization',
        domainWhitelist: ['example.com'],
        allowSelfSignup: true
      });
      expect(result.success).toBe(true);
    });

    it('should reject name less than 2 chars', () => {
      const result = createOrganizationRequestSchema.safeParse({
        name: 'A',
        slug: 'test-org'
      });
      expect(result.success).toBe(false);
    });

    it('should reject name over 100 chars', () => {
      const result = createOrganizationRequestSchema.safeParse({
        name: 'A'.repeat(101),
        slug: 'test-org'
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing name', () => {
      const result = createOrganizationRequestSchema.safeParse({
        slug: 'test-org'
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing slug', () => {
      const result = createOrganizationRequestSchema.safeParse({
        name: 'Test Organization'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateOrganizationRequestSchema', () => {
    it('should accept partial updates', () => {
      const result = updateOrganizationRequestSchema.safeParse({
        name: 'Updated Name'
      });
      expect(result.success).toBe(true);
    });

    it('should accept profile updates', () => {
      const result = updateOrganizationRequestSchema.safeParse({
        profile: {
          description: 'Updated description'
        }
      });
      expect(result.success).toBe(true);
    });

    it('should accept settings updates', () => {
      const result = updateOrganizationRequestSchema.safeParse({
        settings: {
          allowSelfSignup: true
        }
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const result = updateOrganizationRequestSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('entityTypePermissionsSchema', () => {
    it('should accept valid permissions', () => {
      const result = entityTypePermissionsSchema.safeParse({
        viewable: ['type123', 'type456'],
        creatable: ['type123']
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type IDs (wrong length)', () => {
      const result = entityTypePermissionsSchema.safeParse({
        viewable: ['invalid-id'],
        creatable: []
      });
      expect(result.success).toBe(false);
    });

    it('should accept empty arrays', () => {
      const result = entityTypePermissionsSchema.safeParse({
        viewable: [],
        creatable: []
      });
      expect(result.success).toBe(true);
    });
  });
});
