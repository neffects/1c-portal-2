/**
 * Multi-Select Field Component
 * 
 * Multiple selection with tags/pills display.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import type { FieldDefinition, SelectOption } from '@1cc/shared';

interface MultiSelectFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string[]) => void;
  error?: string;
  disabled?: boolean;
}

export function MultiSelectField({ field, value, onChange, error, disabled }: MultiSelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  
  const options: SelectOption[] = field.constraints?.options || [];
  const selectedValues: string[] = Array.isArray(value) ? value : [];
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Filter options by search
  const filteredOptions = options.filter(opt => 
    (opt.label || opt.value).toLowerCase().includes(search.toLowerCase())
  );
  
  function toggleOption(optionValue: string) {
    if (selectedValues.includes(optionValue)) {
      onChange(selectedValues.filter(v => v !== optionValue));
    } else {
      onChange([...selectedValues, optionValue]);
    }
  }
  
  function removeOption(optionValue: string) {
    onChange(selectedValues.filter(v => v !== optionValue));
  }
  
  function getOptionLabel(optionValue: string): string {
    const opt = options.find(o => o.value === optionValue);
    return opt?.label || optionValue;
  }
  
  function getOptionColor(optionValue: string): string | undefined {
    const opt = options.find(o => o.value === optionValue);
    return opt?.color;
  }
  
  return (
    <div ref={containerRef} class="relative">
      {/* Selected pills */}
      <div 
        class={`input min-h-[42px] flex flex-wrap gap-1 items-center cursor-text ${error ? 'border-red-500' : ''} ${disabled ? 'bg-surface-100 cursor-not-allowed' : ''}`}
        onClick={() => !disabled && setIsOpen(true)}
      >
        {selectedValues.map(val => (
          <span 
            key={val}
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm"
            style={{ 
              backgroundColor: getOptionColor(val) ? `${getOptionColor(val)}20` : undefined,
              color: getOptionColor(val) || undefined,
              borderColor: getOptionColor(val) || undefined
            }}
          >
            {getOptionLabel(val)}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeOption(val); }}
                class="hover:opacity-70"
              >
                <span class="i-lucide-x text-xs"></span>
              </button>
            )}
          </span>
        ))}
        {selectedValues.length === 0 && (
          <span class="text-surface-400">{field.placeholder || 'Select options...'}</span>
        )}
      </div>
      
      {/* Dropdown */}
      {isOpen && !disabled && (
        <div class="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg max-h-60 overflow-hidden">
          {/* Search */}
          <div class="p-2 border-b border-surface-200 dark:border-surface-700">
            <input
              type="text"
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              class="input text-sm"
              placeholder="Search..."
              autoFocus
            />
          </div>
          
          {/* Options list */}
          <div class="overflow-y-auto max-h-48">
            {filteredOptions.length > 0 ? (
              filteredOptions.map(option => {
                const isSelected = selectedValues.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleOption(option.value)}
                    class={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-700 ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
                  >
                    <span class={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-surface-300'}`}>
                      {isSelected && <span class="i-lucide-check text-white text-xs"></span>}
                    </span>
                    {option.color && (
                      <span class="w-3 h-3 rounded-full" style={{ backgroundColor: option.color }}></span>
                    )}
                    <span>{option.label || option.value}</span>
                  </button>
                );
              })
            ) : (
              <div class="p-3 text-center text-surface-500 text-sm">
                No options found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
