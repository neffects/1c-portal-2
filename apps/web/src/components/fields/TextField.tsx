/**
 * Text Field Component
 * 
 * Multi-line textarea for longer text content.
 */

import type { FieldDefinition } from '@1cc/shared';

interface TextFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function TextField({ field, value, onChange, error, disabled }: TextFieldProps) {
  const constraints = field.constraints || {};
  const charCount = ((value as string) || '').length;
  const maxLength = constraints.maxLength;
  
  return (
    <div>
      <textarea
        value={(value as string) || ''}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        class={`input min-h-[120px] ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
        placeholder={field.placeholder}
        minLength={constraints.minLength}
        maxLength={maxLength}
        required={field.required}
        disabled={disabled}
        rows={5}
      />
      {maxLength && (
        <div class="text-xs text-surface-500 text-right mt-1">
          {charCount} / {maxLength}
        </div>
      )}
    </div>
  );
}
