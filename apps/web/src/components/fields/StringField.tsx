/**
 * String Field Component
 * 
 * Single-line text input for short text values.
 */

import type { FieldDefinition } from '@1cc/shared';

interface StringFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function StringField({ field, value, onChange, error, disabled }: StringFieldProps) {
  const constraints = field.constraints || {};
  
  return (
    <input
      type="text"
      value={(value as string) || ''}
      onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      class={`input ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
      placeholder={field.placeholder}
      minLength={constraints.minLength}
      maxLength={constraints.maxLength}
      pattern={constraints.pattern}
      required={field.required}
      disabled={disabled}
    />
  );
}
