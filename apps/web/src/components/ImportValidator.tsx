/**
 * Import Validator Component
 * 
 * Displays validation results from both client-side and server-side validation.
 * Shows errors grouped by row with source indicators.
 */

import type { ImportError } from '../lib/csv';

interface ImportValidatorProps {
  errors: ImportError[];
  totalRows: number;
  isLoading?: boolean;
  showOnlyErrors?: boolean;
}

/**
 * Group errors by row index for display
 */
function groupErrorsByRow(errors: ImportError[]): Map<number, ImportError[]> {
  const grouped = new Map<number, ImportError[]>();
  
  for (const error of errors) {
    const existing = grouped.get(error.rowIndex) || [];
    existing.push(error);
    grouped.set(error.rowIndex, existing);
  }
  
  return grouped;
}

/**
 * Get badge color for error source
 */
function getSourceBadgeClass(source: ImportError['source']): string {
  switch (source) {
    case 'parse':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'validation':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'server':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    default:
      return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
  }
}

/**
 * Get source label
 */
function getSourceLabel(source: ImportError['source']): string {
  switch (source) {
    case 'parse':
      return 'Parse';
    case 'validation':
      return 'Validation';
    case 'server':
      return 'Server';
    default:
      return 'Error';
  }
}

export function ImportValidator({ 
  errors, 
  totalRows, 
  isLoading = false,
  showOnlyErrors = false 
}: ImportValidatorProps) {
  const hasErrors = errors.length > 0;
  const errorRows = new Set(errors.map(e => e.rowIndex)).size;
  const validRows = Math.max(0, totalRows - errorRows);
  const groupedErrors = groupErrorsByRow(errors);
  
  if (isLoading) {
    return (
      <div class="card p-6">
        <div class="flex items-center gap-3">
          <span class="i-lucide-loader-2 animate-spin text-xl text-primary-500"></span>
          <span class="text-surface-600 dark:text-surface-400">Validating import data...</span>
        </div>
      </div>
    );
  }
  
  if (totalRows === 0 && !hasErrors) {
    return (
      <div class="card p-6">
        <div class="flex items-center gap-3 text-surface-500">
          <span class="i-lucide-file-question text-xl"></span>
          <span>No data to validate. Upload a file to begin.</span>
        </div>
      </div>
    );
  }
  
  return (
    <div class="card overflow-hidden">
      {/* Summary header */}
      <div class={`p-4 border-b ${
        hasErrors 
          ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' 
          : 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
      }`}>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            {hasErrors ? (
              <>
                <span class="i-lucide-alert-triangle text-xl text-red-500"></span>
                <div>
                  <p class="font-medium text-red-700 dark:text-red-400">
                    {errors.length} {errors.length === 1 ? 'error' : 'errors'} found in {errorRows} {errorRows === 1 ? 'row' : 'rows'}
                  </p>
                  <p class="text-sm text-red-600 dark:text-red-500">
                    Fix the errors below and re-upload to retry
                  </p>
                </div>
              </>
            ) : (
              <>
                <span class="i-lucide-check-circle text-xl text-green-500"></span>
                <div>
                  <p class="font-medium text-green-700 dark:text-green-400">
                    All {totalRows} {totalRows === 1 ? 'row' : 'rows'} ready to import
                  </p>
                  <p class="text-sm text-green-600 dark:text-green-500">
                    Click Import to create the entities
                  </p>
                </div>
              </>
            )}
          </div>
          
          <div class="flex items-center gap-4 text-sm">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-green-500"></span>
              <span class="text-surface-600 dark:text-surface-400">{validRows} valid</span>
            </div>
            {errorRows > 0 && (
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-red-500"></span>
                <span class="text-surface-600 dark:text-surface-400">{errorRows} with errors</span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Error list */}
      {hasErrors && (
        <div class="max-h-80 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-50 dark:bg-surface-800 sticky top-0">
              <tr>
                <th class="text-left px-4 py-2 font-medium text-surface-500 w-20">Row</th>
                <th class="text-left px-4 py-2 font-medium text-surface-500 w-32">Field</th>
                <th class="text-left px-4 py-2 font-medium text-surface-500">Error</th>
                <th class="text-left px-4 py-2 font-medium text-surface-500 w-24">Source</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-100 dark:divide-surface-700">
              {Array.from(groupedErrors.entries())
                .sort(([a], [b]) => a - b)
                .flatMap(([rowIndex, rowErrors]) => 
                  rowErrors.map((error, i) => (
                    <tr 
                      key={`${rowIndex}-${i}`}
                      class="hover:bg-surface-50 dark:hover:bg-surface-800/50"
                    >
                      <td class="px-4 py-2 text-surface-700 dark:text-surface-300 font-mono">
                        {error.csvRow ?? rowIndex + 3}
                      </td>
                      <td class="px-4 py-2 text-surface-700 dark:text-surface-300">
                        {error.field || '-'}
                      </td>
                      <td class="px-4 py-2 text-surface-900 dark:text-surface-100">
                        {error.message}
                      </td>
                      <td class="px-4 py-2">
                        <span class={`px-2 py-0.5 rounded text-xs font-medium ${getSourceBadgeClass(error.source)}`}>
                          {getSourceLabel(error.source)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Legend for error sources */}
      {hasErrors && (
        <div class="px-4 py-3 border-t border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
          <div class="flex items-center gap-6 text-xs text-surface-500">
            <span class="font-medium">Error sources:</span>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-0.5 rounded font-medium ${getSourceBadgeClass('parse')}`}>Parse</span>
              <span>CSV/JSON parsing failed</span>
            </div>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-0.5 rounded font-medium ${getSourceBadgeClass('validation')}`}>Validation</span>
              <span>Client-side field validation</span>
            </div>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-0.5 rounded font-medium ${getSourceBadgeClass('server')}`}>Server</span>
              <span>Server-side validation</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
