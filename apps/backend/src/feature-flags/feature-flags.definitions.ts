/**
 * Feature Flag Definitions
 *
 * This file defines all available feature flags with their:
 * - Default values
 * - Types
 * - Descriptions
 * - Environment variable names
 *
 * To add a new feature flag:
 * 1. Add it to the FLAG_DEFINITIONS object below
 * 2. The flag becomes immediately available via FeatureFlagsService
 *
 * Resolution priority: Database > File > Environment > Default
 */

export type FlagType = 'boolean' | 'string' | 'number' | 'json';

export interface FlagDefinition {
  /** Environment variable name (e.g., 'FEATURE_CUSTOM_DOMAINS') */
  envKey: string;
  /** Default value if not set anywhere */
  defaultValue: boolean | string | number | object;
  /** Value type for parsing */
  type: FlagType;
  /** Human-readable description */
  description: string;
  /** Category for grouping in UI */
  category: 'features' | 'limits' | 'integrations' | 'experimental';
  /** Whether this flag is exposed to the UI via the public endpoint (default: false) */
  exposeToClient?: boolean;
}

/**
 * All feature flags defined here.
 * Keys should be SCREAMING_SNAKE_CASE.
 */
export const FLAG_DEFINITIONS: Record<string, FlagDefinition> = {
  // ==========================================================================
  // Storage Provider Flags (for PaaS onboarding)
  // ==========================================================================

  ENABLE_MANAGED_STORAGE: {
    envKey: 'FEATURE_MANAGED_STORAGE',
    defaultValue: false,
    type: 'boolean',
    description:
      'Show "Managed Storage" option that uses platform-provided S3/GCS/Azure credentials.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_BYOB_S3: {
    envKey: 'FEATURE_BYOB_S3',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow users to configure their own S3-compatible storage.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_BYOB_GCS: {
    envKey: 'FEATURE_BYOB_GCS',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow users to configure their own Google Cloud Storage.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_BYOB_AZURE: {
    envKey: 'FEATURE_BYOB_AZURE',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow users to configure their own Azure Blob Storage.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_LOCAL_STORAGE: {
    envKey: 'FEATURE_LOCAL_STORAGE',
    defaultValue: true,
    type: 'boolean',
    description: 'Show local filesystem storage option. Disable for PaaS deployments.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_MINIO_STORAGE: {
    envKey: 'FEATURE_MINIO_STORAGE',
    defaultValue: true,
    type: 'boolean',
    description: 'Show MinIO storage option. Disable for PaaS deployments.',
    category: 'features',
    exposeToClient: true,
  },

  // ==========================================================================
  // Cache/Redis Flags (for PaaS onboarding)
  // ==========================================================================

  ENABLE_LRU_CACHE: {
    envKey: 'FEATURE_LRU_CACHE',
    defaultValue: true,
    type: 'boolean',
    description: 'Show in-memory LRU cache option.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_MANAGED_REDIS: {
    envKey: 'FEATURE_MANAGED_REDIS',
    defaultValue: false,
    type: 'boolean',
    description: 'Show "Managed Redis" option that uses platform-provided shared Redis.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_LOCAL_REDIS: {
    envKey: 'FEATURE_LOCAL_REDIS',
    defaultValue: true,
    type: 'boolean',
    description: 'Show local Docker Redis option. Disable for PaaS deployments.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_EXTERNAL_REDIS: {
    envKey: 'FEATURE_EXTERNAL_REDIS',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow users to configure their own external Redis.',
    category: 'features',
    exposeToClient: true,
  },

  SKIP_CACHE_STEP: {
    envKey: 'FEATURE_SKIP_CACHE_STEP',
    defaultValue: false,
    type: 'boolean',
    description: 'Auto-configure cache with default and skip the cache step in setup wizard.',
    category: 'features',
    exposeToClient: true,
  },

  DEFAULT_CACHE_TYPE: {
    envKey: 'FEATURE_DEFAULT_CACHE_TYPE',
    defaultValue: 'memory',
    type: 'string',
    description:
      'Default cache type when SKIP_CACHE_STEP is true. Values: memory, managed, external.',
    category: 'features',
    exposeToClient: true,
  },

  // ==========================================================================
  // Email Provider Flags (for PaaS onboarding)
  // ==========================================================================

  ENABLE_MANAGED_EMAIL: {
    envKey: 'FEATURE_MANAGED_EMAIL',
    defaultValue: false,
    type: 'boolean',
    description: 'Show "Managed Email" option that uses platform-provided email service.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_SMTP: {
    envKey: 'FEATURE_SMTP',
    defaultValue: true,
    type: 'boolean',
    description: 'Show SMTP email provider option.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_SENDGRID: {
    envKey: 'FEATURE_SENDGRID',
    defaultValue: true,
    type: 'boolean',
    description: 'Show SendGrid email provider option.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_RESEND: {
    envKey: 'FEATURE_RESEND',
    defaultValue: true,
    type: 'boolean',
    description: 'Show Resend email provider option.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_SKIP_EMAIL: {
    envKey: 'FEATURE_SKIP_EMAIL',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow skipping email configuration during setup.',
    category: 'features',
    exposeToClient: true,
  },

  SKIP_EMAIL_STEP: {
    envKey: 'FEATURE_SKIP_EMAIL_STEP',
    defaultValue: false,
    type: 'boolean',
    description: 'Auto-configure email with default and skip the email step in setup wizard.',
    category: 'features',
    exposeToClient: true,
  },

  DEFAULT_EMAIL_TYPE: {
    envKey: 'FEATURE_DEFAULT_EMAIL_TYPE',
    defaultValue: '',
    type: 'string',
    description:
      'Default email provider when SKIP_EMAIL_STEP is true. Values: managed, smtp, sendgrid, resend, skip.',
    category: 'features',
    exposeToClient: true,
  },

  // ==========================================================================
  // UI Display Flags
  // ==========================================================================

  ENABLE_ENV_OPTIMIZATION_HINTS: {
    envKey: 'FEATURE_ENV_OPTIMIZATION_HINTS',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show .env optimization hints on setup completion. Disable for PaaS where users cannot edit server config.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_SETTINGS_UPDATE_NOTE: {
    envKey: 'FEATURE_SETTINGS_UPDATE_NOTE',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show "settings can be updated later" note. Disable if settings changes are restricted.',
    category: 'features',
    exposeToClient: true,
  },

  // ==========================================================================
  // Feature Toggles
  // ==========================================================================

  ENABLE_CUSTOM_DOMAINS: {
    envKey: 'FEATURE_CUSTOM_DOMAINS',
    defaultValue: true,
    type: 'boolean',
    description:
      'Allow users to configure custom domains. Disable for PaaS where SSL is managed externally (Traefik).',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_SSL_MANAGEMENT: {
    envKey: 'FEATURE_SSL_MANAGEMENT',
    defaultValue: true,
    type: 'boolean',
    description: "Enable automatic SSL certificate provisioning via Let's Encrypt",
    category: 'features',
  },

  ENABLE_WILDCARD_SSL: {
    envKey: 'FEATURE_WILDCARD_SSL',
    defaultValue: true,
    type: 'boolean',
    description:
      'Allow users to configure wildcard SSL certificates. Disable when PaaS handles SSL at edge (Traefik).',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_DNS_SETUP_INSTRUCTIONS: {
    envKey: 'FEATURE_DNS_SETUP_INSTRUCTIONS',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show DNS setup instructions for wildcard subdomains. Disable when PaaS manages DNS/routing.',
    category: 'features',
    exposeToClient: true,
  },

  PROXY_MODE: {
    envKey: 'PROXY_MODE',
    defaultValue: 'none',
    type: 'string',
    description:
      'Proxy mode for SSL termination. Values: none (nginx handles SSL), cloudflare (Cloudflare proxy with origin certs), cloudflare-tunnel (Cloudflare Tunnel handles SSL).',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_DOMAIN_SSL_TOGGLE: {
    envKey: 'FEATURE_DOMAIN_SSL_TOGGLE',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show SSL toggle in domain mapping form. Disable when PaaS handles SSL at edge (Traefik).',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_WILDCARD_SSL_BANNER: {
    envKey: 'FEATURE_WILDCARD_SSL_BANNER',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show wildcard SSL setup banner on dashboard for self-hosted users who have not configured wildcard certificates.',
    category: 'features',
    exposeToClient: true,
  },

  ENABLE_API_KEYS: {
    envKey: 'FEATURE_API_KEYS',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow users to create API keys for CI/CD integrations',
    category: 'features',
  },

  ENABLE_USER_REGISTRATION: {
    envKey: 'FEATURE_USER_REGISTRATION',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow new users to register accounts',
    category: 'features',
  },

  ENABLE_PROJECT_SHARING: {
    envKey: 'FEATURE_PROJECT_SHARING',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow projects to be shared between users/groups',
    category: 'features',
  },

  ENABLE_PROXY_RULES: {
    envKey: 'FEATURE_PROXY_RULES',
    defaultValue: true,
    type: 'boolean',
    description: 'Allow configuration of proxy rules for assets',
    category: 'features',
  },

  ENABLE_EMAIL_VERIFICATION: {
    envKey: 'FEATURE_EMAIL_VERIFICATION',
    defaultValue: false,
    type: 'boolean',
    description:
      'Require users to verify their email address after signup before accessing workspace features.',
    category: 'features',
    exposeToClient: true,
  },

  REQUIRE_TOS_ACCEPTANCE: {
    envKey: 'FEATURE_REQUIRE_TOS',
    defaultValue: false,
    type: 'boolean',
    description:
      'Require users to accept Terms of Service during signup. Enable for hosted platform, disable for self-hosted.',
    category: 'features',
    exposeToClient: true,
  },

  TOS_URL: {
    envKey: 'FEATURE_TOS_URL',
    defaultValue: '',
    type: 'string',
    description:
      'URL to Terms of Service page. Used when REQUIRE_TOS_ACCEPTANCE is enabled.',
    category: 'features',
    exposeToClient: true,
  },

  // ==========================================================================
  // Resource Limits (for PaaS tiers)
  // ==========================================================================

  MAX_PROJECTS: {
    envKey: 'LIMIT_MAX_PROJECTS',
    defaultValue: 0, // 0 = unlimited
    type: 'number',
    description: 'Maximum number of projects per workspace (0 = unlimited)',
    category: 'limits',
  },

  MAX_DEPLOYMENTS_PER_PROJECT: {
    envKey: 'LIMIT_MAX_DEPLOYMENTS',
    defaultValue: 0, // 0 = unlimited
    type: 'number',
    description: 'Maximum deployments retained per project (0 = unlimited)',
    category: 'limits',
  },

  MAX_STORAGE_GB: {
    envKey: 'LIMIT_MAX_STORAGE_GB',
    defaultValue: 0, // 0 = unlimited
    type: 'number',
    description: 'Maximum storage in GB (0 = unlimited)',
    category: 'limits',
  },

  MAX_CUSTOM_DOMAINS: {
    envKey: 'LIMIT_MAX_CUSTOM_DOMAINS',
    defaultValue: 0, // 0 = unlimited
    type: 'number',
    description: 'Maximum custom domains per workspace (0 = unlimited)',
    category: 'limits',
  },

  MAX_USERS: {
    envKey: 'LIMIT_MAX_USERS',
    defaultValue: 0, // 0 = unlimited
    type: 'number',
    description: 'Maximum users per workspace (0 = unlimited)',
    category: 'limits',
  },

  // ==========================================================================
  // Integrations
  // ==========================================================================

  ENABLE_GITHUB_INTEGRATION: {
    envKey: 'FEATURE_GITHUB_INTEGRATION',
    defaultValue: true,
    type: 'boolean',
    description: 'Enable GitHub webhook and action integrations',
    category: 'integrations',
  },

  ENABLE_GITLAB_INTEGRATION: {
    envKey: 'FEATURE_GITLAB_INTEGRATION',
    defaultValue: false,
    type: 'boolean',
    description: 'Enable GitLab CI integration',
    category: 'integrations',
  },

  // ==========================================================================
  // Experimental Features
  // ==========================================================================

  ENABLE_EDGE_FUNCTIONS: {
    envKey: 'FEATURE_EDGE_FUNCTIONS',
    defaultValue: false,
    type: 'boolean',
    description: 'Enable experimental edge function support',
    category: 'experimental',
  },

  ENABLE_ANALYTICS: {
    envKey: 'FEATURE_ANALYTICS',
    defaultValue: false,
    type: 'boolean',
    description: 'Enable traffic analytics dashboard',
    category: 'experimental',
  },
};

/**
 * Get all flag keys
 */
export function getAllFlagKeys(): string[] {
  return Object.keys(FLAG_DEFINITIONS);
}

/**
 * Get flag definition by key
 */
export function getFlagDefinition(key: string): FlagDefinition | undefined {
  return FLAG_DEFINITIONS[key];
}

/**
 * Check if a flag key is valid
 */
export function isValidFlagKey(key: string): boolean {
  return key in FLAG_DEFINITIONS;
}

/**
 * Get all flag keys that are exposed to clients (UI)
 */
export function getClientExposedFlagKeys(): string[] {
  return Object.entries(FLAG_DEFINITIONS)
    .filter(([, def]) => def.exposeToClient === true)
    .map(([key]) => key);
}
