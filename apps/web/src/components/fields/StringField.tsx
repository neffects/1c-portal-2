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
  readOnly?: boolean;
}

export function StringField({ field, value, onChange, error, disabled, readOnly }: StringFieldProps) {
  const constraints = field.constraints || {};
  
  // HTML5 pattern attribute doesn't need anchors (auto-anchored)
  // Remove anchors and escape hyphen in character classes for browser compatibility
  // Escape hyphen to avoid unicodeSets mode issues in newer browsers
  let htmlPattern: string | undefined = undefined;
  if (constraints.pattern) {
    // Remove anchors
    htmlPattern = constraints.pattern.replace(/^\^/, '').replace(/\$$/, '');
    
    // Escape hyphen in character classes for compatibility with unicodeSets mode
    // Patterns like [-a-z0-9] or [a-z0-9-] become [a-z0-9\-] (hyphen escaped at end)
    htmlPattern = htmlPattern.replace(/\[([^\]]+)\]/g, (match, content) => {
      // If hyphen is at the beginning, move it to the end and escape it
      if (content.startsWith('-')) {
        // Check if it's just a hyphen or hyphen followed by range
        // For [-a-z0-9], we want [a-z0-9\-]
        // For [a-z0-9-], we want [a-z0-9\-]
        const moved = content.substring(1) + '\\-';
        return `[${moved}]`;
      }
      // If hyphen is at the end, escape it
      if (content.endsWith('-') && !content.endsWith('\\-')) {
        return `[${content.slice(0, -1)}\\-]`;
      }
      return match;
    });
  }
  
  // Filter slug field input to only allow a-z, 0-9, and hyphens
  // Convert to lowercase and remove invalid characters as user types
  const isSlugField = field.id === 'slug';
  const handleInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    let inputValue = input.value;
    
    if (isSlugField) {
      // Filter to only allow lowercase letters, numbers, and hyphens
      inputValue = inputValue
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
    }
    
    onChange(inputValue);
  };
  
  return (
    <input
      type="text"
      value={(value as string) || ''}
      onInput={handleInput}
      class={`input ${error ? 'border-red-500 focus:ring-red-500' : ''} ${readOnly ? 'bg-surface-50 dark:bg-surface-800 cursor-not-allowed' : ''}`}
      placeholder={field.placeholder}
      minLength={constraints.minLength}
      maxLength={constraints.maxLength}
      pattern={htmlPattern}
      required={field.required}
      disabled={disabled}
      readOnly={readOnly}
    />
  );
}
