/**
 * Branding Store
 * 
 * Manages platform branding configuration state.
 */

import { signal, computed } from '@preact/signals';
import { api } from '../lib/api';
import type { BrandingConfig } from '@1cc/shared';

// Branding config signal
const branding = signal<BrandingConfig | null>(null);
const loading = signal(false);
const error = signal<string | null>(null);

/**
 * Load branding configuration from API
 */
export async function loadBranding() {
  loading.value = true;
  error.value = null;
  
  try {
    const response = await api.get('/api/platform/branding') as {
      success: boolean;
      data?: BrandingConfig | null;
      error?: { message: string };
    };
    
    if (response.success && response.data) {
      branding.value = response.data;
    } else {
      // Use defaults if no branding config exists
      branding.value = {
        rootOrgId: 'root001',
        siteName: 'OneConsortium',
        defaultTheme: 'light',
        logoUrl: '/logo.svg'
      };
    }
  } catch (err) {
    console.error('[Branding] Error loading branding:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load branding';
    // Use defaults on error
    branding.value = {
      rootOrgId: 'root001',
      siteName: 'OneConsortium',
      defaultTheme: 'light',
      logoUrl: '/logo.svg'
    };
  } finally {
    loading.value = false;
  }
}

/**
 * Get computed branding values with defaults
 */
export const siteName = computed(() => branding.value?.siteName || 'OneConsortium');
export const logoUrl = computed(() => branding.value?.logoUrl || '/logo.svg');
export const logoDarkUrl = computed(() => branding.value?.logoDarkUrl || null);
export const faviconUrl = computed(() => branding.value?.faviconUrl || null);
export const privacyPolicyUrl = computed(() => branding.value?.privacyPolicyUrl || null);
export const primaryColor = computed(() => branding.value?.primaryColor || null);
export const accentColor = computed(() => branding.value?.accentColor || null);

/**
 * Branding store hook
 */
export function useBranding() {
  return {
    branding: computed(() => branding.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    siteName,
    logoUrl,
    logoDarkUrl,
    faviconUrl,
    privacyPolicyUrl,
    primaryColor,
    accentColor,
    loadBranding
  };
}
