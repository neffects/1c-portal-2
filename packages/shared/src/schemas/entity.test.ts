/**
 * Entity Schema Tests
 *
 * Tests for entity validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  entityIdSchema,
  entityStatusSchema,
  visibilityScopeSchema,
  entitySlugSchema,
  createEntityRequestSchema,
  updateEntityRequestSchema,
  entityTransitionRequestSchema,
  entityQueryParamsSchema
} from './entity';

describe('Entity Schemas', () => {
  describe('entityIdSchema', () => {
    it('should accept valid 7-char lowercase alphanumeric ID', () => {
      expect(entityIdSchema.safeParse('abc1234').success).toBe(true);
      expect(entityIdSchema.safeParse('0000000').success).toBe(true);
      expect(entityIdSchema.safeParse('zzzzzzz').success).toBe(true);
    });

    it('should reject IDs with wrong length', () => {
      expect(entityIdSchema.safeParse('abc123').success).toBe(false);
      expect(entityIdSchema.safeParse('abc12345').success).toBe(false);
      expect(entityIdSchema.safeParse('').success).toBe(false);
    });

    it('should reject IDs with uppercase letters', () => {
      expect(entityIdSchema.safeParse('ABC1234').success).toBe(false);
      expect(entityIdSchema.safeParse('Abc1234').success).toBe(false);
    });

    it('should reject IDs with special characters', () => {
      expect(entityIdSchema.safeParse('abc-123').success).toBe(false);
      expect(entityIdSchema.safeParse('abc_123').success).toBe(false);
      expect(entityIdSchema.safeParse('abc 123').success).toBe(false);
    });
  });

  describe('entityStatusSchema', () => {
    it('should accept valid statuses', () => {
      expect(entityStatusSchema.safeParse('draft').success).toBe(true);
      expect(entityStatusSchema.safeParse('pending').success).toBe(true);
      expect(entityStatusSchema.safeParse('published').success).toBe(true);
      expect(entityStatusSchema.safeParse('archived').success).toBe(true);
      expect(entityStatusSchema.safeParse('deleted').success).toBe(true);
    });

    it('should reject invalid statuses', () => {
      expect(entityStatusSchema.safeParse('invalid').success).toBe(false);
      expect(entityStatusSchema.safeParse('').success).toBe(false);
      expect(entityStatusSchema.safeParse('DRAFT').success).toBe(false);
    });
  });

  describe('visibilityScopeSchema', () => {
    it('should accept valid visibility scopes', () => {
      expect(visibilityScopeSchema.safeParse('public').success).toBe(true);
      expect(visibilityScopeSchema.safeParse('authenticated').success).toBe(true);
      expect(visibilityScopeSchema.safeParse('members').success).toBe(true);
    });

    it('should reject invalid visibility scopes', () => {
      expect(visibilityScopeSchema.safeParse('private').success).toBe(false);
      expect(visibilityScopeSchema.safeParse('platform').success).toBe(false);
      expect(visibilityScopeSchema.safeParse('').success).toBe(false);
    });
  });

  describe('entitySlugSchema', () => {
    it('should accept valid slugs', () => {
      expect(entitySlugSchema.safeParse('my-entity').success).toBe(true);
      expect(entitySlugSchema.safeParse('entity123').success).toBe(true);
      expect(entitySlugSchema.safeParse('a').success).toBe(true);
    });

    it('should reject empty slugs', () => {
      expect(entitySlugSchema.safeParse('').success).toBe(false);
    });

    it('should reject slugs over 100 chars', () => {
      const longSlug = 'a'.repeat(101);
      expect(entitySlugSchema.safeParse(longSlug).success).toBe(false);
    });

    it('should reject slugs with uppercase letters', () => {
      expect(entitySlugSchema.safeParse('My-Entity').success).toBe(false);
    });

    it('should reject slugs with spaces or special chars', () => {
      expect(entitySlugSchema.safeParse('my entity').success).toBe(false);
      expect(entitySlugSchema.safeParse('my_entity').success).toBe(false);
      expect(entitySlugSchema.safeParse('my.entity').success).toBe(false);
    });
  });

  describe('createEntityRequestSchema', () => {
    it('should accept valid create request', () => {
      const result = createEntityRequestSchema.safeParse({
        entityTypeId: 'type123',
        data: { name: 'Test Entity', slug: 'test-entity' }
      });
      expect(result.success).toBe(true);
    });

    it('should accept request with optional visibility', () => {
      const result = createEntityRequestSchema.safeParse({
        entityTypeId: 'type123',
        data: { name: 'Test' },
        visibility: 'public'
      });
      expect(result.success).toBe(true);
    });

    it('should accept request with optional organizationId', () => {
      const result = createEntityRequestSchema.safeParse({
        entityTypeId: 'type123',
        data: { name: 'Test' },
        organizationId: 'org1234'
      });
      expect(result.success).toBe(true);
    });

    it('should reject request without entityTypeId', () => {
      const result = createEntityRequestSchema.safeParse({
        data: { name: 'Test' }
      });
      expect(result.success).toBe(false);
    });

    it('should reject request without data', () => {
      const result = createEntityRequestSchema.safeParse({
        entityTypeId: 'type123'
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid entityTypeId', () => {
      const result = createEntityRequestSchema.safeParse({
        entityTypeId: 'invalid-id',
        data: { name: 'Test' }
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateEntityRequestSchema', () => {
    it('should accept update with data', () => {
      const result = updateEntityRequestSchema.safeParse({
        data: { name: 'Updated Name' }
      });
      expect(result.success).toBe(true);
    });

    it('should accept update with visibility', () => {
      const result = updateEntityRequestSchema.safeParse({
        visibility: 'members'
      });
      expect(result.success).toBe(true);
    });

    it('should accept update with both data and visibility', () => {
      const result = updateEntityRequestSchema.safeParse({
        data: { name: 'Updated' },
        visibility: 'public'
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty update', () => {
      const result = updateEntityRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject update with invalid visibility', () => {
      const result = updateEntityRequestSchema.safeParse({
        visibility: 'invalid'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('entityTransitionRequestSchema', () => {
    it('should accept valid transition actions', () => {
      const actions = ['submitForApproval', 'approve', 'reject', 'archive', 'restore', 'delete'];
      for (const action of actions) {
        const result = entityTransitionRequestSchema.safeParse({ action });
        expect(result.success).toBe(true);
      }
    });

    it('should accept transition with feedback', () => {
      const result = entityTransitionRequestSchema.safeParse({
        action: 'reject',
        feedback: 'Please fix the typos'
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid action', () => {
      const result = entityTransitionRequestSchema.safeParse({
        action: 'invalid'
      });
      expect(result.success).toBe(false);
    });

    it('should reject feedback over 1000 chars', () => {
      const result = entityTransitionRequestSchema.safeParse({
        action: 'reject',
        feedback: 'a'.repeat(1001)
      });
      expect(result.success).toBe(false);
    });
  });

  describe('entityQueryParamsSchema', () => {
    it('should accept empty query (uses defaults)', () => {
      const result = entityQueryParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
        expect(result.data.sortDirection).toBe('desc');
      }
    });

    it('should accept valid filter parameters', () => {
      const result = entityQueryParamsSchema.safeParse({
        typeId: 'type123',
        status: 'published',
        visibility: 'public',
        organizationId: 'org1234'
      });
      expect(result.success).toBe(true);
    });

    it('should accept pagination parameters', () => {
      const result = entityQueryParamsSchema.safeParse({
        page: 2,
        pageSize: 50
      });
      expect(result.success).toBe(true);
    });

    it('should coerce string numbers', () => {
      const result = entityQueryParamsSchema.safeParse({
        page: '3',
        pageSize: '25'
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.pageSize).toBe(25);
      }
    });

    it('should reject pageSize over 100', () => {
      const result = entityQueryParamsSchema.safeParse({
        pageSize: 101
      });
      expect(result.success).toBe(false);
    });

    it('should reject page less than 1', () => {
      const result = entityQueryParamsSchema.safeParse({
        page: 0
      });
      expect(result.success).toBe(false);
    });
  });
});
