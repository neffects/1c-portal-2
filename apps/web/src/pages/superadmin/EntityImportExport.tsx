/**
 * Entity Import/Export Page
 * 
 * Superadmin page for bulk importing and exporting entity data.
 * Supports CSV and JSON formats.
 */

import { useEffect, useState, useRef } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { ImportValidator } from '../../components/ImportValidator';
import {
  parseCSV,
  convertToImportData,
  validateImportData,
  downloadCSV,
  downloadJSON,
  type ImportError
} from '../../lib/csv';
import type { Entity, EntityType, EntityTypeListItem } from '@1cc/shared';

type TabType = 'export' | 'import';
type ExportFormat = 'csv' | 'json';

export function EntityImportExport() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('export');
  
  // Entity types
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  // Export state
  const [exportTypeId, setExportTypeId] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  
  // Import state
  const [importTypeId, setImportTypeId] = useState<string>('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<Array<{ data: Record<string, unknown>; visibility?: string; slug?: string; organizationId?: string | null; organizationSlug?: string; id?: string }>>([]);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count?: number; message?: string } | null>(null);
  const [entityTypeSchema, setEntityTypeSchema] = useState<EntityType | null>(null);
  
  // Import mode and update mode
  const [importMode, setImportMode] = useState<'add-new' | 'update' | 'mixed'>('add-new');
  const [globalUpdateMode, setGlobalUpdateMode] = useState<'in-place' | 'increment-version'>('increment-version');
  
  // Entity status tracking
  interface EntityImportStatus {
    rowIndex: number;
    exists: boolean;
    existingEntityId?: string;
    status: 'new' | 'exists' | 'error';
    shouldUpdate: boolean; // Checkbox state
    updateMode: 'in-place' | 'increment-version'; // Per-entity update mode
  }
  const [entityStatuses, setEntityStatuses] = useState<EntityImportStatus[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[EntityImportExport] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load entity types
  useEffect(() => {
    if (isSuperadmin.value) {
      loadEntityTypes();
    }
  }, [isSuperadmin.value]);
  
  // Load entity type schema when import type changes
  useEffect(() => {
    if (importTypeId) {
      loadEntityTypeSchema(importTypeId);
    } else {
      setEntityTypeSchema(null);
    }
  }, [importTypeId]);
  
  async function loadEntityTypes() {
    setLoadingTypes(true);
    try {
      const response = await api.get('/api/entity-types') as {
        success: boolean;
        data?: { items: EntityTypeListItem[] };
      };
      
      if (response.success && response.data) {
        const activeTypes = response.data.items.filter(t => t.isActive !== false);
        setEntityTypes(activeTypes);
        console.log('[EntityImportExport] Loaded', activeTypes.length, 'entity types');
      }
    } catch (err) {
      console.error('[EntityImportExport] Error loading entity types:', err);
    } finally {
      setLoadingTypes(false);
    }
  }
  
  async function loadEntityTypeSchema(typeId: string) {
    try {
      // Use the export endpoint to get schema (it includes field definitions)
      const response = await api.get(`/api/super/entities/export?typeId=${typeId}`) as {
        success: boolean;
        data?: { entityType: EntityType; entities: Entity[] };
      };
      
      if (response.success && response.data) {
        setEntityTypeSchema(response.data.entityType as EntityType);
      }
    } catch (err) {
      console.error('[EntityImportExport] Error loading entity type schema:', err);
    }
  }
  
  async function handleExport() {
    if (!exportTypeId) return;
    
    setExporting(true);
    setExportStatus(null);
    
    try {
      // First, get the count from the listing endpoint to compare
      let listingCount: number | null = null;
      try {
        const listResponse = await api.get(`/api/super/entities?typeId=${exportTypeId}&page=1&pageSize=1`) as {
          success: boolean;
          data?: { total?: number };
        };
        if (listResponse.success && listResponse.data?.total !== undefined) {
          listingCount = listResponse.data.total;
          console.log('[EntityImportExport] Listing count:', listingCount);
        }
      } catch (err) {
        console.warn('[EntityImportExport] Failed to fetch listing count:', err);
      }
      
      // Export entities
      const response = await api.get(`/api/super/entities/export?typeId=${exportTypeId}`) as {
        success: boolean;
        data?: { entityType: EntityType; entities: Entity[]; exportedAt: string };
        error?: { code?: string; message: string };
      };
      
      if (!response.success) {
        const errorMsg = response.error?.message || 'Unknown error';
        const errorCode = response.error?.code || 'UNKNOWN';
        console.error('[EntityImportExport] Export failed:', errorCode, errorMsg);
        setExportStatus(`Export failed: ${errorMsg}. Check console for details.`);
        return;
      }
      
      if (!response.data) {
        console.error('[EntityImportExport] Export returned no data');
        setExportStatus('Export failed: No data returned from server');
        return;
      }
      
      const { entityType, entities } = response.data;
      const exportedCount = entities.length;
      
      console.log('[EntityImportExport] Export response received:', {
        entityCount: exportedCount,
        entityIds: entities.map(e => e.id),
        entityNames: entities.map(e => e.name)
      });
      
      if (exportFormat === 'csv') {
        downloadCSV(entities, entityType as EntityType);
      } else {
        downloadJSON(entities, entityType as EntityType);
      }
      
      // Build status message with count comparison
      let statusMsg = `Exported ${exportedCount} entities as ${exportFormat.toUpperCase()}`;
      if (listingCount !== null) {
        if (exportedCount === listingCount) {
          statusMsg += ` (matches listing count: ${listingCount})`;
        } else {
          statusMsg += ` ⚠️ WARNING: Listing shows ${listingCount} entities, but exported ${exportedCount}`;
          console.warn('[EntityImportExport] Count mismatch - listing:', listingCount, 'exported:', exportedCount);
        }
      }
      
      setExportStatus(statusMsg);
    } catch (err) {
      console.error('[EntityImportExport] Export error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setExportStatus(`Export failed: ${errorMsg}. Check console for details.`);
    } finally {
      setExporting(false);
    }
  }
  
  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;
    
    setImportFile(file);
    setImportResult(null);
    setImportErrors([]);
    
    // Read and parse file
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      processImportFile(file.name, content);
    };
    reader.readAsText(file);
  }
  
  function processImportFile(filename: string, content: string) {
    if (!entityTypeSchema) {
      setImportErrors([{
        rowIndex: 0,
        message: 'Please select an entity type first',
        source: 'validation'
      }]);
      return;
    }
    
    const isJson = filename.endsWith('.json');
    
    if (isJson) {
      // Parse JSON
      try {
        const parsed = JSON.parse(content);
        
        // Handle both array format and export format
        let entities: Array<{ data: Record<string, unknown>; visibility?: string; slug?: string; organizationId?: string | null; id?: string }>;
        
        if (Array.isArray(parsed)) {
          entities = parsed.map(e => ({
            data: e.data || e,
            visibility: e.visibility,
            slug: e.slug,
            organizationId: e.organizationId,
            id: e.id
          }));
        } else if (parsed.entities && Array.isArray(parsed.entities)) {
          entities = parsed.entities;
        } else {
          throw new Error('Invalid JSON format. Expected array or { entities: [...] }');
        }
        
        // Validate
        const validationErrors = validateImportData(entities, entityTypeSchema);
        
        setImportData(entities);
        setImportErrors(validationErrors);
        
        // Initialize entity statuses (will be checked later or set by user interaction)
        const initialStatuses: EntityImportStatus[] = entities.map((_, index) => ({
          rowIndex: index,
          exists: false, // Will be determined by backend or user marking
          status: 'new',
          shouldUpdate: false,
          updateMode: globalUpdateMode
        }));
        setEntityStatuses(initialStatuses);
      } catch (err) {
        setImportErrors([{
          rowIndex: 0,
          message: `JSON parse error: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
          source: 'parse'
        }]);
        setImportData([]);
      }
    } else {
      // Parse CSV
      const parseResult = parseCSV(content, true);
      
      if (!parseResult.success) {
        setImportErrors(parseResult.errors);
        setImportData([]);
        return;
      }
      
      // Convert to entity format
      const { entities, errors: conversionErrors } = convertToImportData(
        parseResult.data,
        entityTypeSchema
      );
      
      // Additional validation
      const validationErrors = validateImportData(entities, entityTypeSchema);
      
      setImportData(entities);
      setImportErrors([...conversionErrors, ...validationErrors]);
      
      // Initialize entity statuses (will be checked later or set by user interaction)
      const initialStatuses: EntityImportStatus[] = entities.map((_, index) => ({
        rowIndex: index,
        exists: false, // Will be determined by backend or user marking
        status: 'new',
        shouldUpdate: false,
        updateMode: globalUpdateMode
      }));
      setEntityStatuses(initialStatuses);
    }
  }
  
  async function handleImport() {
    if (!importTypeId || importData.length === 0 || importErrors.length > 0) {
      return;
    }
    
    setImporting(true);
    setImportResult(null);
    
    try {
      // Map entity statuses to shouldUpdate and updateMode flags
      const entitiesWithFlags = importData.map((entity, index) => {
        const status = entityStatuses[index];
        return {
          ...entity,
          shouldUpdate: status?.shouldUpdate || false,
          updateMode: status?.updateMode || globalUpdateMode
        };
      });
      
      console.log('[EntityImportExport] Importing with mode:', importMode, 'update mode:', globalUpdateMode);
      console.log('[EntityImportExport] Entities with flags:', entitiesWithFlags.map((e, i) => ({
        id: e.id,
        slug: e.slug,
        shouldUpdate: e.shouldUpdate,
        updateMode: e.updateMode,
        status: entityStatuses[i]?.status
      })));
      
      const response = await api.post('/api/super/entities/bulk-import', {
        entityTypeId: importTypeId,
        organizationId: null, // Global entities for superadmin
        importMode,
        updateMode: globalUpdateMode,
        entities: entitiesWithFlags
      }) as {
        success: boolean;
        data?: { created: string[]; count: number };
        errors?: Array<{ rowIndex: number; field?: string; message: string }>;
        error?: { message: string };
      };
      
      if (!response.success) {
        // Server returned validation errors
        if (response.errors) {
          const serverErrors: ImportError[] = response.errors.map(e => ({
            rowIndex: e.rowIndex,
            csvRow: e.rowIndex + 3,
            field: e.field,
            message: e.message,
            source: 'server' as const
          }));
          setImportErrors(serverErrors);
          setImportResult({
            success: false,
            message: `Import failed: ${response.errors.length} validation errors`
          });
        } else {
          setImportResult({
            success: false,
            message: response.error?.message || 'Import failed'
          });
        }
        return;
      }
      
      setImportResult({
        success: true,
        count: response.data?.count,
        message: `Successfully imported ${response.data?.count} entities`
      });
      
      // Reset form
      setImportFile(null);
      setImportData([]);
      setImportErrors([]);
      setEntityStatuses([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('[EntityImportExport] Import error:', err);
      setImportResult({
        success: false,
        message: 'Import failed: Network error'
      });
    } finally {
      setImporting(false);
    }
  }
  
  function handleFileDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    
    // Check file type
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.json')) {
      setImportErrors([{
        rowIndex: 0,
        message: 'Invalid file type. Please upload a CSV or JSON file.',
        source: 'parse'
      }]);
      return;
    }
    
    setImportFile(file);
    setImportResult(null);
    setImportErrors([]);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      processImportFile(file.name, content);
    };
    reader.readAsText(file);
  }
  
  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  if (authLoading.value || loadingTypes) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="flex items-start justify-between mb-8">
        <div>
          <nav class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 mb-2">
            <a href="/super" class="hover:text-surface-700 dark:hover:text-surface-200">Superadmin</a>
            <span class="i-lucide-chevron-right"></span>
            <span class="text-surface-900 dark:text-surface-100">Import / Export</span>
          </nav>
          <h1 class="heading-1 mb-2">Entity Import / Export</h1>
          <p class="body-text">Bulk import and export entity data as CSV or JSON.</p>
        </div>
        <a href="/super" class="btn-secondary">
          <span class="i-lucide-arrow-left"></span>
          Back to Dashboard
        </a>
      </div>
      
      {/* Tabs */}
      <div class="flex border-b border-surface-200 dark:border-surface-700 mb-6">
        <button
          onClick={() => setActiveTab('export')}
          class={`px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'export'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
          }`}
        >
          <span class="i-lucide-download mr-2"></span>
          Export
        </button>
        <button
          onClick={() => setActiveTab('import')}
          class={`px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'import'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
          }`}
        >
          <span class="i-lucide-upload mr-2"></span>
          Import
        </button>
      </div>
      
      {/* Export Tab */}
      {activeTab === 'export' && (
        <div class="space-y-6">
          <div class="card p-6">
            <h2 class="heading-4 mb-4">Export Entities</h2>
            <p class="body-text mb-6">
              Export all entities of a specific type. The CSV format includes a template row with field types and examples.
            </p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Entity Type */}
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Entity Type
                </label>
                <select
                  value={exportTypeId}
                  onChange={(e) => setExportTypeId((e.target as HTMLSelectElement).value)}
                  class="input w-full"
                >
                  <option value="">Select a type...</option>
                  {entityTypes.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.name} ({type.entityCount} entities)
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Format */}
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Format
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat((e.target as HTMLSelectElement).value as ExportFormat)}
                  class="input w-full"
                >
                  <option value="csv">CSV (with template row)</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              
              {/* Export Button */}
              <div class="flex items-end">
                <button
                  onClick={handleExport}
                  disabled={!exportTypeId || exporting}
                  class="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <>
                      <span class="i-lucide-loader-2 animate-spin"></span>
                      Exporting...
                    </>
                  ) : (
                    <>
                      <span class="i-lucide-download"></span>
                      Export
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {exportStatus && (
              <div class={`p-4 rounded-lg ${
                exportStatus.includes('failed') 
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800'
                  : exportStatus.includes('WARNING')
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                  : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800'
              }`}>
                {exportStatus}
              </div>
            )}
          </div>
          
          {/* CSV Format Info */}
          <div class="card p-6">
            <h3 class="heading-5 mb-3">CSV Format</h3>
            <div class="text-sm text-surface-600 dark:text-surface-400 space-y-2">
              <p><strong>Row 1:</strong> Field headers with friendly names (e.g., "Name", "Description", "Price")</p>
              <p><strong>Row 2:</strong> Template row with field types, constraints, and example values</p>
              <p><strong>Row 3+:</strong> Entity data</p>
              <p class="mt-4">
                <strong>Tip:</strong> Export an entity type with no data to get a blank template that you can fill in and import.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Import Tab */}
      {activeTab === 'import' && (
        <div class="space-y-6">
          <div class="card p-6">
            <h2 class="heading-4 mb-4">Import Entities</h2>
            <p class="body-text mb-6">
              Import entities from a CSV or JSON file. All entities are validated before import - if any row fails validation, no entities will be created.
            </p>
            
            {/* Entity Type Selection */}
            <div class="mb-6">
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Entity Type
              </label>
              <select
                value={importTypeId}
                onChange={(e) => {
                  setImportTypeId((e.target as HTMLSelectElement).value);
                  // Reset import state when type changes
                  setImportFile(null);
                  setImportData([]);
                  setImportErrors([]);
                  setImportResult(null);
                  setEntityStatuses([]);
                }}
                class="input w-full max-w-md"
              >
                <option value="">Select a type...</option>
                {entityTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Import Mode Selector */}
            {importTypeId && (
              <div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                    Import Mode
                  </label>
                  <select
                    value={importMode}
                    onChange={(e) => {
                      const mode = (e.target as HTMLSelectElement).value as 'add-new' | 'update' | 'mixed';
                      setImportMode(mode);
                      // Reset entity statuses when mode changes
                      if (importData.length > 0) {
                        const newStatuses = entityStatuses.map(s => ({
                          ...s,
                          shouldUpdate: mode === 'update' ? true : (mode === 'mixed' ? s.shouldUpdate : false)
                        }));
                        setEntityStatuses(newStatuses);
                      }
                    }}
                    class="input w-full"
                  >
                    <option value="add-new">Add New Only</option>
                    <option value="update">Update Existing Only</option>
                    <option value="mixed">Mixed (per entity)</option>
                  </select>
                </div>
                
                {/* Update Mode Selector (only visible when import mode allows updates) */}
                {(importMode === 'update' || importMode === 'mixed') && (
                  <div>
                    <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                      Update Mode (Default)
                    </label>
                    <select
                      value={globalUpdateMode}
                      onChange={(e) => {
                        const mode = (e.target as HTMLSelectElement).value as 'in-place' | 'increment-version';
                        setGlobalUpdateMode(mode);
                        // Update all entity statuses that don't have per-entity override
                        if (importData.length > 0) {
                          const newStatuses = entityStatuses.map(s => ({
                            ...s,
                            updateMode: s.updateMode || mode // Only update if not set per-entity
                          }));
                          setEntityStatuses(newStatuses);
                        }
                      }}
                      class="input w-full"
                    >
                      <option value="increment-version">Increment Version</option>
                      <option value="in-place">Update In Place</option>
                    </select>
                    <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
                      Per-entity settings can override this default
                    </p>
                  </div>
                )}
              </div>
            )}
            
            {/* File Drop Zone */}
            {importTypeId && (
              <div
                onDrop={handleFileDrop}
                onDragOver={handleDragOver}
                class={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  importFile
                    ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                    : 'border-surface-300 dark:border-surface-600 hover:border-primary-400 dark:hover:border-primary-600'
                }`}
              >
                {importFile ? (
                  <div class="flex flex-col items-center gap-4">
                    <div class="flex items-center justify-center gap-4 w-full">
                      <span class="i-lucide-file-text text-3xl text-primary-500"></span>
                      <div class="text-left flex-1">
                        <p class="font-medium text-surface-900 dark:text-surface-100">{importFile.name}</p>
                        <p class="text-sm text-surface-500">
                          {(importFile.size / 1024).toFixed(1)} KB
                          {importData.length > 0 && ` - ${importData.length} rows parsed`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setImportFile(null);
                        setImportData([]);
                        setImportErrors([]);
                        setImportResult(null);
                        setEntityStatuses([]);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      class="btn-secondary text-sm"
                      title="Remove file and start over"
                    >
                      <span class="i-lucide-x"></span>
                      Remove File
                    </button>
                  </div>
                ) : (
                  <>
                    <span class="i-lucide-upload-cloud text-4xl text-surface-400 mb-3 block mx-auto"></span>
                    <p class="text-surface-600 dark:text-surface-400 mb-2">
                      Drag and drop a CSV or JSON file here, or
                    </p>
                    <label class="btn-secondary cursor-pointer inline-flex">
                      <span class="i-lucide-file-plus"></span>
                      Browse Files
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.json"
                        onChange={handleFileSelect}
                        class="hidden"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
          
          {/* Validation Results */}
          {importTypeId && (importData.length > 0 || importErrors.length > 0) && (
            <ImportValidator
              errors={importErrors}
              totalRows={importData.length}
              isLoading={false}
            />
          )}
          
          {/* Preview Entities to Import */}
          {importTypeId && importData.length > 0 && entityTypeSchema && (
            <div class="card overflow-hidden">
              <div class="p-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <span class="i-lucide-eye text-xl text-primary-500"></span>
                    <div>
                      <h3 class="font-medium text-surface-900 dark:text-surface-100">
                        Preview: {importData.length} {importData.length === 1 ? 'Entity' : 'Entities'} to Import
                      </h3>
                      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                        Review the entities below before importing
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div class="overflow-x-auto max-h-96 overflow-y-auto">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-800 sticky top-0">
                    <tr>
                      <th class="text-left px-4 py-2 font-medium text-surface-500 w-16">Row</th>
                      <th class="text-left px-4 py-2 font-medium text-surface-500">Name</th>
                      <th class="text-left px-4 py-2 font-medium text-surface-500">Slug</th>
                      {entityTypeSchema.fields
                        .filter(f => f.id !== 'name' && f.id !== 'slug' && f.name !== 'Name' && f.name !== 'Slug')
                        .slice(0, 5) // Show up to 5 additional fields
                        .map(field => (
                          <th key={field.id} class="text-left px-4 py-2 font-medium text-surface-500">
                            {field.name}
                          </th>
                        ))}
                      <th class="text-left px-4 py-2 font-medium text-surface-500 w-24">Status</th>
                      {(importMode === 'mixed' || importMode === 'update') && (
                        <>
                          <th class="text-left px-4 py-2 font-medium text-surface-500 w-32">Action</th>
                          <th class="text-left px-4 py-2 font-medium text-surface-500 w-40">Update Mode</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-100 dark:divide-surface-700">
                    {importData.map((entity, index) => {
                      const rowErrors = importErrors.filter(e => e.rowIndex === index);
                      const hasErrors = rowErrors.length > 0;
                      const entityStatus = entityStatuses[index] || {
                        rowIndex: index,
                        exists: false,
                        status: 'new' as const,
                        shouldUpdate: false,
                        updateMode: globalUpdateMode
                      };
                      const name = (entity.data.name as string) || `Entity ${index + 1}`;
                      const slug = (entity.slug || entity.data.slug) as string || '(auto-generated)';
                      const previewFields = entityTypeSchema.fields
                        .filter(f => f.id !== 'name' && f.id !== 'slug' && f.name !== 'Name' && f.name !== 'Slug')
                        .slice(0, 5);
                      
                      // Helper to format field value for display
                      const formatFieldValue = (value: unknown, fieldType?: string): string => {
                        if (value === null || value === undefined || value === '') {
                          return '—';
                        }
                        if (Array.isArray(value)) {
                          return value.length > 0 ? value.join(', ') : '—';
                        }
                        if (typeof value === 'boolean') {
                          return value ? 'Yes' : 'No';
                        }
                        const str = String(value);
                        // Truncate long values
                        return str.length > 50 ? str.substring(0, 47) + '...' : str;
                      };
                      
                      return (
                        <tr
                          key={index}
                          class={`hover:bg-surface-50 dark:hover:bg-surface-800/50 ${
                            hasErrors ? 'bg-red-50/50 dark:bg-red-900/10' : 
                            entityStatus.exists ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''
                          }`}
                        >
                          <td class="px-4 py-2 text-surface-700 dark:text-surface-300 font-mono text-xs">
                            {index + 3}
                          </td>
                          <td class="px-4 py-2 text-surface-900 dark:text-surface-100 font-medium">
                            {name}
                          </td>
                          <td class="px-4 py-2 text-surface-600 dark:text-surface-400 font-mono text-xs">
                            {slug}
                          </td>
                          {previewFields.map(field => {
                            const value = entity.data[field.id];
                            return (
                              <td key={field.id} class="px-4 py-2 text-surface-700 dark:text-surface-300">
                                {formatFieldValue(value, field.type)}
                              </td>
                            );
                          })}
                          <td class="px-4 py-2">
                            {hasErrors ? (
                              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                <span class="i-lucide-alert-circle text-xs"></span>
                                Error
                              </span>
                            ) : entityStatus.exists ? (
                              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                <span class="i-lucide-info text-xs"></span>
                                Exists
                              </span>
                            ) : (
                              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                <span class="i-lucide-plus-circle text-xs"></span>
                                New
                              </span>
                            )}
                          </td>
                          {(importMode === 'mixed' || importMode === 'update') && (
                            <>
                              <td class="px-4 py-2">
                                {entityStatus.exists || importMode === 'mixed' ? (
                                  <label class="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={entityStatus.shouldUpdate}
                                      onChange={(e) => {
                                        const newStatuses = [...entityStatuses];
                                        if (!newStatuses[index]) {
                                          newStatuses[index] = { ...entityStatus, rowIndex: index };
                                        }
                                        newStatuses[index].shouldUpdate = (e.target as HTMLInputElement).checked;
                                        setEntityStatuses(newStatuses);
                                      }}
                                      class="w-4 h-4 text-primary-600 border-surface-300 rounded focus:ring-primary-500"
                                    />
                                    <span class="text-xs text-surface-600 dark:text-surface-400">
                                      {entityStatus.shouldUpdate ? 'Update' : 'Create'}
                                    </span>
                                  </label>
                                ) : (
                                  <span class="text-xs text-surface-500">—</span>
                                )}
                              </td>
                              <td class="px-4 py-2">
                                {entityStatus.shouldUpdate && (entityStatus.exists || importMode === 'update') ? (
                                  <select
                                    value={entityStatus.updateMode}
                                    onChange={(e) => {
                                      const newStatuses = [...entityStatuses];
                                      if (!newStatuses[index]) {
                                        newStatuses[index] = { ...entityStatus, rowIndex: index };
                                      }
                                      newStatuses[index].updateMode = (e.target as HTMLSelectElement).value as 'in-place' | 'increment-version';
                                      setEntityStatuses(newStatuses);
                                    }}
                                    class="input text-xs py-1 px-2 h-8"
                                  >
                                    <option value="increment-version">Increment Version</option>
                                    <option value="in-place">In Place</option>
                                  </select>
                                ) : (
                                  <span class="text-xs text-surface-500">—</span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              {importData.length > 10 && (
                <div class="px-4 py-3 border-t border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-xs text-surface-500">
                  Showing all {importData.length} entities. Scroll to view more.
                </div>
              )}
            </div>
          )}
          
          {/* Import Button */}
          {importTypeId && importData.length > 0 && (
            <div class="flex items-center gap-4">
              <button
                onClick={handleImport}
                disabled={importing || importErrors.length > 0}
                class="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <>
                    <span class="i-lucide-loader-2 animate-spin"></span>
                    Importing...
                  </>
                ) : (
                  <>
                    <span class="i-lucide-upload"></span>
                    Import {importData.length} Entities
                  </>
                )}
              </button>
              
              {importErrors.length > 0 && (
                <p class="text-sm text-amber-600 dark:text-amber-400">
                  Fix validation errors before importing
                </p>
              )}
            </div>
          )}
          
          {/* Import Result */}
          {importResult && (
            <div class={`card p-6 ${
              importResult.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
            }`}>
              <div class="flex items-center gap-3">
                {importResult.success ? (
                  <span class="i-lucide-check-circle text-2xl text-green-500"></span>
                ) : (
                  <span class="i-lucide-x-circle text-2xl text-red-500"></span>
                )}
                <div>
                  <p class={`font-medium ${
                    importResult.success 
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}>
                    {importResult.message}
                  </p>
                  {importResult.success && importResult.count && (
                    <p class="text-sm text-green-600 dark:text-green-500 mt-1">
                      Entities created as drafts. Go to the Entities list to review and publish them.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
