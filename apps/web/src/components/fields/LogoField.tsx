/**
 * Logo Field Component
 * 
 * Logo upload with square aspect ratio and resizing.
 */

import { useState, useRef } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';
import { api } from '../../lib/api';

interface LogoFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}

export function LogoField({ field, value, onChange, error, disabled }: LogoFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const logoUrl = value as string | null;
  const constraints = field.constraints || {};
  const maxSize = constraints.maxFileSize || 2 * 1024 * 1024; // 2MB default for logos
  const allowedTypes = constraints.fileTypes || ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
  
  async function handleFile(file: File) {
    // Validate type
    if (!allowedTypes.some(type => file.type.match(type.replace('*', '.*')))) {
      setUploadError(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
      return;
    }
    
    // Validate size
    if (file.size > maxSize) {
      setUploadError(`File too large. Maximum: ${(maxSize / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    
    setUploading(true);
    setUploadError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'logo');
      
      const response = await api.upload('/files/upload', formData);
      
      if (response.success && response.data) {
        const data = response.data as { url: string };
        onChange(data.url);
        console.log('[LogoField] Upload complete:', data.url);
      } else {
        throw new Error(response.error?.message || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }
  
  function handleFileSelect(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleFile(file);
    }
  }
  
  function removeLogo() {
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }
  
  return (
    <div class="flex items-start gap-4">
      {/* Logo preview */}
      <div 
        class={`
          w-24 h-24 rounded-lg border-2 border-dashed flex items-center justify-center
          ${error ? 'border-red-500' : 'border-surface-300 dark:border-surface-600'}
          ${disabled ? 'bg-surface-100' : ''}
        `}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo"
            class="w-full h-full object-contain rounded-lg"
          />
        ) : uploading ? (
          <span class="i-lucide-loader-2 animate-spin text-2xl text-primary-500"></span>
        ) : (
          <span class="i-lucide-image text-2xl text-surface-400"></span>
        )}
      </div>
      
      {/* Actions */}
      <div class="flex-1 space-y-2">
        <div class="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            class="btn-secondary text-sm"
            disabled={disabled || uploading}
          >
            <span class="i-lucide-upload mr-1"></span>
            {logoUrl ? 'Change' : 'Upload'}
          </button>
          {logoUrl && !disabled && (
            <button
              type="button"
              onClick={removeLogo}
              class="btn-ghost text-sm text-red-500"
            >
              <span class="i-lucide-trash-2 mr-1"></span>
              Remove
            </button>
          )}
        </div>
        <p class="text-xs text-surface-500">
          Recommended: Square image, 256x256px or larger
        </p>
        
        {/* Upload error */}
        {uploadError && (
          <p class="text-sm text-red-500 flex items-center gap-1">
            <span class="i-lucide-alert-circle text-xs"></span>
            {uploadError}
          </p>
        )}
      </div>
      
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={allowedTypes.join(',')}
        onChange={handleFileSelect}
        class="hidden"
        disabled={disabled || uploading}
      />
    </div>
  );
}
