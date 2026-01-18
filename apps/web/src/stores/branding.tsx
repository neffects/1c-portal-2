/**
 * Branding Store
 * 
 * Manages platform branding configuration state.
 * Now reads from manifest config (loaded via sync store) instead of separate API call.
 */

import { computed } from '@preact/signals';
import type { BrandingConfig } from '@1cc/shared';
import { useSync } from './sync';

// Default branding config fallback
const defaultBranding: BrandingConfig = {
  rootOrgId: 'root001',
  siteName: 'OneConsortium',
  defaultTheme: 'light',
  logoUrl: '/logo.svg'
};

/**
 * Get computed branding values with defaults
 * Now computed from sync store's manifest config
 */
export function useBranding() {
  const sync = useSync();
  const branding = computed(() => sync.config.value?.branding || defaultBranding);
  
  return {
    branding,
    loading: computed(() => sync.syncing.value),
    error: computed(() => sync.syncError.value),
    siteName: computed(() => branding.value?.siteName || 'OneConsortium'),
    logoUrl: computed(() => branding.value?.logoUrl || '/logo.svg'),
    logoDarkUrl: computed(() => branding.value?.logoDarkUrl || null),
    faviconUrl: computed(() => branding.value?.faviconUrl || null),
    privacyPolicyUrl: computed(() => branding.value?.privacyPolicyUrl || null),
    primaryColor: computed(() => branding.value?.primaryColor || null),
    accentColor: computed(() => branding.value?.accentColor || null)
  };
}

// Legacy exports for backwards compatibility (now use sync store)
export const siteName = computed(() => {
  // This won't work without useSync context - use useBranding() hook instead
  return defaultBranding.siteName;
});
export const logoUrl = computed(() => defaultBranding.logoUrl);
export const logoDarkUrl = computed(() => null);
export const faviconUrl = computed(() => null);
export const privacyPolicyUrl = computed(() => null);
export const primaryColor = computed(() => null);
export const accentColor = computed(() => null);

/**
 * Legacy loadBranding function - no longer needed, branding comes from manifest
 * Kept for backwards compatibility but does nothing
 */
export async function loadBranding() {
  console.log('[Branding] loadBranding() called but branding now comes from manifest config via sync store');
  // No-op - branding is loaded automatically via manifest
}
