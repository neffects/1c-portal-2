/**
 * WebLink Field Component
 * 
 * URL input with optional display text (alias).
 */

import { useState, useEffect } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';

interface WebLinkFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: WebLinkValue | null) => void;
  error?: string;
  disabled?: boolean;
}

interface WebLinkValue {
  url: string;
  alias?: string;
}

/**
 * Validates if a string is a valid URL
 */
function isValidUrl(urlString: string, requireHttps: boolean = false): boolean {
  if (!urlString) return false;
  
  try {
    const url = new URL(urlString);
    if (requireHttps && url.protocol !== 'https:') {
      return false;
    }
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function WebLinkField({ field, value, onChange, error, disabled }: WebLinkFieldProps) {
  const constraints = field.constraints || {};
  const allowAlias = constraints.allowAlias ?? true;
  const requireHttps = constraints.requireHttps ?? false;
  
  // Parse value
  const webLinkValue = value as WebLinkValue | null;
  const [url, setUrl] = useState(webLinkValue?.url || '');
  const [alias, setAlias] = useState(webLinkValue?.alias || '');
  const [urlError, setUrlError] = useState<string | null>(null);
  
  // Sync local state with prop value
  useEffect(() => {
    const linkValue = value as WebLinkValue | null;
    if (linkValue) {
      setUrl(linkValue.url || '');
      setAlias(linkValue.alias || '');
    } else {
      setUrl('');
      setAlias('');
    }
  }, [value]);
  
  // Validate and update URL
  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    setUrlError(null);
    
    if (newUrl && !isValidUrl(newUrl, requireHttps)) {
      if (requireHttps) {
        setUrlError('Please enter a valid HTTPS URL');
      } else {
        setUrlError('Please enter a valid URL (must start with http:// or https://)');
      }
    }
    
    // Update parent value
    if (newUrl) {
      onChange({
        url: newUrl,
        alias: alias || undefined
      });
    } else {
      onChange(null);
    }
  };
  
  // Update alias
  const handleAliasChange = (newAlias: string) => {
    setAlias(newAlias);
    
    // Update parent value
    if (url) {
      onChange({
        url,
        alias: newAlias || undefined
      });
    }
  };
  
  // Clear the link
  const handleClear = () => {
    setUrl('');
    setAlias('');
    setUrlError(null);
    onChange(null);
  };
  
  return (
    <div class="space-y-2">
      {/* URL Input */}
      <div class="relative">
        <div class="flex items-center gap-2">
          <div class="flex-1 relative">
            <span class="i-lucide-link absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"></span>
            <input
              type="url"
              value={url}
              onInput={(e) => handleUrlChange((e.target as HTMLInputElement).value)}
              class={`input pl-9 ${(error || urlError) ? 'border-red-500 focus:ring-red-500' : ''}`}
              placeholder={requireHttps ? 'https://example.com' : 'https://example.com'}
              required={field.required}
              disabled={disabled}
            />
          </div>
          {url && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              class="p-2 text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
              title="Clear link"
            >
              <span class="i-lucide-x"></span>
            </button>
          )}
        </div>
        
        {urlError && (
          <p class="text-sm text-red-500 flex items-center gap-1 mt-1">
            <span class="i-lucide-alert-circle text-xs"></span>
            {urlError}
          </p>
        )}
      </div>
      
      {/* Alias Input (if enabled) */}
      {allowAlias && (
        <div class="relative">
          <span class="i-lucide-type absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"></span>
          <input
            type="text"
            value={alias}
            onInput={(e) => handleAliasChange((e.target as HTMLInputElement).value)}
            class="input pl-9"
            placeholder="Display text (optional)"
            disabled={disabled || !url}
          />
          <p class="text-xs text-surface-500 mt-1">
            Leave empty to display the URL directly
          </p>
        </div>
      )}
      
      {/* Preview */}
      {url && isValidUrl(url, requireHttps) && (
        <div class="p-3 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg">
          <div class="text-xs text-surface-500 mb-1 flex items-center gap-1">
            <span class="i-lucide-eye text-xs"></span>
            Preview:
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center gap-1 text-sm break-all"
          >
            {alias || url}
            <span class="i-lucide-external-link text-xs flex-shrink-0"></span>
          </a>
        </div>
      )}
    </div>
  );
}
