/**
 * Link Field Component
 * 
 * Entity reference selector - links to other entities.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import type { FieldDefinition } from '@1cc/shared';
import { useEntityType } from '../../hooks/useDB';
import { api } from '../../lib/api';

interface LinkFieldProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}

interface LinkedEntity {
  id: string;
  title: string;
  typeSlug: string;
}

export function LinkField({ field, value, onChange, error, disabled }: LinkFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LinkedEntity[]>([]);
  const [linkedEntity, setLinkedEntity] = useState<LinkedEntity | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const linkedTypeId = field.constraints?.linkedTypeId;
  const { data: linkedType } = useEntityType(linkedTypeId);
  
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
  
  // Load linked entity details when value changes
  useEffect(() => {
    if (value && typeof value === 'string') {
      loadLinkedEntity(value);
    } else {
      setLinkedEntity(null);
    }
  }, [value]);
  
  // Search for entities
  useEffect(() => {
    if (isOpen && search) {
      searchEntities(search);
    }
  }, [search, isOpen]);
  
  async function loadLinkedEntity(entityId: string) {
    // Try to get from cache or API
    const response = await api.get(`/api/entities/${entityId}`);
    if (response.success && response.data) {
      const data = response.data as { id: string; title: string; typeSlug: string };
      setLinkedEntity({
        id: data.id,
        title: data.title,
        typeSlug: data.typeSlug
      });
    }
  }
  
  async function searchEntities(query: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        ...(linkedTypeId && { typeId: linkedTypeId }),
        limit: '10'
      });
      const response = await api.get(`/api/entities/search?${params}`);
      if (response.success && response.data) {
        setResults(response.data as LinkedEntity[]);
      }
    } catch (err) {
      console.error('[LinkField] Search failed:', err);
    } finally {
      setLoading(false);
    }
  }
  
  function selectEntity(entity: LinkedEntity) {
    onChange(entity.id);
    setLinkedEntity(entity);
    setIsOpen(false);
    setSearch('');
  }
  
  function clearSelection() {
    onChange(null);
    setLinkedEntity(null);
  }
  
  return (
    <div ref={containerRef} class="relative">
      {/* Current selection or input */}
      {linkedEntity ? (
        <div class={`input flex items-center justify-between ${error ? 'border-red-500' : ''} ${disabled ? 'bg-surface-100' : ''}`}>
          <div class="flex items-center gap-2">
            <span class="i-lucide-link text-surface-400"></span>
            <div>
              <span class="font-medium text-surface-900 dark:text-surface-100">{linkedEntity.title}</span>
              {linkedType && (
                <span class="text-xs text-surface-500 ml-2">({linkedType.name})</span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              class="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
            >
              <span class="i-lucide-x text-surface-400"></span>
            </button>
          )}
        </div>
      ) : (
        <div 
          class={`input flex items-center gap-2 cursor-text ${error ? 'border-red-500' : ''} ${disabled ? 'bg-surface-100 cursor-not-allowed' : ''}`}
          onClick={() => !disabled && setIsOpen(true)}
        >
          <span class="i-lucide-link text-surface-400"></span>
          <span class="text-surface-400">
            {field.placeholder || `Link to ${linkedType?.name || 'entity'}...`}
          </span>
        </div>
      )}
      
      {/* Dropdown */}
      {isOpen && !disabled && (
        <div class="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg max-h-60 overflow-hidden">
          {/* Search */}
          <div class="p-2 border-b border-surface-200 dark:border-surface-700">
            <div class="relative">
              <span class="i-lucide-search absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"></span>
              <input
                type="text"
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                class="input text-sm pl-9"
                placeholder={`Search ${linkedType?.pluralName || 'entities'}...`}
                autoFocus
              />
            </div>
          </div>
          
          {/* Results */}
          <div class="overflow-y-auto max-h-48">
            {loading ? (
              <div class="p-3 text-center">
                <span class="i-lucide-loader-2 animate-spin text-primary-500"></span>
              </div>
            ) : results.length > 0 ? (
              results.map(entity => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => selectEntity(entity)}
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-700"
                >
                  <span class="i-lucide-file-text text-surface-400"></span>
                  <span class="text-surface-900 dark:text-surface-100">{entity.title}</span>
                </button>
              ))
            ) : search ? (
              <div class="p-3 text-center text-surface-500 text-sm">
                No results found
              </div>
            ) : (
              <div class="p-3 text-center text-surface-500 text-sm">
                Type to search...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
