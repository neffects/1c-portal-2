/**
 * Application configuration types
 */

/**
 * Application configuration loaded on startup
 * Location: config/app.json
 */
export interface AppConfig {
  /** Application version */
  version: string;
  /** Environment (development/staging/production) */
  environment: 'development' | 'staging' | 'production';
  /** API base URL */
  apiBaseUrl: string;
  /** R2 public CDN URL */
  r2PublicUrl: string;
  /** Feature flags */
  features: FeatureFlags;
  /** Branding configuration */
  branding: BrandingConfig;
  /** Sync configuration */
  sync: SyncConfig;
  /** Authentication configuration */
  auth: AuthConfig;
}

/**
 * Feature flags for enabling/disabling functionality
 */
export interface FeatureFlags {
  /** Enable entity alert/flag system */
  alerts: boolean;
  /** Enable local persistence / offline mode */
  offlineMode: boolean;
  /** Enable real-time collaborative editing (Phase 2) */
  realtime: boolean;
  /** Enable dark mode toggle */
  darkMode: boolean;
}

/**
 * Branding configuration for the platform
 */
export interface BrandingConfig {
  /** Root organization ID */
  rootOrgId: string;
  /** Site name displayed in header/title */
  siteName: string;
  /** Default theme */
  defaultTheme: 'light' | 'dark';
  /** Main logo URL */
  logoUrl: string;
  /** Logo for dark theme */
  logoDarkUrl?: string;
  /** Favicon URL */
  faviconUrl?: string;
  /** Primary brand color */
  primaryColor?: string;
  /** Accent color */
  accentColor?: string;
}

/**
 * Client sync configuration
 */
export interface SyncConfig {
  /** How often to check for bundle updates (ms) */
  bundleRefreshInterval: number;
  /** Time before data considered stale (ms) */
  staleTime: number;
  /** Garbage collection time for old cache (ms) */
  gcTime: number;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Magic link validity period (seconds) */
  magicLinkExpiry: number;
  /** JWT session duration (seconds) */
  sessionDuration: number;
  /** Enable email domain restrictions */
  domainRestrictions: boolean;
}

/**
 * Root configuration file
 * Location: secret/ROOT.json
 */
export interface RootConfig {
  /** Root organization ID */
  rootOrganizationId: string;
  /** When the platform was initialized (ISO 8601) */
  initializedAt: string;
  /** Platform admin email */
  adminEmail: string;
}

/**
 * API error response
 */
export interface ApiError {
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * API success response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
