/**
 * Select Field Component
 * 
 * Single-value dropdown with options.
 */

import type { FieldDefinition, SelectOption } from '@1cc/shared';

interface SelectFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}

export function SelectField({ field, value, onChange, error, disabled }: SelectFieldProps) {
  const options: SelectOption[] = field.constraints?.options || [];
  
  return (
    <div class="relative">
      <select
        value={(value as string) || ''}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}
        class={`input appearance-none pr-10 ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
        required={field.required}
        disabled={disabled}
      >
        <option value="">{field.placeholder || 'Select an option...'}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
      <span class="i-lucide-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"></span>
    </div>
  );
}
