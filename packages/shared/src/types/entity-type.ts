/**
 * Entity Type definitions for schema management
 */

import { FIELD_TYPES, VISIBILITY_SCOPES } from '../constants';

/**
 * Field type derived from constants
 */
export type FieldType = typeof FIELD_TYPES[number];

/**
 * Entity type definition - defines the schema for entities
 * Location: public/entity-types/{typeId}/definition.json
 */
export interface EntityType {
  /** Unique entity type identifier (7-char NanoID) */
  id: string;
  /** Singular name (e.g., "Tool") */
  name: string;
  /** Plural name (e.g., "Tools") */
  pluralName: string;
  /** URL-friendly slug */
  slug: string;
  /** Description of this entity type */
  description?: string;
  /** Default visibility for new entities: 'public' | 'authenticated' | 'members' */
  defaultVisibility: typeof VISIBILITY_SCOPES[number];
  /** Field definitions */
  fields: FieldDefinition[];
  /** Field sections for form organization */
  sections: FieldSection[];
  /** Table display configuration */
  tableDisplayConfig: TableDisplayConfig;
  /** When the type was created (ISO 8601) */
  createdAt: string;
  /** When the type was last updated (ISO 8601) */
  updatedAt: string;
  /** ID of user who created the type */
  createdBy: string;
  /** ID of user who last updated the type */
  updatedBy: string;
  /** Whether the type is active */
  isActive: boolean;
}

/**
 * Field definition within an entity type
 */
export interface FieldDefinition {
  /** Unique field identifier within the type */
  id: string;
  /** Display name */
  name: string;
  /** Field data type */
  type: FieldType;
  /** Whether the field is required */
  required: boolean;
  /** Help text / description */
  description?: string;
  /** Type-specific constraints */
  constraints?: FieldConstraints;
  /** Display order within section */
  displayOrder: number;
  /** Section this field belongs to */
  sectionId: string;
  /** Whether to show in table/list views */
  showInTable: boolean;
  /** Default value */
  defaultValue?: unknown;
}

/**
 * Field constraints based on field type
 */
export interface FieldConstraints {
  // String/Text/Markdown constraints
  minLength?: number;
  maxLength?: number;
  
  // Number constraints
  minValue?: number;
  maxValue?: number;
  
  // Select/Multiselect constraints
  options?: SelectOption[];
  
  // Link constraints
  linkEntityTypeId?: string;
  allowMultiple?: boolean;
  
  // WebLink constraints
  allowAlias?: boolean;
  requireHttps?: boolean;
  
  // File/Image/Logo constraints
  fileTypes?: string[];
  maxFileSize?: number; // bytes
  
  // Country constraints
  includeCountryName?: boolean;
  includeCountryCode?: boolean;
  includeDialCode?: boolean;
  includeFlag?: boolean;
  
  // Validation pattern (regex)
  pattern?: string;
  patternMessage?: string;
}

/**
 * Select option for select/multiselect fields
 */
export interface SelectOption {
  /** Option value (stored in data) */
  value: string;
  /** Display label */
  label: string;
  /** Optional color for UI */
  color?: string;
}

/**
 * Field section for form organization
 */
export interface FieldSection {
  /** Unique section identifier */
  id: string;
  /** Section display name */
  name: string;
  /** Section description */
  description?: string;
  /** Display order */
  displayOrder: number;
  /** Whether section is collapsible */
  collapsible?: boolean;
  /** Whether section is collapsed by default */
  defaultCollapsed?: boolean;
}

/**
 * Table display configuration
 */
export interface TableDisplayConfig {
  /** Show entity name column */
  showName: boolean;
  /** Show status column */
  showStatus: boolean;
  /** Show last updated column */
  showUpdated: boolean;
  /** Show organization column (superadmin only) */
  showOrganization?: boolean;
  /** Additional field IDs to show as columns */
  additionalColumns?: string[];
  /** Default sort field */
  defaultSortField?: string;
  /** Default sort direction */
  defaultSortDirection?: 'asc' | 'desc';
}

/**
 * Create entity type request
 */
export interface CreateEntityTypeRequest {
  name: string;
  pluralName: string;
  slug: string;
  description?: string;
  /** Default visibility: 'public' | 'authenticated' | 'members' */
  defaultVisibility: typeof VISIBILITY_SCOPES[number];
  fields: Omit<FieldDefinition, 'id'>[];
  sections: Omit<FieldSection, 'id'>[];
}

/**
 * Update entity type request
 */
export interface UpdateEntityTypeRequest {
  name?: string;
  pluralName?: string;
  slug?: string;
  description?: string;
  /** Default visibility: 'public' | 'authenticated' | 'members' */
  defaultVisibility?: typeof VISIBILITY_SCOPES[number];
  fields?: FieldDefinition[];
  sections?: FieldSection[];
  tableDisplayConfig?: TableDisplayConfig;
}

/**
 * Entity type list item (compact)
 */
export interface EntityTypeListItem {
  id: string;
  name: string;
  pluralName: string;
  slug: string;
  description?: string;
  /** Default visibility: 'public' | 'authenticated' | 'members' */
  defaultVisibility: typeof VISIBILITY_SCOPES[number];
  fieldCount: number;
  entityCount: number;
  isActive: boolean;
}
