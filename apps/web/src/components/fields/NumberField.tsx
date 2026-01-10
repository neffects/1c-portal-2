/**
 * Number Field Component
 * 
 * Numeric input with min/max constraints.
 */

import type { FieldDefinition } from '@1cc/shared';

interface NumberFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: number | null) => void;
  error?: string;
  disabled?: boolean;
}

export function NumberField({ field, value, onChange, error, disabled }: NumberFieldProps) {
  const constraints = field.constraints || {};
  
  function handleChange(e: Event) {
    const inputValue = (e.target as HTMLInputElement).value;
    if (inputValue === '') {
      onChange(null);
    } else {
      const num = parseFloat(inputValue);
      if (!isNaN(num)) {
        onChange(num);
      }
    }
  }
  
  return (
    <input
      type="number"
      value={value !== null && value !== undefined ? String(value) : ''}
      onInput={handleChange}
      class={`input ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
      placeholder={field.placeholder}
      min={constraints.minValue}
      max={constraints.maxValue}
      step="any"
      required={field.required}
      disabled={disabled}
    />
  );
}
