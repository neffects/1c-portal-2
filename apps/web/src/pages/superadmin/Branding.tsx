/**
 * Branding Manager Page
 * 
 * Configure platform-wide branding settings including logo, favicon,
 * site name, privacy policy link, and accent colors.
 */

import { useEffect, useState, useRef } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { loadBranding, useBranding } from '../../stores/branding';
import type { BrandingConfig } from '@1cc/shared';

export function Branding() {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  const { branding: brandingStore } = useBranding();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Form fields
  const [siteName, setSiteName] = useState('OneConsortium');
  const [logoUrl, setLogoUrl] = useState('/logo.svg');
  const [logoDarkUrl, setLogoDarkUrl] = useState<string>('');
  const [faviconUrl, setFaviconUrl] = useState<string>('');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('');
  const [accentColor, setAccentColor] = useState<string>('');
  
  // Upload states
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingLogoDark, setUploadingLogoDark] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoDarkInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load branding config
  useEffect(() => {
    if (isSuperadmin.value) {
      loadBranding();
    }
  }, [isSuperadmin.value]);
  
  async function loadBranding() {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get('/api/platform/branding') as {
        success: boolean;
        data?: BrandingConfig | null;
        error?: { message: string };
      };
      
      if (response.success && response.data) {
        const branding = response.data;
        setSiteName(branding.siteName || 'OneConsortium');
        setLogoUrl(branding.logoUrl || '/logo.svg');
        setLogoDarkUrl(branding.logoDarkUrl || '');
        setFaviconUrl(branding.faviconUrl || '');
        setPrivacyPolicyUrl(branding.privacyPolicyUrl || '');
        setPrimaryColor(branding.primaryColor || '');
        setAccentColor(branding.accentColor || '');
      }
    } catch (err) {
      console.error('[Branding] Error loading branding:', err);
      setError(err instanceof Error ? err.message : 'Failed to load branding config');
    } finally {
      setLoading(false);
    }
  }
  
  async function handleLogoUpload(file: File, isDark: boolean) {
    const maxSize = 2 * 1024 * 1024; // 2MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
    
    // Check if file type is in allowed list
    // Also check by extension for SVG files (some browsers don't set MIME type correctly)
    const extension = file.name.split('.').pop()?.toLowerCase();
    const isSvgByExtension = extension === 'svg';
    const isValidType = allowedTypes.includes(file.type) || (isSvgByExtension && file.type === '');
    
    if (!isValidType) {
      setError(`Invalid file type: ${file.type || 'unknown'}. Allowed: ${allowedTypes.join(', ')} or .svg files`);
      return;
    }
    
    if (file.size > maxSize) {
      setError(`File too large. Maximum: ${(maxSize / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    
    if (isDark) {
      setUploadingLogoDark(true);
    } else {
      setUploadingLogo(true);
    }
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'logo');
      
      const response = await api.upload('/api/files/upload', formData);
      
      console.log('[Branding] Upload response:', response);
      
      if (response.success && response.data) {
        const data = response.data as { url: string; path?: string; name?: string };
        const imageUrl = data.url || data.path;
        if (!imageUrl) {
          throw new Error('Upload succeeded but no URL returned');
        }
        console.log('[Branding] Upload response data:', data);
        console.log('[Branding] Extracted imageUrl:', imageUrl);
        
        // Update state directly - Preact should handle this
        if (isDark) {
          console.log('[Branding] Setting dark logo URL:', imageUrl);
          setLogoDarkUrl(imageUrl);
        } else {
          console.log('[Branding] Setting logo URL:', imageUrl);
          setLogoUrl(imageUrl);
        }
        console.log('[Branding] Logo uploaded successfully:', imageUrl);
      } else {
        const errorMsg = response.error?.message || 'Upload failed';
        console.error('[Branding] Upload failed:', response);
        throw new Error(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (isDark) {
        setUploadingLogoDark(false);
      } else {
        setUploadingLogo(false);
      }
    }
  }
  
  async function handleFaviconUpload(file: File) {
    const maxSize = 1 * 1024 * 1024; // 1MB
    const allowedTypes = ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
    
    // Check if file type is in allowed list
    // Also check by extension for SVG/ICO files (some browsers don't set MIME type correctly)
    const extension = file.name.split('.').pop()?.toLowerCase();
    const isSvgByExtension = extension === 'svg';
    const isIcoByExtension = extension === 'ico';
    const isValidType = allowedTypes.includes(file.type) || (isSvgByExtension && (file.type === '' || file.type === 'image/svg+xml')) || (isIcoByExtension && (file.type === '' || file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon'));
    
    if (!isValidType) {
      setError(`Invalid file type: ${file.type || 'unknown'}. Allowed: ${allowedTypes.join(', ')} or .svg/.ico files`);
      return;
    }
    
    if (file.size > maxSize) {
      setError(`File too large. Maximum: ${(maxSize / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    
    setUploadingFavicon(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'favicon');
      
      const response = await api.upload('/api/files/upload', formData);
      
      console.log('[Branding] Favicon upload response:', response);
      
      if (response.success && response.data) {
        const data = response.data as { url: string; path?: string; name?: string };
        const imageUrl = data.url || data.path;
        if (!imageUrl) {
          throw new Error('Upload succeeded but no URL returned');
        }
        setFaviconUrl(imageUrl);
        console.log('[Branding] Favicon uploaded successfully:', imageUrl);
      } else {
        const errorMsg = response.error?.message || 'Upload failed';
        console.error('[Branding] Favicon upload failed:', response);
        throw new Error(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingFavicon(false);
    }
  }
  
  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      // Build branding object, filtering out empty strings
      const branding: Partial<BrandingConfig> = {
        siteName: siteName.trim(),
        logoUrl: logoUrl.trim()
      };
      
      // Only include optional fields if they have values
      if (logoDarkUrl && logoDarkUrl.trim()) {
        branding.logoDarkUrl = logoDarkUrl.trim();
      }
      if (faviconUrl && faviconUrl.trim()) {
        branding.faviconUrl = faviconUrl.trim();
      }
      if (privacyPolicyUrl && privacyPolicyUrl.trim()) {
        branding.privacyPolicyUrl = privacyPolicyUrl.trim();
      }
      if (primaryColor && primaryColor.trim()) {
        branding.primaryColor = primaryColor.trim();
      }
      if (accentColor && accentColor.trim()) {
        branding.accentColor = accentColor.trim();
      }
      
      console.log('[Branding] Saving branding config:', branding);
      
      const response = await api.patch('/api/platform/branding', branding) as {
        success: boolean;
        error?: { message: string; details?: { fields?: Record<string, string[]> } };
      };
      
      console.log('[Branding] Save response:', response);
      
      if (response.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        // Reload branding from API to get the saved values
        await loadBranding();
      } else {
        // Extract detailed error message
        let errorMsg = response.error?.message || 'Failed to save branding';
        if (response.error?.details?.fields) {
          const fieldErrors = Object.entries(response.error.details.fields)
            .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
            .join('; ');
          errorMsg = `${errorMsg}. ${fieldErrors}`;
        }
        throw new Error(errorMsg);
      }
    } catch (err) {
      console.error('[Branding] Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }
  
  if (authLoading.value || loading) {
    return (
      <div class="min-h-[60vh] flex items-center justify-center">
        <span class="i-lucide-loader-2 animate-spin text-3xl text-primary-500"></span>
      </div>
    );
  }
  
  return (
    <div class="container-default py-12">
      {/* Header */}
      <div class="mb-8">
        <h1 class="heading-1 mb-2">Branding Configuration</h1>
        <p class="body-text">Configure platform-wide branding settings including logos, colors, and site information.</p>
      </div>
      
      {/* Success message */}
      {success && (
        <div class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
          Branding configuration saved successfully!
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main form */}
        <div class="lg:col-span-2 space-y-6">
          {/* Site Name */}
          <div class="card p-6">
            <label class="block text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">
              Site Name
            </label>
            <input
              type="text"
              value={siteName}
              onInput={(e) => setSiteName((e.target as HTMLInputElement).value)}
              class="input-default w-full"
              placeholder="OneConsortium"
            />
            <p class="text-xs text-surface-500 mt-1">Displayed in the header and browser title</p>
          </div>
          
          {/* Logo */}
          <div class="card p-6">
            <label class="block text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
              Logo (Light Mode)
            </label>
            <div class="flex items-start gap-4">
              <div class="w-32 h-32 rounded-lg border-2 border-dashed border-surface-300 dark:border-surface-600 flex items-center justify-center bg-white dark:bg-surface-800">
                {logoUrl && !uploadingLogo ? (
                  <img
                    key={logoUrl}
                    src={logoUrl}
                    alt="Logo"
                    class="w-full h-full object-contain rounded-lg"
                    onError={(e) => {
                      console.error('[Branding] Logo image failed to load:', logoUrl);
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                    onLoad={() => {
                      console.log('[Branding] Logo image loaded successfully:', logoUrl);
                    }}
                  />
                ) : uploadingLogo ? (
                  <span class="i-lucide-loader-2 animate-spin text-2xl text-primary-500"></span>
                ) : (
                  <span class="i-lucide-image text-2xl text-surface-400"></span>
                )}
              </div>
              <div class="flex-1 space-y-2">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  class="btn-secondary text-sm"
                  disabled={uploadingLogo}
                >
                  <span class="i-lucide-upload mr-1"></span>
                  {logoUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
                <p class="text-xs text-surface-500">Recommended: SVG or PNG, square aspect ratio</p>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/svg+xml,image/webp,.svg"
                onChange={(e) => {
                  const target = e.target as HTMLInputElement;
                  const file = target.files?.[0];
                  if (file) {
                    console.log('[Branding] File selected:', file.name, file.type, file.size);
                    handleLogoUpload(file, false);
                  }
                  // Reset input so same file can be selected again
                  target.value = '';
                }}
                class="hidden"
              />
            </div>
          </div>
          
          {/* Dark Mode Logo */}
          <div class="card p-6">
            <label class="block text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
              Logo (Dark Mode) <span class="text-surface-400 font-normal">(Optional)</span>
            </label>
            <div class="flex items-start gap-4">
              <div class="w-32 h-32 rounded-lg border-2 border-dashed border-surface-300 dark:border-surface-600 flex items-center justify-center bg-surface-900">
                {logoDarkUrl && !uploadingLogoDark ? (
                  <img
                    key={logoDarkUrl}
                    src={logoDarkUrl}
                    alt="Dark Logo"
                    class="w-full h-full object-contain rounded-lg"
                    onError={(e) => {
                      console.error('[Branding] Dark logo image failed to load:', logoDarkUrl);
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                    onLoad={() => {
                      console.log('[Branding] Dark logo image loaded successfully:', logoDarkUrl);
                    }}
                  />
                ) : uploadingLogoDark ? (
                  <span class="i-lucide-loader-2 animate-spin text-2xl text-primary-500"></span>
                ) : (
                  <span class="i-lucide-image text-2xl text-surface-400"></span>
                )}
              </div>
              <div class="flex-1 space-y-2">
                <button
                  type="button"
                  onClick={() => logoDarkInputRef.current?.click()}
                  class="btn-secondary text-sm"
                  disabled={uploadingLogoDark}
                >
                  <span class="i-lucide-upload mr-1"></span>
                  {logoDarkUrl ? 'Change Logo' : 'Upload Logo'}
                </button>
                <p class="text-xs text-surface-500">Optional: Different logo for dark mode</p>
              </div>
              <input
                ref={logoDarkInputRef}
                type="file"
                accept="image/jpeg,image/png,image/svg+xml,image/webp,.svg"
                onChange={(e) => {
                  const target = e.target as HTMLInputElement;
                  const file = target.files?.[0];
                  if (file) {
                    console.log('[Branding] Dark logo file selected:', file.name, file.type, file.size);
                    handleLogoUpload(file, true);
                  }
                  // Reset input so same file can be selected again
                  target.value = '';
                }}
                class="hidden"
              />
            </div>
          </div>
          
          {/* Favicon */}
          <div class="card p-6">
            <label class="block text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
              Favicon <span class="text-surface-400 font-normal">(Optional)</span>
            </label>
            <div class="flex items-start gap-4">
              <div class="w-16 h-16 rounded-lg border-2 border-dashed border-surface-300 dark:border-surface-600 flex items-center justify-center bg-white dark:bg-surface-800">
                {faviconUrl && !uploadingFavicon ? (
                  <img
                    key={faviconUrl}
                    src={faviconUrl}
                    alt="Favicon"
                    class="w-full h-full object-contain rounded-lg"
                    onError={(e) => {
                      console.error('[Branding] Favicon image failed to load:', faviconUrl);
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                    onLoad={() => {
                      console.log('[Branding] Favicon image loaded successfully:', faviconUrl);
                    }}
                  />
                ) : uploadingFavicon ? (
                  <span class="i-lucide-loader-2 animate-spin text-xl text-primary-500"></span>
                ) : (
                  <span class="i-lucide-image text-xl text-surface-400"></span>
                )}
              </div>
              <div class="flex-1 space-y-2">
                <button
                  type="button"
                  onClick={() => faviconInputRef.current?.click()}
                  class="btn-secondary text-sm"
                  disabled={uploadingFavicon}
                >
                  <span class="i-lucide-upload mr-1"></span>
                  {faviconUrl ? 'Change Favicon' : 'Upload Favicon'}
                </button>
                <p class="text-xs text-surface-500">Recommended: 32x32px PNG or SVG</p>
              </div>
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.svg,.ico"
                onChange={(e) => {
                  const target = e.target as HTMLInputElement;
                  const file = target.files?.[0];
                  if (file) {
                    console.log('[Branding] Favicon file selected:', file.name, file.type, file.size);
                    handleFaviconUpload(file);
                  }
                  // Reset input so same file can be selected again
                  target.value = '';
                }}
                class="hidden"
              />
            </div>
          </div>
          
          {/* Privacy Policy Link */}
          <div class="card p-6">
            <label class="block text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">
              Privacy Policy URL <span class="text-surface-400 font-normal">(Optional)</span>
            </label>
            <input
              type="url"
              value={privacyPolicyUrl}
              onInput={(e) => setPrivacyPolicyUrl((e.target as HTMLInputElement).value)}
              class="input-default w-full"
              placeholder="https://example.com/privacy"
            />
            <p class="text-xs text-surface-500 mt-1">Link displayed in the footer</p>
          </div>
          
          {/* Colors */}
          <div class="card p-6">
            <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Accent Colors</h3>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Primary Color <span class="text-surface-400 font-normal">(Optional)</span>
                </label>
                <div class="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor || '#000000'}
                    onInput={(e) => setPrimaryColor((e.target as HTMLInputElement).value)}
                    class="w-16 h-10 rounded border border-surface-300 dark:border-surface-600 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onInput={(e) => setPrimaryColor((e.target as HTMLInputElement).value)}
                    class="input-default flex-1"
                    placeholder="#000000"
                  />
                  {primaryColor && (
                    <button
                      type="button"
                      onClick={() => setPrimaryColor('')}
                      class="btn-ghost text-sm text-red-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Accent Color <span class="text-surface-400 font-normal">(Optional)</span>
                </label>
                <div class="flex items-center gap-3">
                  <input
                    type="color"
                    value={accentColor || '#000000'}
                    onInput={(e) => setAccentColor((e.target as HTMLInputElement).value)}
                    class="w-16 h-10 rounded border border-surface-300 dark:border-surface-600 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onInput={(e) => setAccentColor((e.target as HTMLInputElement).value)}
                    class="input-default flex-1"
                    placeholder="#000000"
                  />
                  {accentColor && (
                    <button
                      type="button"
                      onClick={() => setAccentColor('')}
                      class="btn-ghost text-sm text-red-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Save Button */}
          <div class="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleSave}
              class="btn-primary"
              disabled={saving}
            >
              {saving ? (
                <>
                  <span class="i-lucide-loader-2 animate-spin mr-2"></span>
                  Saving...
                </>
              ) : (
                <>
                  <span class="i-lucide-save mr-2"></span>
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Preview sidebar */}
        <div class="lg:col-span-1">
          <div class="card p-6 sticky top-4">
            <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Preview</h3>
            <div class="space-y-4">
              <div>
                <p class="text-xs text-surface-500 mb-2">Site Name</p>
                <p class="font-semibold text-surface-900 dark:text-surface-100">{siteName || 'OneConsortium'}</p>
              </div>
              <div>
                <p class="text-xs text-surface-500 mb-2">Logo</p>
                {logoUrl && (
                  <img
                    key={logoUrl}
                    src={logoUrl}
                    alt="Logo preview"
                    class="h-12 object-contain"
                    onError={(e) => {
                      console.error('[Branding] Preview logo image failed to load:', logoUrl);
                    }}
                  />
                )}
              </div>
              {primaryColor && (
                <div>
                  <p class="text-xs text-surface-500 mb-2">Primary Color</p>
                  <div class="flex items-center gap-2">
                    <div
                      class="w-8 h-8 rounded border border-surface-300 dark:border-surface-600"
                      style={{ backgroundColor: primaryColor }}
                    ></div>
                    <span class="text-sm text-surface-700 dark:text-surface-300">{primaryColor}</span>
                  </div>
                </div>
              )}
              {accentColor && (
                <div>
                  <p class="text-xs text-surface-500 mb-2">Accent Color</p>
                  <div class="flex items-center gap-2">
                    <div
                      class="w-8 h-8 rounded border border-surface-300 dark:border-surface-600"
                      style={{ backgroundColor: accentColor }}
                    ></div>
                    <span class="text-sm text-surface-700 dark:text-surface-300">{accentColor}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
