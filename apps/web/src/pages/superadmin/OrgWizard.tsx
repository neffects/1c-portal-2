/**
 * Organization Creation Wizard
 * 
 * Multi-step wizard for creating new organizations.
 * Steps: Basic Info → Domain Config → Permissions → Admin Assignment → Review
 * 
 * Note: This wizard fetches all entity types directly from the API,
 * not from the sync store manifest (which only contains published content).
 */

import { useState, useEffect } from 'preact/hooks';
import { route } from 'preact-router';
import { api } from '../../lib/api';
import type { EntityTypeListItem } from '@1cc/shared';

interface WizardStep {
  id: string;
  label: string;
}

const STEPS: WizardStep[] = [
  { id: 'basic', label: 'Basic Info' },
  { id: 'domains', label: 'Domains' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'admin', label: 'Admin' },
  { id: 'review', label: 'Review' }
];

interface OrgWizardProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

export function OrgWizard({ onComplete, onCancel }: OrgWizardProps) {
  // Fetch entity types from API (not from sync store which only has public manifest data)
  const [entityTypes, setEntityTypes] = useState<EntityTypeListItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form data
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [domainWhitelist, setDomainWhitelist] = useState<string[]>([]);
  const [allowSelfSignup, setAllowSelfSignup] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [viewableTypes, setViewableTypes] = useState<string[]>([]);
  const [creatableTypes, setCreatableTypes] = useState<string[]>([]);
  const [adminEmail, setAdminEmail] = useState('');
  
  // Fetch all entity types from API on mount
  useEffect(() => {
    async function loadEntityTypes() {
      setLoadingTypes(true);
      console.log('[OrgWizard] Fetching entity types from API...');
      
      try {
        const response = await api.get('/api/entity-types') as { 
          success: boolean; 
          data?: { items: EntityTypeListItem[] } 
        };
        
        if (response.success && response.data) {
          // Only show active entity types
          const activeTypes = response.data.items.filter(t => t.isActive !== false);
          setEntityTypes(activeTypes);
          console.log('[OrgWizard] Loaded', activeTypes.length, 'entity types');
        } else {
          console.error('[OrgWizard] Failed to load entity types:', response);
        }
      } catch (err) {
        console.error('[OrgWizard] Error loading entity types:', err);
      } finally {
        setLoadingTypes(false);
      }
    }
    
    loadEntityTypes();
  }, []);
  
  // Use the fetched entity types (not from sync store)
  const types = entityTypes;
  
  // Auto-generate slug from name
  function handleNameChange(value: string) {
    setName(value);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  }
  
  // Domain management
  function addDomain() {
    if (newDomain && !domainWhitelist.includes(newDomain)) {
      setDomainWhitelist([...domainWhitelist, newDomain.toLowerCase()]);
      setNewDomain('');
    }
  }
  
  function removeDomain(domain: string) {
    setDomainWhitelist(domainWhitelist.filter(d => d !== domain));
  }
  
  // Permission toggles
  function toggleViewable(typeId: string) {
    if (viewableTypes.includes(typeId)) {
      setViewableTypes(viewableTypes.filter(id => id !== typeId));
      setCreatableTypes(creatableTypes.filter(id => id !== typeId));
    } else {
      setViewableTypes([...viewableTypes, typeId]);
    }
  }
  
  function toggleCreatable(typeId: string) {
    if (creatableTypes.includes(typeId)) {
      setCreatableTypes(creatableTypes.filter(id => id !== typeId));
    } else {
      if (!viewableTypes.includes(typeId)) {
        setViewableTypes([...viewableTypes, typeId]);
      }
      setCreatableTypes([...creatableTypes, typeId]);
    }
  }
  
  // Navigation
  function canProceed(): boolean {
    switch (currentStep) {
      case 0: return !!name && !!slug;
      case 1: return true; // Domains optional
      case 2: 
        // Can only proceed if types are loaded and at least one is selected
        // If no types exist at all, allow proceeding (org can be created without permissions)
        return !loadingTypes && (viewableTypes.length > 0 || types.length === 0);
      case 3: return !adminEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail);
      case 4: return true;
      default: return true;
    }
  }
  
  function goNext() {
    if (currentStep < STEPS.length - 1 && canProceed()) {
      setCurrentStep(currentStep + 1);
    }
  }
  
  function goBack() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }
  
  // Submit
  async function handleSubmit() {
    setSaving(true);
    setError(null);
    
    try {
      // Create organization
      const orgResponse = await api.post('/api/organizations', {
        name,
        slug,
        description: description || undefined,
        domainWhitelist,
        allowSelfSignup
      });
      
      if (!orgResponse.success) {
        const errorMessage = orgResponse.error?.message || 'Failed to create organization';
        console.error('[OrgWizard] Failed to create organization:', orgResponse.error);
        throw new Error(errorMessage);
      }
      
      const orgData = orgResponse.data as { id: string };
      
      // Set permissions
      if (viewableTypes.length > 0) {
        await api.patch(`/api/organizations/${orgData.id}/permissions`, {
          viewable: viewableTypes,
          creatable: creatableTypes
        });
      }
      
      // Invite admin if provided
      if (adminEmail) {
        await api.post(`/api/organizations/${orgData.id}/users/invite`, {
          email: adminEmail,
          role: 'org_admin'
        });
      }
      
      console.log('[OrgWizard] Organization created:', orgData.id);
      
      if (onComplete) {
        onComplete();
      } else {
        route('/super/orgs');
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setSaving(false);
    }
  }
  
  // Render step content
  function renderStep() {
    switch (currentStep) {
      case 0:
        return (
          <div class="space-y-6">
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Organization Name <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onInput={(e) => handleNameChange((e.target as HTMLInputElement).value)}
                class="input"
                placeholder="e.g., Acme Corporation"
                autoFocus
              />
            </div>
            
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                URL Slug <span class="text-red-500">*</span>
              </label>
              <div class="flex items-center gap-2">
                <span class="text-surface-500">/org/</span>
                <input
                  type="text"
                  value={slug}
                  onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  class="input flex-1 font-mono"
                  placeholder="acme-corp"
                />
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                class="input"
                rows={3}
                placeholder="Brief description of this organization..."
              />
            </div>
          </div>
        );
      
      case 1:
        return (
          <div class="space-y-6">
            <p class="body-text">
              Configure email domains that can self-register for this organization.
            </p>
            
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Add Domain
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  value={newDomain}
                  onInput={(e) => setNewDomain((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())}
                  class="input flex-1"
                  placeholder="e.g., acme.com"
                />
                <button type="button" onClick={addDomain} class="btn-secondary">
                  Add
                </button>
              </div>
            </div>
            
            {domainWhitelist.length > 0 && (
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Whitelisted Domains
                </label>
                <div class="flex flex-wrap gap-2">
                  {domainWhitelist.map(domain => (
                    <span key={domain} class="inline-flex items-center gap-1 px-3 py-1 bg-surface-100 dark:bg-surface-700 rounded-full text-sm">
                      {domain}
                      <button
                        type="button"
                        onClick={() => removeDomain(domain)}
                        class="text-surface-500 hover:text-red-500"
                      >
                        <span class="i-lucide-x text-xs"></span>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            <label class="flex items-center gap-3 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
              <input
                type="checkbox"
                checked={allowSelfSignup}
                onChange={(e) => setAllowSelfSignup((e.target as HTMLInputElement).checked)}
                class="w-5 h-5 rounded"
              />
              <div>
                <span class="font-medium text-surface-900 dark:text-surface-100">Allow Self-Signup</span>
                <p class="text-sm text-surface-500">Users with whitelisted domains can register without an invitation</p>
              </div>
            </label>
          </div>
        );
      
      case 2:
        return (
          <div class="space-y-6">
            <p class="body-text">
              Select which entity types this organization can view and create.
            </p>
            
            {loadingTypes ? (
              // Loading state while fetching entity types
              <div class="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800 rounded-lg animate-pulse">
                    <div class="flex-1">
                      <div class="h-5 w-32 bg-surface-200 dark:bg-surface-700 rounded mb-2"></div>
                      <div class="h-4 w-48 bg-surface-200 dark:bg-surface-700 rounded"></div>
                    </div>
                    <div class="flex items-center gap-4">
                      <div class="h-4 w-16 bg-surface-200 dark:bg-surface-700 rounded"></div>
                      <div class="h-4 w-16 bg-surface-200 dark:bg-surface-700 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : types.length > 0 ? (
              <div class="space-y-3">
                {types.map(type => (
                  <div key={type.id} class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                    <div>
                      <span class="font-medium text-surface-900 dark:text-surface-100">{type.name}</span>
                      {type.description && (
                        <p class="text-sm text-surface-500">{type.description}</p>
                      )}
                    </div>
                    <div class="flex items-center gap-4">
                      <label class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={viewableTypes.includes(type.id)}
                          onChange={() => toggleViewable(type.id)}
                          class="w-4 h-4 rounded"
                        />
                        <span class="text-sm text-surface-600 dark:text-surface-400">View</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={creatableTypes.includes(type.id)}
                          onChange={() => toggleCreatable(type.id)}
                          class="w-4 h-4 rounded"
                          disabled={!viewableTypes.includes(type.id)}
                        />
                        <span class="text-sm text-surface-600 dark:text-surface-400">Create</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div class="text-center py-8 text-surface-500">
                <span class="i-lucide-box text-4xl mb-4 block mx-auto opacity-50"></span>
                <p>No entity types available. Create some first!</p>
                <a href="/super/types" class="text-primary-600 hover:text-primary-700 text-sm mt-2 inline-block">
                  Go to Entity Type Manager →
                </a>
              </div>
            )}
          </div>
        );
      
      case 3:
        return (
          <div class="space-y-6">
            <p class="body-text">
              Optionally invite an administrator for this organization.
            </p>
            
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Admin Email
              </label>
              <input
                type="email"
                value={adminEmail}
                onInput={(e) => setAdminEmail((e.target as HTMLInputElement).value)}
                class="input"
                placeholder="admin@example.com"
              />
              <p class="text-sm text-surface-500 mt-1">
                They'll receive an invitation email to set up their account.
              </p>
            </div>
          </div>
        );
      
      case 4:
        return (
          <div class="space-y-6">
            <p class="body-text">
              Review the organization details before creating.
            </p>
            
            <div class="space-y-4">
              <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                <h4 class="text-sm font-medium text-surface-500 mb-1">Name</h4>
                <p class="text-surface-900 dark:text-surface-100">{name}</p>
              </div>
              
              <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                <h4 class="text-sm font-medium text-surface-500 mb-1">Slug</h4>
                <p class="text-surface-900 dark:text-surface-100 font-mono">/{slug}</p>
              </div>
              
              {description && (
                <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <h4 class="text-sm font-medium text-surface-500 mb-1">Description</h4>
                  <p class="text-surface-900 dark:text-surface-100">{description}</p>
                </div>
              )}
              
              <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                <h4 class="text-sm font-medium text-surface-500 mb-1">Domains</h4>
                {domainWhitelist.length > 0 ? (
                  <p class="text-surface-900 dark:text-surface-100">{domainWhitelist.join(', ')}</p>
                ) : (
                  <p class="text-surface-500">No domains configured</p>
                )}
                <p class="text-sm text-surface-500 mt-1">
                  Self-signup: {allowSelfSignup ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              
              <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                <h4 class="text-sm font-medium text-surface-500 mb-1">Entity Type Permissions</h4>
                <p class="text-surface-900 dark:text-surface-100">
                  {viewableTypes.length} viewable, {creatableTypes.length} creatable
                </p>
              </div>
              
              {adminEmail && (
                <div class="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <h4 class="text-sm font-medium text-surface-500 mb-1">Initial Admin</h4>
                  <p class="text-surface-900 dark:text-surface-100">{adminEmail}</p>
                </div>
              )}
            </div>
          </div>
        );
    }
  }
  
  return (
    <div class="max-w-2xl mx-auto">
      {/* Progress */}
      <div class="mb-8">
        <div class="flex items-center justify-between mb-2">
          {STEPS.map((step, index) => (
            <div key={step.id} class="flex items-center">
              <div class={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                index < currentStep
                  ? 'bg-primary-600 text-white'
                  : index === currentStep
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-2 border-primary-600'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-500'
              }`}>
                {index < currentStep ? (
                  <span class="i-lucide-check"></span>
                ) : (
                  index + 1
                )}
              </div>
              {index < STEPS.length - 1 && (
                <div class={`w-12 sm:w-20 h-0.5 mx-2 ${
                  index < currentStep ? 'bg-primary-600' : 'bg-surface-200 dark:bg-surface-700'
                }`}></div>
              )}
            </div>
          ))}
        </div>
        <div class="flex justify-between">
          {STEPS.map((step, index) => (
            <span key={step.id} class={`text-xs ${
              index === currentStep ? 'text-primary-600 font-medium' : 'text-surface-500'
            }`}>
              {step.label}
            </span>
          ))}
        </div>
      </div>
      
      {/* Error */}
      {error && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          <span class="i-lucide-alert-circle mr-2"></span>
          {error}
        </div>
      )}
      
      {/* Step content */}
      <div class="card p-6 mb-6">
        <h2 class="heading-3 mb-6">{STEPS[currentStep].label}</h2>
        {renderStep()}
      </div>
      
      {/* Navigation */}
      <div class="flex items-center justify-between">
        <button
          type="button"
          onClick={currentStep === 0 ? onCancel || (() => route('/super/orgs')) : goBack}
          class="btn-ghost"
        >
          {currentStep === 0 ? 'Cancel' : 'Back'}
        </button>
        
        {currentStep < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            class="btn-primary"
            disabled={!canProceed()}
          >
            Next
            <span class="i-lucide-chevron-right ml-1"></span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            class="btn-primary"
            disabled={saving}
          >
            {saving ? (
              <>
                <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                Creating...
              </>
            ) : (
              <>
                <span class="i-lucide-check mr-2"></span>
                Create Organization
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
