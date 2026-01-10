/**
 * Constants Tests
 *
 * Verify exported constants have expected values.
 */

import { describe, it, expect } from 'vitest';
import {
  ENTITY_ID_LENGTH,
  ENTITY_ID_ALPHABET,
  JWT_ALGORITHM,
  JWT_EXPIRY_SECONDS,
  MAGIC_LINK_EXPIRY_SECONDS,
  ENTITY_STATUSES,
  USER_ROLES,
  VISIBILITY_SCOPES,
  FIELD_TYPES,
  R2_PATHS,
  API_ROUTES
} from './constants';

describe('Constants', () => {
  describe('Entity ID configuration', () => {
    it('should have correct ID length', () => {
      expect(ENTITY_ID_LENGTH).toBe(7);
    });

    it('should have lowercase alphanumeric alphabet', () => {
      expect(ENTITY_ID_ALPHABET).toBe('0123456789abcdefghijklmnopqrstuvwxyz');
      expect(ENTITY_ID_ALPHABET).toMatch(/^[0-9a-z]+$/);
    });
  });

  describe('JWT configuration', () => {
    it('should use HS256 algorithm', () => {
      expect(JWT_ALGORITHM).toBe('HS256');
    });

    it('should have 7-day expiry', () => {
      expect(JWT_EXPIRY_SECONDS).toBe(604800);
      expect(JWT_EXPIRY_SECONDS).toBe(7 * 24 * 60 * 60);
    });

    it('should have 10-minute magic link expiry', () => {
      expect(MAGIC_LINK_EXPIRY_SECONDS).toBe(600);
      expect(MAGIC_LINK_EXPIRY_SECONDS).toBe(10 * 60);
    });
  });

  describe('Entity statuses', () => {
    it('should include all required statuses', () => {
      expect(ENTITY_STATUSES).toContain('draft');
      expect(ENTITY_STATUSES).toContain('pending');
      expect(ENTITY_STATUSES).toContain('published');
      expect(ENTITY_STATUSES).toContain('archived');
      expect(ENTITY_STATUSES).toContain('deleted');
    });

    it('should have exactly 5 statuses', () => {
      expect(ENTITY_STATUSES).toHaveLength(5);
    });
  });

  describe('User roles', () => {
    it('should include all required roles', () => {
      expect(USER_ROLES).toContain('superadmin');
      expect(USER_ROLES).toContain('org_admin');
      expect(USER_ROLES).toContain('org_member');
    });

    it('should have exactly 3 roles', () => {
      expect(USER_ROLES).toHaveLength(3);
    });
  });

  describe('Visibility scopes', () => {
    it('should include all required scopes', () => {
      expect(VISIBILITY_SCOPES).toContain('public');
      expect(VISIBILITY_SCOPES).toContain('authenticated');
      expect(VISIBILITY_SCOPES).toContain('members');
    });

    it('should have exactly 3 scopes', () => {
      expect(VISIBILITY_SCOPES).toHaveLength(3);
    });
  });

  describe('Field types', () => {
    it('should include basic field types', () => {
      expect(FIELD_TYPES).toContain('string');
      expect(FIELD_TYPES).toContain('text');
      expect(FIELD_TYPES).toContain('number');
      expect(FIELD_TYPES).toContain('boolean');
      expect(FIELD_TYPES).toContain('date');
    });

    it('should include selection types', () => {
      expect(FIELD_TYPES).toContain('select');
      expect(FIELD_TYPES).toContain('multiselect');
    });

    it('should include media types', () => {
      expect(FIELD_TYPES).toContain('image');
      expect(FIELD_TYPES).toContain('logo');
      expect(FIELD_TYPES).toContain('file');
    });

    it('should include special types', () => {
      expect(FIELD_TYPES).toContain('markdown');
      expect(FIELD_TYPES).toContain('link');
      expect(FIELD_TYPES).toContain('country');
    });
  });

  describe('R2 paths', () => {
    it('should have all required path prefixes', () => {
      expect(R2_PATHS.CONFIG).toBe('config/');
      expect(R2_PATHS.PUBLIC).toBe('public/');
      expect(R2_PATHS.PLATFORM).toBe('platform/');
      expect(R2_PATHS.PRIVATE).toBe('private/');
      expect(R2_PATHS.STUBS).toBe('stubs/');
      expect(R2_PATHS.SECRET).toBe('secret/');
    });

    it('should have trailing slashes', () => {
      Object.values(R2_PATHS).forEach(path => {
        expect(path).toMatch(/\/$/);
      });
    });
  });

  describe('API routes', () => {
    it('should have all required routes', () => {
      expect(API_ROUTES.AUTH).toBe('/auth');
      expect(API_ROUTES.ORGANIZATIONS).toBe('/organizations');
      expect(API_ROUTES.ENTITY_TYPES).toBe('/entity-types');
      expect(API_ROUTES.ENTITIES).toBe('/entities');
      expect(API_ROUTES.USERS).toBe('/users');
    });
  });
});
