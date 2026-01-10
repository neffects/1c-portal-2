/**
 * Field Renderer Component
 * 
 * Dynamically renders the appropriate field component based on field type.
 * Used in entity editor forms.
 */

import type { FieldDefinition, FieldType } from '@1cc/shared';
import { StringField } from './StringField';
import { TextField } from './TextField';
import { MarkdownField } from './MarkdownField';
import { NumberField } from './NumberField';
import { BooleanField } from './BooleanField';
import { DateField } from './DateField';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { LinkField } from './LinkField';
import { ImageField } from './ImageField';
import { LogoField } from './LogoField';
import { FileField } from './FileField';
import { CountryField } from './CountryField';

interface FieldRendererProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Map of field types to their components
 */
const FIELD_COMPONENTS: Record<FieldType, React.ComponentType<FieldRendererProps>> = {
  string: StringField,
  text: TextField,
  markdown: MarkdownField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  select: SelectField,
  multiselect: MultiSelectField,
  link: LinkField,
  image: ImageField,
  logo: LogoField,
  file: FileField,
  country: CountryField
};

export function FieldRenderer({ field, value, onChange, error, disabled }: FieldRendererProps) {
  const Component = FIELD_COMPONENTS[field.type];
  
  if (!Component) {
    console.warn(`[FieldRenderer] Unknown field type: ${field.type}`);
    return (
      <div class="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-amber-700 dark:text-amber-400 text-sm">
        Unknown field type: {field.type}
      </div>
    );
  }
  
  return (
    <div class="space-y-1">
      <label class="block text-sm font-medium text-surface-700 dark:text-surface-300">
        {field.name}
        {field.required && <span class="text-red-500 ml-1">*</span>}
      </label>
      
      {field.description && (
        <p class="text-xs text-surface-500">{field.description}</p>
      )}
      
      <Component
        field={field}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
      />
      
      {error && (
        <p class="text-sm text-red-500 flex items-center gap-1">
          <span class="i-lucide-alert-circle text-xs"></span>
          {error}
        </p>
      )}
    </div>
  );
}
