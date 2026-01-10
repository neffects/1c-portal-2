/**
 * Boolean Field Component
 * 
 * Toggle switch for true/false values.
 */

import type { FieldDefinition } from '@1cc/shared';

interface BooleanFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: boolean) => void;
  error?: string;
  disabled?: boolean;
}

export function BooleanField({ field, value, onChange, error, disabled }: BooleanFieldProps) {
  const isChecked = Boolean(value);
  
  return (
    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        class="sr-only peer"
        disabled={disabled}
      />
      <div class={`
        w-11 h-6 rounded-full
        bg-surface-200 dark:bg-surface-700
        peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800
        peer-checked:bg-primary-600
        peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
        after:bg-white after:border-surface-300 after:border after:rounded-full
        after:h-5 after:w-5 after:transition-all
        peer-checked:after:translate-x-full peer-checked:after:border-white
        ${error ? 'ring-2 ring-red-500' : ''}
      `}></div>
      <span class="ml-3 text-sm text-surface-700 dark:text-surface-300">
        {isChecked ? 'Yes' : 'No'}
      </span>
    </label>
  );
}
