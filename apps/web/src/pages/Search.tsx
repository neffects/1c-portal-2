/**
 * Search Page
 * 
 * Full-text search across entities with filters.
 */

import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { useEntityTypes } from '../hooks/useDB';
import { api } from '../lib/api';
import { EntityCard } from '../components/EntityCard';
import type { ManifestEntry, ManifestEntityType } from '@1cc/shared';

interface SearchFilters {
  query: string;
  typeId: string | null;
  visibility: string | null;
  status: string | null;
  sortBy: 'relevance' | 'updatedAt' | 'title';
  sortOrder: 'asc' | 'desc';
}

interface SearchResult {
  entity: ManifestEntry;
  score: number;
  highlights?: string[];
}

export function Search() {
  const { data: types, loading: typesLoading } = useEntityTypes();
  
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    typeId: null,
    visibility: null,
    status: null,
    sortBy: 'relevance',
    sortOrder: 'desc'
  });
  
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const pageSize = 20;
  
  // Parse URL params on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const q = urlParams.get('q');
    const type = urlParams.get('type');
    
    if (q) {
      setFilters(prev => ({ ...prev, query: q, typeId: type }));
      performSearch(q, type);
    }
  }, []);
  
  async function performSearch(query?: string, typeId?: string | null) {
    const searchQuery = query ?? filters.query;
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    
    setLoading(true);
    setHasSearched(true);
    
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder
      });
      
      if (typeId ?? filters.typeId) {
        params.set('typeId', (typeId ?? filters.typeId)!);
      }
      if (filters.visibility) {
        params.set('visibility', filters.visibility);
      }
      if (filters.status) {
        params.set('status', filters.status);
      }
      
      const response = await api.get(`/api/entities/search?${params}`);
      
      if (response.success && response.data) {
        const data = response.data as { results: SearchResult[]; total: number };
        setResults(data.results);
        setTotalResults(data.total);
      }
    } catch (error) {
      console.error('[Search] Error:', error);
    } finally {
      setLoading(false);
    }
  }
  
  function handleSearch(e: Event) {
    e.preventDefault();
    setPage(1);
    
    // Update URL
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.typeId) params.set('type', filters.typeId);
    window.history.pushState({}, '', `/search?${params}`);
    
    performSearch();
  }
  
  function updateFilter<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }
  
  function clearFilters() {
    setFilters({
      query: '',
      typeId: null,
      visibility: null,
      status: null,
      sortBy: 'relevance',
      sortOrder: 'desc'
    });
    setResults([]);
    setHasSearched(false);
    window.history.pushState({}, '', '/search');
  }
  
  const totalPages = Math.ceil(totalResults / pageSize);
  
  return (
    <div class="container-default py-12">
      {/* Search header */}
      <div class="mb-8">
        <h1 class="heading-1 mb-4">Search</h1>
        
        {/* Search form */}
        <form onSubmit={handleSearch} class="flex gap-3">
          <div class="relative flex-1">
            <span class="i-lucide-search absolute left-4 top-1/2 -translate-y-1/2 text-surface-400"></span>
            <input
              type="text"
              value={filters.query}
              onInput={(e) => updateFilter('query', (e.target as HTMLInputElement).value)}
              class="input pl-11 text-lg"
              placeholder="Search entities..."
              autoFocus
            />
          </div>
          <button type="submit" class="btn-primary px-8">
            Search
          </button>
        </form>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Filters sidebar */}
        <aside class="lg:col-span-1">
          <div class="card p-4 sticky top-4 space-y-6">
            <div class="flex items-center justify-between">
              <h2 class="font-semibold text-surface-900 dark:text-surface-100">Filters</h2>
              <button
                type="button"
                onClick={clearFilters}
                class="text-sm text-primary-600 hover:text-primary-700"
              >
                Clear all
              </button>
            </div>
            
            {/* Entity Type */}
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Entity Type
              </label>
              <select
                value={filters.typeId || ''}
                onChange={(e) => updateFilter('typeId', (e.target as HTMLSelectElement).value || null)}
                class="input text-sm"
              >
                <option value="">All types</option>
                {types.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>
            
            {/* Visibility */}
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Visibility
              </label>
              <select
                value={filters.visibility || ''}
                onChange={(e) => updateFilter('visibility', (e.target as HTMLSelectElement).value || null)}
                class="input text-sm"
              >
                <option value="">Any</option>
                <option value="public">Public</option>
                <option value="platform">Platform</option>
                <option value="private">Private</option>
              </select>
            </div>
            
            {/* Status */}
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Status
              </label>
              <select
                value={filters.status || ''}
                onChange={(e) => updateFilter('status', (e.target as HTMLSelectElement).value || null)}
                class="input text-sm"
              >
                <option value="">Any</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending Review</option>
              </select>
            </div>
            
            {/* Sort */}
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Sort by
              </label>
              <select
                value={filters.sortBy}
                onChange={(e) => updateFilter('sortBy', (e.target as HTMLSelectElement).value as SearchFilters['sortBy'])}
                class="input text-sm"
              >
                <option value="relevance">Relevance</option>
                <option value="updatedAt">Last Updated</option>
                <option value="title">Title</option>
              </select>
            </div>
            
            {/* Sort order */}
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => updateFilter('sortOrder', 'desc')}
                class={`flex-1 py-2 px-3 rounded text-sm ${filters.sortOrder === 'desc' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600' : 'bg-surface-100 dark:bg-surface-800'}`}
              >
                <span class="i-lucide-arrow-down mr-1"></span>
                Desc
              </button>
              <button
                type="button"
                onClick={() => updateFilter('sortOrder', 'asc')}
                class={`flex-1 py-2 px-3 rounded text-sm ${filters.sortOrder === 'asc' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600' : 'bg-surface-100 dark:bg-surface-800'}`}
              >
                <span class="i-lucide-arrow-up mr-1"></span>
                Asc
              </button>
            </div>
            
            <button
              type="button"
              onClick={() => performSearch()}
              class="btn-secondary w-full"
            >
              Apply Filters
            </button>
          </div>
        </aside>
        
        {/* Results */}
        <main class="lg:col-span-3">
          {loading ? (
            <div class="flex items-center justify-center py-20">
              <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
            </div>
          ) : hasSearched ? (
            <>
              {/* Results header */}
              <div class="flex items-center justify-between mb-6">
                <p class="text-surface-600 dark:text-surface-400">
                  {totalResults > 0 ? (
                    <>
                      Showing <span class="font-semibold">{(page - 1) * pageSize + 1}</span> - <span class="font-semibold">{Math.min(page * pageSize, totalResults)}</span> of <span class="font-semibold">{totalResults}</span> results
                    </>
                  ) : (
                    'No results found'
                  )}
                </p>
              </div>
              
              {/* Results grid */}
              {results.length > 0 ? (
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {results.map(result => (
                    <EntityCard
                      key={result.entity.id}
                      entity={result.entity}
                      showType
                      highlights={result.highlights}
                    />
                  ))}
                </div>
              ) : (
                <div class="text-center py-16">
                  <span class="i-lucide-search-x text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
                  <h3 class="heading-3 mb-2">No results found</h3>
                  <p class="body-text mb-6">
                    Try adjusting your search terms or filters.
                  </p>
                  <button type="button" onClick={clearFilters} class="btn-secondary">
                    Clear filters
                  </button>
                </div>
              )}
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div class="flex items-center justify-center gap-2 mt-8">
                  <button
                    type="button"
                    onClick={() => { setPage(page - 1); performSearch(); }}
                    disabled={page === 1}
                    class="btn-ghost"
                  >
                    <span class="i-lucide-chevron-left"></span>
                    Previous
                  </button>
                  
                  <div class="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        pageNum = i + 1;
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = page - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => { setPage(pageNum); performSearch(); }}
                          class={`w-10 h-10 rounded ${page === pageNum ? 'bg-primary-600 text-white' : 'hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => { setPage(page + 1); performSearch(); }}
                    disabled={page === totalPages}
                    class="btn-ghost"
                  >
                    Next
                    <span class="i-lucide-chevron-right"></span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div class="text-center py-16">
              <span class="i-lucide-search text-5xl text-surface-300 dark:text-surface-600 mb-4"></span>
              <h3 class="heading-3 mb-2">Search for content</h3>
              <p class="body-text">
                Enter a search term above to find entities across the platform.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
