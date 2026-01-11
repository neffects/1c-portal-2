/**
 * Entity Type Schema Tests
 *
 * Tests for entity type and field validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  fieldTypeSchema,
  fieldConstraintsSchema,
  fieldDefinitionSchema,
  createEntityTypeRequestSchema
} from './entity-type';

describe('Entity Type Schemas', () => {
  describe('fieldTypeSchema', () => {
    it('should accept all valid field types', () => {
      const validTypes = [
        'string', 'text', 'markdown', 'number', 'boolean',
        'date', 'select', 'multiselect', 'link', 'weblink',
        'image', 'logo', 'file', 'country'
      ];

      for (const type of validTypes) {
        const result = fieldTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid field types', () => {
      expect(fieldTypeSchema.safeParse('invalid').success).toBe(false);
      expect(fieldTypeSchema.safeParse('').success).toBe(false);
      expect(fieldTypeSchema.safeParse('STRING').success).toBe(false);
    });
  });

  describe('fieldConstraintsSchema - weblink', () => {
    it('should accept valid weblink constraints', () => {
      const result = fieldConstraintsSchema.safeParse({
        allowAlias: true,
        requireHttps: false
      });
      expect(result.success).toBe(true);
    });

    it('should accept weblink with alias disabled', () => {
      const result = fieldConstraintsSchema.safeParse({
        allowAlias: false,
        requireHttps: true
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty constraints for weblink', () => {
      const result = fieldConstraintsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject non-boolean allowAlias', () => {
      const result = fieldConstraintsSchema.safeParse({
        allowAlias: 'true'
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean requireHttps', () => {
      const result = fieldConstraintsSchema.safeParse({
        requireHttps: 'false'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('fieldDefinitionSchema - weblink field', () => {
    it('should accept valid weblink field definition', () => {
      const result = fieldDefinitionSchema.safeParse({
        id: 'website_url',
        name: 'Website URL',
        type: 'weblink',
        required: true,
        description: 'Organization website',
        constraints: {
          allowAlias: true,
          requireHttps: true
        },
        displayOrder: 0,
        sectionId: 'main',
        showInTable: true
      });
      expect(result.success).toBe(true);
    });

    it('should accept weblink field without constraints', () => {
      const result = fieldDefinitionSchema.safeParse({
        id: 'link_field',
        name: 'Link',
        type: 'weblink',
        required: false,
        displayOrder: 1,
        sectionId: 'section_1',
        showInTable: false
      });
      expect(result.success).toBe(true);
    });

    it('should reject weblink field with invalid id format', () => {
      const result = fieldDefinitionSchema.safeParse({
        id: 'Invalid-ID',
        name: 'Link',
        type: 'weblink',
        required: false,
        displayOrder: 0,
        sectionId: 'main',
        showInTable: false
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createEntityTypeRequestSchema - with weblink field', () => {
    it('should accept entity type with weblink field', () => {
      const result = createEntityTypeRequestSchema.safeParse({
        name: 'Tool',
        pluralName: 'Tools',
        slug: 'tools',
        description: 'Developer tools',
        defaultVisibility: 'public',
        fields: [
          {
            name: 'Name',
            type: 'string',
            required: true,
            displayOrder: 0,
            sectionId: 'main',
            showInTable: true
          },
          {
            name: 'Website',
            type: 'weblink',
            required: false,
            description: 'Tool website',
            constraints: {
              allowAlias: true,
              requireHttps: false
            },
            displayOrder: 1,
            sectionId: 'main',
            showInTable: true
          }
        ],
        sections: [
          {
            name: 'Main Information',
            displayOrder: 0
          }
        ]
      });
      expect(result.success).toBe(true);
    });

    it('should accept entity type with multiple weblink fields', () => {
      const result = createEntityTypeRequestSchema.safeParse({
        name: 'Organization',
        pluralName: 'Organizations',
        slug: 'organizations',
        defaultVisibility: 'public',
        fields: [
          {
            name: 'Name',
            type: 'string',
            required: true,
            displayOrder: 0,
            sectionId: 'main',
            showInTable: true
          },
          {
            name: 'Website',
            type: 'weblink',
            required: false,
            constraints: {
              allowAlias: true,
              requireHttps: true
            },
            displayOrder: 1,
            sectionId: 'main',
            showInTable: true
          },
          {
            name: 'Documentation',
            type: 'weblink',
            required: false,
            constraints: {
              allowAlias: false,
              requireHttps: false
            },
            displayOrder: 2,
            sectionId: 'main',
            showInTable: false
          }
        ],
        sections: [
          {
            name: 'Main Information',
            displayOrder: 0
          }
        ]
      });
      expect(result.success).toBe(true);
    });
  });

  describe('fieldConstraintsSchema - mixed field types', () => {
    it('should accept string constraints', () => {
      const result = fieldConstraintsSchema.safeParse({
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z]+$'
      });
      expect(result.success).toBe(true);
    });

    it('should accept number constraints', () => {
      const result = fieldConstraintsSchema.safeParse({
        minValue: 0,
        maxValue: 100
      });
      expect(result.success).toBe(true);
    });

    it('should accept link constraints', () => {
      const result = fieldConstraintsSchema.safeParse({
        linkEntityTypeId: 'type123',
        allowMultiple: true
      });
      expect(result.success).toBe(true);
    });

    it('should accept file constraints', () => {
      const result = fieldConstraintsSchema.safeParse({
        fileTypes: ['.pdf', '.doc'],
        maxFileSize: 5242880
      });
      expect(result.success).toBe(true);
    });
  });
});
