import { api } from './api';

// Storage provider types matching backend
export type StorageProvider = 'local' | 'minio' | 's3' | 'gcs' | 'azure' | 'managed';

// Status response
export interface SetupStatusResponse {
  isSetupComplete: boolean;
  storageProvider?: string;
  hasAdminUser?: boolean;
  emailConfigured?: boolean;
  emailProvider?: string;
  smtpConfigured?: boolean; // Legacy, use emailConfigured
}

// Initialize (create admin user)
export interface InitializeRequest {
  email: string;
  password: string;
  token?: string; // Onboarding token for secure workspace setup
}

export interface InitializeResponse {
  message: string;
  userId: string;
  email: string;
}

// Storage configuration types
export interface LocalStorageConfig {
  localPath: string;
}

export interface MinIOStorageConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL?: boolean;
  port?: number;
}

export interface S3StorageConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  presignedUrlExpiration?: number;
}

export interface GcsCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface GCSStorageConfig {
  projectId: string;
  bucket: string;
  keyFilename?: string;
  credentials?: GcsCredentials;
  storageClass?: 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE';
  signedUrlExpiration?: number;
  useApplicationDefaultCredentials?: boolean;
}

export interface AzureStorageConfig {
  accountName: string;
  containerName: string;
  accountKey?: string;
  connectionString?: string;
  useManagedIdentity?: boolean;
  managedIdentityClientId?: string;
  accessTier?: 'Hot' | 'Cool' | 'Archive';
  sasUrlExpiration?: number;
  endpoint?: string;
}

// Managed storage uses platform-provided credentials (no user config needed)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ManagedStorageConfig {}

export type StorageConfig =
  | LocalStorageConfig
  | MinIOStorageConfig
  | S3StorageConfig
  | GCSStorageConfig
  | AzureStorageConfig
  | ManagedStorageConfig;

export interface ConfigureStorageRequest {
  storageProvider: StorageProvider;
  config: StorageConfig;
}

export interface StorageConfigResponse {
  message: string;
  storageProvider: string;
}

export interface TestStorageResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Complete setup
export interface CompleteSetupRequest {
  confirm: boolean;
}

export interface CompleteSetupResponse {
  message: string;
  isSetupComplete: boolean;
}

// Environment-based storage config (non-sensitive info)
export interface EnvStorageConfigResponse {
  isConfigured: boolean;
  storageProvider?: string;
  endpoint?: string;
  port?: number;
  bucket?: string;
  useSSL?: boolean;
  localPath?: string;
}

// Current storage config (non-sensitive info from database)
export interface CurrentStorageConfigResponse {
  isConfigured: boolean;
  storageProvider?: string;
  endpoint?: string;
  port?: number;
  bucket?: string;
  containerName?: string;
  region?: string;
  useSSL?: boolean;
  localPath?: string;
  projectId?: string;
  accountName?: string;
  isS3Compatible?: boolean;
  storageClass?: string;
  accessTier?: string;
}

// SMTP configuration types
export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  password: string;
  fromAddress?: string;
  fromName?: string;
}

export interface ConfigureSmtpRequest {
  config: SmtpConfig;
}

export interface SmtpConfigResponse {
  message: string;
  smtpConfigured: boolean;
}

export interface TestSmtpResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface EnvSmtpConfigResponse {
  isConfigured: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  fromAddress?: string;
  fromName?: string;
}

// =============================================================================
// Email Provider Types (New - Multi-Provider Support)
// =============================================================================

export type EmailProvider = 'smtp' | 'sendgrid' | 'ses' | 'mailgun' | 'resend' | 'postmark' | 'managed';

export interface EmailProviderInfo {
  id: EmailProvider;
  name: string;
  description: string;
  requiresPorts: boolean;
  fields: string[];
  docsUrl?: string;
  warning?: string;
  recommended?: boolean;
  implemented?: boolean;
}

export interface GetEmailProvidersResponse {
  providers: EmailProviderInfo[];
}

// Provider-specific config types
export interface SmtpEmailConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
}

export interface SendGridEmailConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

export interface ResendEmailConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

export interface AwsSesEmailConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromAddress: string;
  fromName?: string;
}

export interface MailgunEmailConfig {
  apiKey: string;
  domain: string;
  region?: 'us' | 'eu';
  fromAddress: string;
  fromName?: string;
}

export interface PostmarkEmailConfig {
  serverToken: string;
  fromAddress: string;
  fromName?: string;
}

// Managed email uses platform-provided credentials (no user config needed)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ManagedEmailConfig {}

export type EmailConfig =
  | SmtpEmailConfig
  | SendGridEmailConfig
  | ResendEmailConfig
  | AwsSesEmailConfig
  | MailgunEmailConfig
  | PostmarkEmailConfig
  | ManagedEmailConfig;

export interface ConfigureEmailRequest {
  provider: EmailProvider;
  config: EmailConfig;
}

export interface ConfigureEmailResponse {
  message: string;
  provider: string;
  emailConfigured: boolean;
}

export interface TestEmailResponse {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
}

// =============================================================================
// Cache Configuration Types
// =============================================================================

export interface CacheConfig {
  enabled: boolean;
  type: 'memory' | 'redis';
  redisSource?: 'local' | 'external' | 'managed';
  defaultTtl?: number;
  maxSizeMb?: number;
  maxFileSizeMb?: number;
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
}

export interface CacheConfigResponse {
  enabled: boolean;
  type: 'memory' | 'redis';
  redisSource?: 'local' | 'external' | 'managed';
  defaultTtl?: number;
  maxSizeMb?: number;
  maxFileSizeMb?: number;
  redisHost?: string;
  redisPort?: number;
  isConfigured: boolean;
}

export interface TestRedisConnectionRequest {
  host: string;
  port: number;
  password?: string;
  db?: number;
  useLocalPassword?: boolean; // Use REDIS_PASSWORD from server env for local Docker Redis
  useManagedConfig?: boolean; // Use MANAGED_REDIS_* from server env for platform-managed Redis
}

export interface TestRedisConnectionResponse {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface RedisDefaultsResponse {
  host: string;
  port: number;
  isDocker: boolean;
}

export interface CacheStatsResponse {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  itemCount: number;
  formattedSize: string;
}

export interface ClearCacheResponse {
  success: boolean;
  clearedItems: number;
}

export interface SaveCacheConfigResponse {
  success: boolean;
  message: string;
}

// =============================================================================
// Registration Settings Types
// =============================================================================

export interface RegistrationSettingsResponse {
  registrationEnabled: boolean;
  allowPublicSignups: boolean;
}

export interface UpdateAllowPublicSignupsRequest {
  allowPublicSignups: boolean;
}

export interface UpdateAllowPublicSignupsResponse {
  message: string;
  allowPublicSignups: boolean;
}

// =============================================================================
// Service Constraints Types (Optional Services)
// =============================================================================

export interface ServiceConstraint {
  enabled: boolean;
  reason: string | null;
}

export interface ServiceConstraintsResponse {
  minio: ServiceConstraint;
  redis: ServiceConstraint;
}

// =============================================================================
// Available Options Types (Feature Flag Based)
// =============================================================================

export interface StorageOptionsDto {
  managed: boolean;
  s3: boolean;
  gcs: boolean;
  azure: boolean;
  local: boolean;
  minio: boolean;
}

export interface CacheOptionsDto {
  lru: boolean;
  managedRedis: boolean;
  localRedis: boolean;
  externalRedis: boolean;
  skipStep: boolean;
  defaultType: string;
}

export interface EmailOptionsDto {
  managed: boolean;
  smtp: boolean;
  sendgrid: boolean;
  resend: boolean;
  skipAllowed: boolean;
  skipStep: boolean;
  defaultType: string;
}

export interface UIOptionsDto {
  enableEnvOptimizationHints: boolean;
  enableSettingsUpdateNote: boolean;
}

export interface AvailableOptionsResponse {
  storage: StorageOptionsDto;
  cache: CacheOptionsDto;
  email: EmailOptionsDto;
  ui: UIOptionsDto;
}

export type CacheType = 'memory' | 'redis' | 'managed';

// =============================================================================
// Existing User Adoption Types (for PaaS multi-workspace support)
// =============================================================================

export interface CheckEmailRequest {
  email: string;
}

export interface CheckEmailResponse {
  existsInAuth: boolean;
  existsInWorkspace: boolean;
  canAdopt: boolean;
  message?: string;
}

export interface AdoptExistingUserRequest {
  email: string;
  password: string;
  token?: string; // Onboarding token for secure workspace setup
}

export interface AdoptExistingUserResponse {
  message: string;
  userId: string;
  email: string;
}

export interface AdoptSessionUserRequest {
  token?: string; // Onboarding token for secure workspace setup
}

export interface AdoptSessionUserResponse {
  message: string;
  userId: string;
  email: string;
}

// API Endpoints
export const setupApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Check if setup is complete
    getSetupStatus: builder.query<SetupStatusResponse, void>({
      query: () => '/api/setup/status',
      providesTags: ['Setup'],
    }),

    // Get service constraints (ENABLE_* env vars)
    getConstraints: builder.query<ServiceConstraintsResponse, void>({
      query: () => '/api/setup/constraints',
    }),

    // Get available options based on feature flags
    getAvailableOptions: builder.query<AvailableOptionsResponse, void>({
      query: () => '/api/setup/available-options',
    }),

    // Create admin user (initialize)
    initialize: builder.mutation<InitializeResponse, InitializeRequest>({
      query: (body) => ({
        url: '/api/setup/initialize',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Check if email exists in auth system (for existing user adoption)
    checkEmail: builder.mutation<CheckEmailResponse, CheckEmailRequest>({
      query: (body) => ({
        url: '/api/setup/check-email',
        method: 'POST',
        body,
      }),
    }),

    // Adopt existing SuperTokens user as admin for this workspace
    adoptExistingUser: builder.mutation<AdoptExistingUserResponse, AdoptExistingUserRequest>({
      query: (body) => ({
        url: '/api/setup/adopt-existing-user',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Adopt current session user as admin (no password required)
    adoptSessionUser: builder.mutation<AdoptSessionUserResponse, AdoptSessionUserRequest>({
      query: (body) => ({
        url: '/api/setup/adopt-session-user',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Configure storage provider
    configureStorage: builder.mutation<StorageConfigResponse, ConfigureStorageRequest>({
      query: (body) => ({
        url: '/api/setup/storage',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Test storage connection
    testStorage: builder.mutation<TestStorageResponse, void>({
      query: () => ({
        url: '/api/setup/test-storage',
        method: 'POST',
      }),
    }),

    // Get storage config from environment variables
    getEnvStorageConfig: builder.query<EnvStorageConfigResponse, void>({
      query: () => '/api/setup/storage/env-config',
    }),

    // Get current storage config from database (non-sensitive info)
    getCurrentStorageConfig: builder.query<CurrentStorageConfigResponse, void>({
      query: () => '/api/setup/storage/current',
      providesTags: ['Setup'],
    }),

    // Configure storage from environment variables
    configureStorageFromEnv: builder.mutation<StorageConfigResponse, void>({
      query: () => ({
        url: '/api/setup/storage/from-env',
        method: 'POST',
      }),
      invalidatesTags: ['Setup'],
    }),

    // Get SMTP config from environment variables
    getEnvSmtpConfig: builder.query<EnvSmtpConfigResponse, void>({
      query: () => '/api/setup/smtp/env-config',
    }),

    // Configure SMTP from environment variables
    configureSmtpFromEnv: builder.mutation<SmtpConfigResponse, void>({
      query: () => ({
        url: '/api/setup/smtp/from-env',
        method: 'POST',
      }),
      invalidatesTags: ['Setup'],
    }),

    // Configure SMTP with manual settings
    configureSmtp: builder.mutation<SmtpConfigResponse, ConfigureSmtpRequest>({
      query: (body) => ({
        url: '/api/setup/smtp',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Test SMTP connection
    testSmtp: builder.mutation<TestSmtpResponse, void>({
      query: () => ({
        url: '/api/setup/test-smtp',
        method: 'POST',
      }),
    }),

    // ==========================================================================
    // Email Provider Endpoints (New - Multi-Provider Support)
    // ==========================================================================

    // Get available email providers
    getEmailProviders: builder.query<GetEmailProvidersResponse, void>({
      query: () => '/api/setup/email-providers',
    }),

    // Configure email provider
    configureEmail: builder.mutation<ConfigureEmailResponse, ConfigureEmailRequest>({
      query: (body) => ({
        url: '/api/setup/email',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Test email connection
    testEmail: builder.mutation<TestEmailResponse, void>({
      query: () => ({
        url: '/api/setup/test-email',
        method: 'POST',
      }),
    }),

    // ==========================================================================
    // Cache Configuration Endpoints
    // ==========================================================================

    // Get current cache configuration
    getCacheConfig: builder.query<CacheConfigResponse, void>({
      query: () => '/api/setup/cache',
      providesTags: ['Setup'],
    }),

    // Save cache configuration
    saveCacheConfig: builder.mutation<SaveCacheConfigResponse, CacheConfig>({
      query: (config) => ({
        url: '/api/setup/cache',
        method: 'POST',
        body: config,
      }),
      invalidatesTags: ['Setup'],
    }),

    // Get default Redis configuration for environment
    getRedisDefaults: builder.query<RedisDefaultsResponse, void>({
      query: () => '/api/setup/cache/defaults',
    }),

    // Test Redis connection without saving
    testRedisConnection: builder.mutation<TestRedisConnectionResponse, TestRedisConnectionRequest>({
      query: (config) => ({
        url: '/api/setup/cache/test-connection',
        method: 'POST',
        body: config,
      }),
    }),

    // Get cache statistics (admin endpoint)
    getCacheStats: builder.query<CacheStatsResponse, void>({
      query: () => '/api/admin/cache/stats',
    }),

    // Clear all cached data (admin endpoint)
    clearCache: builder.mutation<ClearCacheResponse, void>({
      query: () => ({
        url: '/api/admin/cache/clear',
        method: 'POST',
      }),
    }),

    // Complete setup
    completeSetup: builder.mutation<CompleteSetupResponse, CompleteSetupRequest>({
      query: (body) => ({
        url: '/api/setup/complete',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),

    // ==========================================================================
    // Registration Settings Endpoints
    // ==========================================================================

    // Get registration settings (admin only)
    getRegistrationSettings: builder.query<RegistrationSettingsResponse, void>({
      query: () => '/api/setup/registration',
      providesTags: ['Setup'],
    }),

    // Update allow public signups setting (admin only)
    updateAllowPublicSignups: builder.mutation<UpdateAllowPublicSignupsResponse, UpdateAllowPublicSignupsRequest>({
      query: (body) => ({
        url: '/api/setup/registration/allow-public-signups',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Setup'],
    }),
  }),
});

export const {
  useGetSetupStatusQuery,
  useGetConstraintsQuery,
  useGetAvailableOptionsQuery,
  useInitializeMutation,
  useCheckEmailMutation,
  useAdoptExistingUserMutation,
  useAdoptSessionUserMutation,
  useConfigureStorageMutation,
  useTestStorageMutation,
  useGetEnvStorageConfigQuery,
  useGetCurrentStorageConfigQuery,
  useConfigureStorageFromEnvMutation,
  useGetEnvSmtpConfigQuery,
  useConfigureSmtpFromEnvMutation,
  useConfigureSmtpMutation,
  useTestSmtpMutation,
  // New email provider hooks
  useGetEmailProvidersQuery,
  useConfigureEmailMutation,
  useTestEmailMutation,
  // Cache configuration hooks
  useGetCacheConfigQuery,
  useSaveCacheConfigMutation,
  useGetRedisDefaultsQuery,
  useTestRedisConnectionMutation,
  useGetCacheStatsQuery,
  useClearCacheMutation,
  useCompleteSetupMutation,
  // Registration settings hooks
  useGetRegistrationSettingsQuery,
  useUpdateAllowPublicSignupsMutation,
} = setupApi;
