/**
 * File Field Component
 * 
 * Generic file upload with type validation.
 */

import { useState, useRef } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';
import { api } from '../../lib/api';

interface FileFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: FileValue | null) => void;
  error?: string;
  disabled?: boolean;
}

interface FileValue {
  url: string;
  name: string;
  size: number;
  type: string;
}

// Map common MIME types to icons
function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'i-lucide-image';
  if (mimeType.startsWith('video/')) return 'i-lucide-video';
  if (mimeType.startsWith('audio/')) return 'i-lucide-music';
  if (mimeType.includes('pdf')) return 'i-lucide-file-text';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'i-lucide-file-spreadsheet';
  if (mimeType.includes('document') || mimeType.includes('word')) return 'i-lucide-file-text';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return 'i-lucide-archive';
  return 'i-lucide-file';
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileField({ field, value, onChange, error, disabled }: FileFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const fileValue = value as FileValue | null;
  const constraints = field.constraints || {};
  const maxSize = constraints.maxFileSize || 10 * 1024 * 1024; // 10MB default
  const allowedTypes = constraints.fileTypes || [];
  
  async function handleFile(file: File) {
    // Validate type if specified
    if (allowedTypes.length > 0 && !allowedTypes.some(type => file.type.match(type.replace('*', '.*')))) {
      setUploadError(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
      return;
    }
    
    // Validate size
    if (file.size > maxSize) {
      setUploadError(`File too large. Maximum: ${formatSize(maxSize)}`);
      return;
    }
    
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'file');
      
      // Use XMLHttpRequest for progress tracking
      const response = await new Promise<{ success: boolean; data?: { url: string }; error?: { message: string } }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        
        xhr.onload = () => {
          try {
            const result = JSON.parse(xhr.responseText);
            resolve(result);
          } catch {
            reject(new Error('Invalid response'));
          }
        };
        
        xhr.onerror = () => reject(new Error('Upload failed'));
        
        xhr.open('POST', '/files/upload');
        xhr.send(formData);
      });
      
      if (response.success && response.data) {
        onChange({
          url: response.data.url,
          name: file.name,
          size: file.size,
          type: file.type
        });
        console.log('[FileField] Upload complete:', response.data.url);
      } else {
        throw new Error(response.error?.message || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
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
  
  function removeFile() {
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }
  
  return (
    <div>
      {fileValue ? (
        /* File preview */
        <div class={`flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg border ${error ? 'border-red-500' : 'border-surface-200 dark:border-surface-700'}`}>
          <span class={`${getFileIcon(fileValue.type)} text-2xl text-surface-500`}></span>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-surface-900 dark:text-surface-100 truncate">{fileValue.name}</p>
            <p class="text-xs text-surface-500">{formatSize(fileValue.size)}</p>
          </div>
          <div class="flex items-center gap-2">
            <a
              href={fileValue.url}
              target="_blank"
              rel="noopener"
              class="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
              title="Download"
            >
              <span class="i-lucide-download text-surface-500"></span>
            </a>
            {!disabled && (
              <button
                type="button"
                onClick={removeFile}
                class="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                title="Remove"
              >
                <span class="i-lucide-trash-2"></span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Upload zone */
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
          class={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-surface-300 dark:border-surface-600'}
            ${error ? 'border-red-500' : ''}
            ${disabled ? 'bg-surface-100 cursor-not-allowed' : 'hover:border-primary-400'}
          `}
        >
          {uploading ? (
            <div class="flex flex-col items-center gap-2">
              <div class="w-full max-w-xs bg-surface-200 dark:bg-surface-700 rounded-full h-2">
                <div 
                  class="bg-primary-600 h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <span class="text-sm text-surface-500">Uploading... {uploadProgress}%</span>
            </div>
          ) : (
            <div class="flex flex-col items-center gap-2">
              <span class="i-lucide-upload text-2xl text-surface-400"></span>
              <span class="text-sm text-surface-600 dark:text-surface-400">
                Drop a file here or click to upload
              </span>
              <span class="text-xs text-surface-400">
                Max size: {formatSize(maxSize)}
              </span>
            </div>
          )}
        </div>
      )}
      
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={allowedTypes.length > 0 ? allowedTypes.join(',') : undefined}
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
