/**
 * Date Field Component
 * 
 * Date picker with calendar input.
 */

import type { FieldDefinition } from '@1cc/shared';

interface DateFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}

export function DateField({ field, value, onChange, error, disabled }: DateFieldProps) {
  // Convert ISO string to YYYY-MM-DD for input
  function toInputValue(val: unknown): string {
    if (!val) return '';
    if (typeof val === 'string') {
      // Handle ISO date strings
      const date = new Date(val);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      // Already in YYYY-MM-DD format
      return val;
    }
    return '';
  }
  
  // Convert input value to ISO string
  function handleChange(e: Event) {
    const inputValue = (e.target as HTMLInputElement).value;
    if (!inputValue) {
      onChange(null);
    } else {
      // Store as ISO string
      onChange(new Date(inputValue).toISOString());
    }
  }
  
  return (
    <div class="relative">
      <input
        type="date"
        value={toInputValue(value)}
        onInput={handleChange}
        class={`input pr-10 ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
        required={field.required}
        disabled={disabled}
      />
      <span class="i-lucide-calendar absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"></span>
    </div>
  );
}
