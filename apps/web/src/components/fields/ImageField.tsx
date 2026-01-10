/**
 * Image Field Component
 * 
 * Image upload with preview and drag-drop support.
 */

import { useState, useRef } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';
import { api } from '../../lib/api';

interface ImageFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}

export function ImageField({ field, value, onChange, error, disabled }: ImageFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const imageUrl = value as string | null;
  const constraints = field.constraints || {};
  const maxSize = constraints.maxFileSize || 5 * 1024 * 1024; // 5MB default
  const allowedTypes = constraints.fileTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
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
      formData.append('type', 'image');
      
      const response = await api.upload('/api/files/upload', formData);
      
      if (response.success && response.data) {
        const data = response.data as { url: string };
        onChange(data.url);
        console.log('[ImageField] Upload complete:', data.url);
      } else {
        throw new Error(response.error?.message || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }
  
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    
    if (disabled || uploading) return;
    
    const file = e.dataTransfer?.files[0];
    if (file) {
      handleFile(file);
    }
  }
  
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled && !uploading) {
      setDragOver(true);
    }
  }
  
  function handleDragLeave() {
    setDragOver(false);
  }
  
  function handleFileSelect(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleFile(file);
    }
  }
  
  function removeImage() {
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }
  
  return (
    <div>
      {imageUrl ? (
        /* Image preview */
        <div class="relative group">
          <img
            src={imageUrl}
            alt="Uploaded image"
            class="w-full h-48 object-cover rounded-lg border border-surface-200 dark:border-surface-700"
          />
          {!disabled && (
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                class="p-2 bg-white rounded-full text-surface-700 hover:bg-surface-100"
                title="Replace image"
              >
                <span class="i-lucide-refresh-cw"></span>
              </button>
              <button
                type="button"
                onClick={removeImage}
                class="p-2 bg-white rounded-full text-red-500 hover:bg-red-50"
                title="Remove image"
              >
                <span class="i-lucide-trash-2"></span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Upload zone */
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
          class={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-surface-300 dark:border-surface-600'}
            ${error ? 'border-red-500' : ''}
            ${disabled ? 'bg-surface-100 cursor-not-allowed' : 'hover:border-primary-400'}
          `}
        >
          {uploading ? (
            <div class="flex flex-col items-center gap-2">
              <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
              <span class="text-sm text-surface-500">Uploading...</span>
            </div>
          ) : (
            <div class="flex flex-col items-center gap-2">
              <span class="i-lucide-image text-3xl text-surface-400"></span>
              <span class="text-sm text-surface-600 dark:text-surface-400">
                Drop an image here or click to upload
              </span>
              <span class="text-xs text-surface-400">
                Max size: {(maxSize / 1024 / 1024).toFixed(0)}MB
              </span>
            </div>
          )}
        </div>
      )}
      
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={allowedTypes.join(',')}
        onChange={handleFileSelect}
        class="hidden"
        disabled={disabled || uploading}
      />
      
      {/* Upload error */}
      {uploadError && (
        <p class="text-sm text-red-500 mt-2 flex items-center gap-1">
          <span class="i-lucide-alert-circle text-xs"></span>
          {uploadError}
        </p>
      )}
    </div>
  );
}
