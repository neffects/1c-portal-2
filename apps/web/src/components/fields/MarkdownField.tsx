/**
 * Markdown Field Component
 * 
 * Rich text editor with markdown support and live preview.
 */

import { useState } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';

interface MarkdownFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function MarkdownField({ field, value, onChange, error, disabled }: MarkdownFieldProps) {
  const [showPreview, setShowPreview] = useState(false);
  const content = (value as string) || '';
  
  // Simple markdown to HTML conversion (basic implementation)
  function renderMarkdown(md: string): string {
    return md
      // Headers
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
      // Bold & italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary-600 hover:underline" target="_blank">$1</a>')
      // Lists
      .replace(/^\s*-\s+(.*)$/gim, '<li class="ml-4">$1</li>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mb-4">')
      .replace(/\n/g, '<br>');
  }
  
  // Toolbar actions
  function insertText(before: string, after: string = '') {
    const textarea = document.querySelector('[data-markdown-input]') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = content;
    const selectedText = text.substring(start, end);
    
    const newText = text.substring(0, start) + before + selectedText + after + text.substring(end);
    onChange(newText);
    
    // Reset cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selectedText.length
      );
    }, 0);
  }
  
  return (
    <div class={`border rounded-lg overflow-hidden ${error ? 'border-red-500' : 'border-surface-200 dark:border-surface-700'}`}>
      {/* Toolbar */}
      <div class="flex items-center justify-between p-2 bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={() => insertText('**', '**')}
            class="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
            title="Bold"
            disabled={disabled}
          >
            <span class="i-lucide-bold text-sm"></span>
          </button>
          <button
            type="button"
            onClick={() => insertText('*', '*')}
            class="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
            title="Italic"
            disabled={disabled}
          >
            <span class="i-lucide-italic text-sm"></span>
          </button>
          <div class="w-px h-4 bg-surface-300 dark:bg-surface-600 mx-1"></div>
          <button
            type="button"
            onClick={() => insertText('# ')}
            class="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
            title="Heading"
            disabled={disabled}
          >
            <span class="i-lucide-heading text-sm"></span>
          </button>
          <button
            type="button"
            onClick={() => insertText('[', '](url)')}
            class="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
            title="Link"
            disabled={disabled}
          >
            <span class="i-lucide-link text-sm"></span>
          </button>
          <button
            type="button"
            onClick={() => insertText('- ')}
            class="p-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 rounded"
            title="List"
            disabled={disabled}
          >
            <span class="i-lucide-list text-sm"></span>
          </button>
        </div>
        
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            class={`text-xs px-2 py-1 rounded ${showPreview ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-surface-200 dark:hover:bg-surface-700'}`}
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </div>
      
      {/* Editor / Preview */}
      {showPreview ? (
        <div 
          class="p-4 min-h-[200px] prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: `<p class="mb-4">${renderMarkdown(content)}</p>` }}
        />
      ) : (
        <textarea
          data-markdown-input
          value={content}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          class="w-full p-4 min-h-[200px] border-0 focus:ring-0 resize-y font-mono text-sm bg-white dark:bg-surface-900"
          placeholder={field.placeholder || 'Write markdown here...'}
          required={field.required}
          disabled={disabled}
        />
      )}
    </div>
  );
}
