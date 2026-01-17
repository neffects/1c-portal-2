/**
 * CSV Utilities Tests
 * 
 * Tests for CSV parsing, generation, and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  generateCSV,
  generateTemplateRow,
  convertToImportData,
  validateImportData,
  generateSlug,
  isValidSlug,
  isValidEntityId
} from './csv';
import type { Entity, EntityType, FieldDefinition } from '@1cc/shared';

// Mock entity type for tests
const mockEntityType: EntityType = {
  id: 'type123',
  name: 'Product',
  pluralName: 'Products',
  slug: 'products',
  description: 'Test products',
  visibleTo: ['public'],
  fields: [
    { 
      id: 'name', 
      name: 'Name', 
      type: 'string', 
      required: true, 
      sectionId: 'main',
      displayOrder: 0,
      showInTable: true
    },
    { 
      id: 'description', 
      name: 'Description', 
      type: 'text', 
      required: false, 
      sectionId: 'main',
      displayOrder: 1,
      showInTable: false
    },
    { 
      id: 'price', 
      name: 'Price', 
      type: 'number', 
      required: true, 
      constraints: { minValue: 0, maxValue: 10000 },
      sectionId: 'main',
      displayOrder: 2,
      showInTable: true
    },
    { 
      id: 'category', 
      name: 'Category', 
      type: 'select', 
      required: true,
      constraints: { 
        options: [
          { value: 'electronics', label: 'Electronics' },
          { value: 'clothing', label: 'Clothing' },
          { value: 'food', label: 'Food' }
        ]
      },
      sectionId: 'main',
      displayOrder: 3,
      showInTable: true
    },
    { 
      id: 'tags', 
      name: 'Tags', 
      type: 'multiselect', 
      required: false,
      constraints: { 
        options: [
          { value: 'sale', label: 'Sale' },
          { value: 'new', label: 'New' },
          { value: 'featured', label: 'Featured' }
        ]
      },
      sectionId: 'main',
      displayOrder: 4,
      showInTable: false
    },
    { 
      id: 'active', 
      name: 'Active', 
      type: 'boolean', 
      required: false,
      sectionId: 'main',
      displayOrder: 5,
      showInTable: true
    }
  ],
  sections: [{ id: 'main', name: 'Main', displayOrder: 0 }],
  tableDisplayConfig: {
    showName: true,
    showStatus: true,
    showUpdated: true
  },
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: 'user1',
  updatedBy: 'user1'
};

// Mock entities for export tests
const mockEntities: Entity[] = [
  {
    id: 'ent1234',
    entityTypeId: 'type123',
    organizationId: null,
    version: 1,
    status: 'published',
    visibility: 'public',
    name: 'Test Product 1', // Top-level property
    slug: 'test-product-1', // Top-level property
    data: {
      // Dynamic fields only (name and slug not included)
      description: 'A great product',
      price: 99.99,
      category: 'electronics',
      tags: ['new', 'featured'],
      active: true
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'user1',
    updatedBy: 'user1'
  },
  {
    id: 'ent5678',
    entityTypeId: 'type123',
    organizationId: null,
    version: 1,
    status: 'draft',
    visibility: 'authenticated',
    name: 'Test Product 2', // Top-level property
    slug: 'test-product-2', // Top-level property
    data: {
      // Dynamic fields only (name and slug not included)
      description: 'Another product with, commas',
      price: 149.00,
      category: 'clothing',
      active: false
    },
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    createdBy: 'user1',
    updatedBy: 'user1'
  }
];

describe('generateTemplateRow', () => {
  it('should generate template with field type hints', () => {
    const template = generateTemplateRow(mockEntityType);
    
    expect(template.id).toContain('7-char');
    expect(template.visibility).toBe('[public|authenticated|members]');
    expect(template.organizationId).toContain('org ID');
    expect(template.slug).toContain('lowercase');
    // Name is a system field, not from entity type fields
    expect(template.name).toBe('[entity name - required]');
    expect(template.price).toContain('[number]');
    expect(template.price).toContain('REQUIRED');
    expect(template.category).toContain('Options:');
    expect(template.category).toContain('electronics');
  });
  
  it('should include constraint hints', () => {
    const template = generateTemplateRow(mockEntityType);
    
    expect(template.price).toContain('min 0');
    expect(template.price).toContain('max 10000');
  });
});

describe('generateCSV', () => {
  it('should generate CSV with headers and template row including id, org and slug', () => {
    const csv = generateCSV(mockEntities, mockEntityType);
    const lines = csv.split('\n');
    
    // Row 1: Headers with friendly names (format: "Name|field_id")
    expect(lines[0]).toContain('Id|id');
    expect(lines[0]).toContain('Organization|organizationId');
    expect(lines[0]).toContain('Name|name'); // System field
    expect(lines[0]).toContain('Slug|slug'); // System field
    expect(lines[0]).toContain('Visibility|visibility');
    expect(lines[0]).toContain('Price|price');
    
    // Row 2: Template
    expect(lines[1]).toContain('[entity name - required]'); // System field name
    expect(lines[1]).toContain('[number]');
    expect(lines[1]).toContain('7-char'); // ID template hint
    
    // Row 3+: Data - should include id, name, slug from entity top-level
    expect(lines[2]).toContain('ent1234'); // entity.id
    expect(lines[2]).toContain('public');
    expect(lines[2]).toContain('Test Product 1'); // entity.name (top-level)
    expect(lines[2]).toContain('test-product-1'); // entity.slug (top-level)
  });
  
  it('should export id, organizationId, name and slug from entity top-level', () => {
    const csv = generateCSV(mockEntities, mockEntityType);
    
    // Entity IDs
    expect(csv).toContain('ent1234');
    expect(csv).toContain('ent5678');
    // Names (top-level)
    expect(csv).toContain('Test Product 1');
    expect(csv).toContain('Test Product 2');
    // Slugs (top-level)
    expect(csv).toContain('test-product-1');
    expect(csv).toContain('test-product-2');
  });
  
  it('should escape commas and quotes in values', () => {
    const csv = generateCSV(mockEntities, mockEntityType);
    
    // The description with comma should be quoted
    expect(csv).toContain('"Another product with, commas"');
  });
  
  it('should handle multiselect arrays as comma-separated', () => {
    const csv = generateCSV(mockEntities, mockEntityType);
    
    expect(csv).toContain('new,featured');
  });
});

describe('parseCSV', () => {
  it('should parse basic CSV', () => {
    const csv = `name,price,category
Test Product,99.99,electronics`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Product');
    expect(result.data[0].price).toBe('99.99');
  });
  
  it('should skip template row when flag is true', () => {
    const csv = `name,price,category
[string] REQUIRED,[number] REQUIRED,[select]
Test Product,99.99,electronics`;
    
    const result = parseCSV(csv, true);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Product');
  });
  
  it('should handle quoted fields with commas', () => {
    const csv = `name,description
"Product, with comma","Description with ""quotes"" and, comma"`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data[0].name).toBe('Product, with comma');
    expect(result.data[0].description).toBe('Description with "quotes" and, comma');
  });
  
  it('should handle escaped quotes', () => {
    const csv = `name
"He said ""Hello"""`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data[0].name).toBe('He said "Hello"');
  });
  
  it('should return error for empty CSV', () => {
    const result = parseCSV('', false);
    
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('parse');
  });
  
  it('should handle CRLF line endings', () => {
    const csv = 'name,price\r\nProduct 1,100\r\nProduct 2,200';
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });
  
  it('should parse headers with friendly names (Name|field_id format)', () => {
    const csv = `Visibility,Name|name,Price|price
public,Test Product,99.99`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].visibility).toBe('public');
    expect(result.data[0].name).toBe('Test Product');
    expect(result.data[0].price).toBe('99.99');
  });
  
  it('should parse headers with org and slug columns', () => {
    const csv = `Organization|organizationId,Slug|slug,Visibility|visibility,Name|name
abc1234,test-product,public,Test Product`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].organizationId).toBe('abc1234');
    expect(result.data[0].slug).toBe('test-product');
    expect(result.data[0].visibility).toBe('public');
    expect(result.data[0].name).toBe('Test Product');
  });
  
  it('should parse headers with id column', () => {
    const csv = `Id|id,Organization|organizationId,Slug|slug,Visibility|visibility,Name|name
abc1234,org5678,test-product,public,Test Product`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('abc1234');
    expect(result.data[0].organizationId).toBe('org5678');
    expect(result.data[0].slug).toBe('test-product');
  });
  
  it('should handle empty id column', () => {
    const csv = `Id|id,Name|name
,Test Product`;
    
    const result = parseCSV(csv, false);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(''); // Empty values are now preserved as empty strings
    expect(result.data[0].name).toBe('Test Product');
  });
});

describe('generateSlug', () => {
  it('should convert text to lowercase slug', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
    expect(generateSlug('Test Product 123')).toBe('test-product-123');
  });
  
  it('should replace non-alphanumeric characters with hyphens', () => {
    expect(generateSlug('Hello, World!')).toBe('hello-world');
    expect(generateSlug('Test@Product#123')).toBe('test-product-123');
  });
  
  it('should trim leading/trailing hyphens', () => {
    expect(generateSlug('  Hello World  ')).toBe('hello-world');
    expect(generateSlug('---Test---')).toBe('test');
  });
  
  it('should truncate to 100 characters', () => {
    const longText = 'a'.repeat(150);
    expect(generateSlug(longText).length).toBe(100);
  });
});

describe('isValidSlug', () => {
  it('should accept valid slugs', () => {
    expect(isValidSlug('hello-world')).toBe(true);
    expect(isValidSlug('test-123')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });
  
  it('should reject invalid slugs', () => {
    expect(isValidSlug('Hello World')).toBe(false);
    expect(isValidSlug('test_underscore')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('UPPERCASE')).toBe(false);
  });
});

describe('isValidEntityId', () => {
  it('should accept valid entity IDs', () => {
    expect(isValidEntityId('abc1234')).toBe(true);
    expect(isValidEntityId('1234567')).toBe(true);
    expect(isValidEntityId('abcdefg')).toBe(true);
  });
  
  it('should reject invalid entity IDs', () => {
    expect(isValidEntityId('ABC1234')).toBe(false); // Uppercase
    expect(isValidEntityId('abc123')).toBe(false); // Too short (6 chars)
    expect(isValidEntityId('abc12345')).toBe(false); // Too long (8 chars)
    expect(isValidEntityId('')).toBe(false); // Empty
    expect(isValidEntityId('abc-123')).toBe(false); // Contains hyphen
    expect(isValidEntityId('abc_123')).toBe(false); // Contains underscore
  });
});

describe('convertToImportData', () => {
  it('should convert parsed data to entity format', () => {
    const data = [
      { visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].visibility).toBe('public');
    expect(result.entities[0].data.name).toBe('Test');
    expect(result.entities[0].data.price).toBe(99.99); // Coerced to number
  });
  
  it('should auto-generate slug from name when not provided', () => {
    const data = [
      { visibility: 'public', name: 'My Test Product', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].slug).toBe('my-test-product');
  });
  
  it('should use provided slug when valid', () => {
    const data = [
      { visibility: 'public', name: 'Test', slug: 'custom-slug', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].slug).toBe('custom-slug');
  });
  
  it('should validate slug format', () => {
    const data = [
      { visibility: 'public', name: 'Test', slug: 'Invalid Slug', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.some(e => e.field === 'slug')).toBe(true);
  });
  
  it('should handle organizationId', () => {
    const data = [
      { organizationId: 'abc1234', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].organizationId).toBe('abc1234');
  });
  
  it('should treat empty organizationId as null (global)', () => {
    const data = [
      { organizationId: '', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].organizationId).toBe(null);
  });
  
  it('should validate organizationId format', () => {
    const data = [
      { organizationId: 'invalid-org-id', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.some(e => e.field === 'organizationId')).toBe(true);
  });
  
  it('should handle entity id when provided', () => {
    const data = [
      { id: 'abc1234', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].id).toBe('abc1234');
  });
  
  it('should allow empty id (for new entity creation)', () => {
    const data = [
      { id: '', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors).toHaveLength(0);
    expect(result.entities[0].id).toBeUndefined();
  });
  
  it('should validate entity id format when provided', () => {
    const data = [
      { id: 'invalid-id', visibility: 'public', name: 'Test', price: '99.99', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.some(e => e.field === 'id')).toBe(true);
    expect(result.errors.find(e => e.field === 'id')?.message).toContain('Invalid entity ID format');
  });
  
  it('should validate select options', () => {
    const data = [
      { name: 'Test', price: '100', category: 'invalid-category' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe('category');
    expect(result.errors[0].message).toContain('must be one of');
  });
  
  it('should validate multiselect options', () => {
    const data = [
      { name: 'Test', price: '100', category: 'electronics', tags: 'new,invalid-tag' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.some(e => e.field === 'tags')).toBe(true);
    expect(result.errors.find(e => e.field === 'tags')?.message).toContain('invalid-tag');
  });
  
  it('should coerce boolean values', () => {
    const data = [
      { name: 'Test 1', price: '100', category: 'electronics', active: 'true' },
      { name: 'Test 2', price: '100', category: 'electronics', active: 'yes' },
      { name: 'Test 3', price: '100', category: 'electronics', active: 'false' },
      { name: 'Test 4', price: '100', category: 'electronics', active: '0' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.entities[0].data.active).toBe(true);
    expect(result.entities[1].data.active).toBe(true);
    expect(result.entities[2].data.active).toBe(false);
    expect(result.entities[3].data.active).toBe(false);
  });
  
  it('should error on invalid number', () => {
    const data = [
      { name: 'Test', price: 'not-a-number', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    expect(result.errors.some(e => e.field === 'price')).toBe(true);
  });
  
  it('should error on missing required fields', () => {
    const data = [
      { description: 'Missing required fields' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    // Should have errors for name, price, and category
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
    expect(result.errors.some(e => e.field === 'price')).toBe(true);
    expect(result.errors.some(e => e.field === 'category')).toBe(true);
  });
  
  it('should include CSV row numbers in errors', () => {
    const data = [
      { name: 'Valid', price: '100', category: 'electronics' },
      { name: 'Invalid', price: 'bad', category: 'electronics' }
    ];
    
    const result = convertToImportData(data, mockEntityType);
    
    const priceError = result.errors.find(e => e.field === 'price');
    expect(priceError).toBeDefined();
    expect(priceError?.rowIndex).toBe(1); // 0-based index
    expect(priceError?.csvRow).toBe(4); // Row 4 in CSV (1=header, 2=template, 3=first data, 4=second data)
  });
});

describe('validateImportData', () => {
  it('should validate required fields (excluding Name/Slug which are system fields)', () => {
    const entities = [
      { data: { description: 'No price or category' } }
    ];
    
    const errors = validateImportData(entities, mockEntityType);
    
    // Name is a system field, validated separately in convertToImportData
    expect(errors.some(e => e.field === 'name')).toBe(false);
    // Price and category are required dynamic fields
    expect(errors.some(e => e.field === 'price')).toBe(true);
    expect(errors.some(e => e.field === 'category')).toBe(true);
  });
  
  it('should validate number constraints', () => {
    const entities = [
      { data: { name: 'Test', price: -10, category: 'electronics' } }
    ];
    
    const errors = validateImportData(entities, mockEntityType);
    
    expect(errors.some(e => e.field === 'price')).toBe(true);
    expect(errors.find(e => e.field === 'price')?.message).toContain('at least 0');
  });
  
  it('should pass valid data', () => {
    const entities = [
      { 
        data: { 
          name: 'Valid Product', 
          price: 100, 
          category: 'electronics' 
        } 
      }
    ];
    
    const errors = validateImportData(entities, mockEntityType);
    
    expect(errors).toHaveLength(0);
  });
});
