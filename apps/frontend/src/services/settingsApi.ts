import { api } from './api';

export interface PrimaryContentConfig {
  enabled: boolean;
  projectId: string | null;
  projectOwner?: string;
  projectName?: string;
  alias: string | null;
  path: string | null;
  wwwEnabled: boolean;
  wwwBehavior: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
  isSpa: boolean;
  updatedAt: string;
  // When using the unified domain mapping system, this will be set
  domainMappingId?: string;
}

export interface UpdatePrimaryContentDto {
  enabled?: boolean;
  projectId?: string | null;
  alias?: string | null;
  path?: string | null;
  wwwEnabled?: boolean;
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
  isSpa?: boolean;
}

export interface ProjectForPrimaryContent {
  id: string;
  owner: string;
  name: string;
  aliases: string[];
}

export interface UpdatePrimaryContentResponse {
  success: boolean;
  config: PrimaryContentConfig;
  message: string;
}

// SMTP Configuration types (legacy)
export interface SmtpStatus {
  isConfigured: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  fromAddress?: string;
  fromName?: string;
}

export interface UpdateSmtpDto {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  password: string;
  fromAddress?: string;
  fromName?: string;
}

export interface TestSmtpResponse {
  success: boolean;
  message: string;
  error?: string;
}

// =============================================================================
// Email Settings Types (New - Multi-Provider Support)
// =============================================================================

export type SettingsEmailProvider =
  | 'managed'
  | 'smtp'
  | 'sendgrid'
  | 'ses'
  | 'mailgun'
  | 'resend'
  | 'postmark';

export interface EmailStatus {
  isConfigured: boolean;
  provider?: string;
  providerName?: string;
  fromAddress?: string;
  fromName?: string;
  // Provider-specific masked fields
  apiKey?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
}

export interface UpdateEmailSettingsDto {
  provider: SettingsEmailProvider;
  config: Record<string, unknown>;
}

export interface TestEmailSettingsResponse {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
}

export interface SendTestEmailDto {
  to: string;
}

export interface SendTestEmailResponse {
  success: boolean;
  message: string;
  error?: string;
  messageId?: string;
}

// =============================================================================
// Branding Types
// =============================================================================

export interface BrandingConfig {
  siteName: string;
  headerLogoKey: string | null;
  authLogoKey: string | null;
}

export interface PublicBrandingConfig {
  siteName: string;
  hasHeaderLogo: boolean;
  hasAuthLogo: boolean;
}

export interface UpdateBrandingDto {
  siteName?: string;
}

// =============================================================================
// OAuth Settings Types
// =============================================================================

export interface OAuthSettingsResponse {
  google: { enabled: boolean; configured: boolean };
}

export interface UpdateGoogleOAuthDto {
  enabled: boolean;
}

export interface UpdateGoogleOAuthResponse {
  success: boolean;
  google: { enabled: boolean };
}

// ─── Email/password sign-in master switch ───────────────────────────────────
// `canDisable` is true only once an admin has signed in via OIDC — the lockout
// safeguard that keeps an OIDC-misconfig from locking everyone out.
export interface EmailPasswordAuthStatus {
  enabled: boolean;
  canDisable: boolean;
}

export interface UpdateEmailPasswordAuthDto {
  enabled: boolean;
}

export interface UpdateEmailPasswordAuthResponse {
  success: boolean;
  enabled: boolean;
}

// Workspace-level Google integration credentials, per service. Distinct
// from sign-in (env vars) — see backend GoogleIntegrationCredentialsService.
// Story 0048: one row per Google API surface (calendar today, future
// drive/sheets/gmail). The admin UI currently only renders calendar.
export type GoogleService = 'calendar' | 'drive' | 'sheets' | 'gmail';

export interface GoogleIntegrationStatus {
  service: GoogleService;
  isConfigured: boolean;
  clientIdMasked?: string;
  hasSecret?: boolean;
}

export interface UpdateGoogleIntegrationDto {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export interface UpdateBrandingResponse {
  success: boolean;
  config: BrandingConfig;
}

// ─── remote connections (Admin Settings → Infrastructure) ─────────────────
// Mirrors the backend's RemoteConnectionsService types. The credential is
// write-only: the API only ever reports whether one is stored
// (`hasCredential` + `source.credential`), never its value.
export type RemoteConnectionAuth = 'google_id_token' | 'none';
/** Which layer supplied a field: the DB row, or a REMOTE_CONNECTION_<NAME>_* env var. */
export type RemoteConnectionFieldSource = 'db' | 'env';

export interface RemoteConnectionStatus {
  /** null for an env-only connection (no DB row → nothing to edit or delete). */
  id: string | null;
  name: string;
  url: string;
  /** A free string on the wire: an instance can carry an auth mode this build doesn't know. */
  auth: RemoteConnectionAuth | string;
  hasCredential: boolean;
  maxInflight: number;
  healthPath: string | null;
  source: {
    url: RemoteConnectionFieldSource;
    auth: RemoteConnectionFieldSource;
    /** null when there is no credential at all — nothing to attribute. */
    credential: RemoteConnectionFieldSource | null;
    maxInflight: RemoteConnectionFieldSource;
    healthPath: RemoteConnectionFieldSource;
    envOnly: boolean;
  };
  envOnly: boolean;
  usedBy: { ffmpegExecutor: boolean; rules: number };
}

/**
 * Partial update. The backend refuses any env-pinned field that is PRESENT in
 * the body, so only ever send the fields that actually changed.
 */
export interface UpsertRemoteConnectionDto {
  name?: string;
  url?: string;
  auth?: RemoteConnectionAuth;
  /** undefined = keep the stored credential, null = clear it, string = replace it */
  credential?: string | null;
  maxInflight?: number;
  healthPath?: string | null;
}

/** The unsaved admin form a "Test connection" runs against. */
export interface RemoteConnectionTestDraft {
  /** Fall back to this stored connection for anything the draft omits (esp. the credential). */
  id?: string;
  name?: string;
  url?: string;
  auth?: RemoteConnectionAuth;
  credential?: string | null;
  healthPath?: string | null;
}

export interface RemoteConnectionTestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  version?: string;
  error?: string;
  credential: 'sa_key' | 'adc' | 'none';
}

/** GET /api/remote-connections — any authenticated user, for rule authoring. */
export interface RemoteConnectionName {
  name: string;
  auth: string;
}

// ─── ffmpeg executor settings (Server video ops → Executor) ───────────────
// Mirrors the backend's FfmpegExecutorSettingsService types. Since Plan 4 the
// executor no longer owns a URL/auth/key: it points at a remote connection,
// which is where those live (and where they are edited).
export type FfmpegExecutorName = 'local' | 'remote';

export interface FfmpegExecutorStatus {
  localAvailable: boolean;
  localVersion: string | null;
  localEnabled: boolean;
  remoteEnabled: boolean;
  /** The connection the Remote executor calls, or null when none is selected/resolvable. */
  remoteConnection: {
    id: string | null;
    name: string;
    url: string;
    auth: string;
    hasCredential: boolean;
    credentialSource: 'db' | 'env' | null;
    envOnly: boolean;
  } | null;
  /** The connection dropdown's options. */
  connections: { id: string | null; name: string; auth: string; envOnly: boolean }[];
  defaultExecutor: FfmpegExecutorName;
  storagePresignable: boolean;
  envManaged: { defaultExecutor: boolean; remoteConnection: boolean };
}

export interface UpdateFfmpegExecutorDto {
  localEnabled?: boolean;
  remoteEnabled?: boolean;
  /** A remote connection NAME (undefined = keep, null = clear). */
  remoteConnection?: string | null;
  defaultExecutor?: FfmpegExecutorName;
}

export interface FfmpegExecutorTestDraft {
  remoteConnection?: string;
}

export interface FfmpegExecutorTestResult {
  ok: boolean;
  latencyMs: number | null;
  worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
  error?: string;
  readiness: { ok: boolean; reason?: string };
  credential: 'sa_key' | 'adc' | 'none';
}

// ─── SSO provider types (story 0047) ─────────────────────────────────────────

export type SsoProviderKind = 'google' | 'okta' | 'azure-ad' | 'oidc';

/** Public/admin-readable shape — credentials masked. Mirrors backend's `OidcProviderStatus`. */
export interface SsoProviderStatus {
  id: string;
  providerId: string;
  displayName: string;
  kind: SsoProviderKind;
  enabled: boolean;
  source: 'admin' | 'env';
  clientIdMasked: string | null;
  hasSecret: boolean;
  oktaDomain: string | null;
  directoryId: string | null;
  oidcDiscoveryEndpoint: string | null;
  scope: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface SsoProviderConfig {
  clientId: string;
  clientSecret: string;
  oidcDiscoveryEndpoint?: string; // kind='oidc'
  oktaDomain?: string; // kind='okta'
  directoryId?: string; // kind='azure-ad'
  scope?: string[];
}

export interface CreateSsoProviderDto {
  providerId: string;
  displayName: string;
  kind: SsoProviderKind;
  config: SsoProviderConfig;
  enabled?: boolean;
}

export interface UpdateSsoProviderDto {
  displayName?: string;
  enabled?: boolean;
  config?: Partial<SsoProviderConfig>;
}

export interface TestSsoProviderResponse {
  ok: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  error?: string;
}

export interface TelemetryStatus {
  enabled: boolean;
  forcedOffByEnv: boolean;
  lastSentAt: string | null;
}

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Install telemetry status
    getTelemetryStatus: builder.query<TelemetryStatus, void>({
      query: () => '/api/settings/telemetry',
      providesTags: ['Telemetry'],
    }),

    // Enable/disable install telemetry
    updateTelemetry: builder.mutation<TelemetryStatus, { enabled: boolean }>({
      query: (body) => ({
        url: '/api/settings/telemetry',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Telemetry'],
    }),

    // Get primary content configuration
    getPrimaryContent: builder.query<PrimaryContentConfig, void>({
      query: () => '/api/settings/primary-content',
      providesTags: ['PrimaryContent'],
    }),

    // Update primary content configuration
    updatePrimaryContent: builder.mutation<UpdatePrimaryContentResponse, UpdatePrimaryContentDto>({
      query: (body) => ({
        url: '/api/settings/primary-content',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['PrimaryContent'],
    }),

    // Get available projects for primary content
    getPrimaryContentProjects: builder.query<{ projects: ProjectForPrimaryContent[] }, void>({
      query: () => '/api/settings/primary-content/projects',
      providesTags: ['Project'],
    }),

    // SMTP Settings

    // Get SMTP configuration status
    getSmtpStatus: builder.query<SmtpStatus, void>({
      query: () => '/api/settings/smtp',
      providesTags: ['SmtpSettings'],
    }),

    // Update SMTP configuration
    updateSmtp: builder.mutation<SmtpStatus, UpdateSmtpDto>({
      query: (body) => ({
        url: '/api/settings/smtp',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['SmtpSettings'],
    }),

    // Test SMTP connection (settings - requires auth)
    testSmtpSettings: builder.mutation<TestSmtpResponse, void>({
      query: () => ({
        url: '/api/settings/smtp/test',
        method: 'POST',
      }),
    }),

    // ==========================================================================
    // Email Settings Endpoints (New - Multi-Provider Support)
    // ==========================================================================

    // Get email configuration status
    getEmailStatus: builder.query<EmailStatus, void>({
      query: () => '/api/settings/email',
      providesTags: ['EmailSettings'],
    }),

    // Update email configuration
    updateEmailSettings: builder.mutation<EmailStatus, UpdateEmailSettingsDto>({
      query: (body) => ({
        url: '/api/settings/email',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['EmailSettings'],
    }),

    // Clear email configuration (revert to console-log fallback)
    clearEmailSettings: builder.mutation<EmailStatus, void>({
      query: () => ({
        url: '/api/settings/email',
        method: 'DELETE',
      }),
      invalidatesTags: ['EmailSettings'],
    }),

    // Test email connection (settings - requires auth)
    testEmailSettings: builder.mutation<TestEmailSettingsResponse, void>({
      query: () => ({
        url: '/api/settings/email/test',
        method: 'POST',
      }),
    }),

    // Send a test email to verify delivery
    sendTestEmail: builder.mutation<SendTestEmailResponse, SendTestEmailDto>({
      query: (body) => ({
        url: '/api/settings/email/send-test',
        method: 'POST',
        body,
      }),
    }),

    // ==========================================================================
    // Branding Settings Endpoints
    // ==========================================================================

    // Get public branding (no auth required)
    getPublicBranding: builder.query<PublicBrandingConfig, void>({
      query: () => '/api/settings/branding/public',
      providesTags: ['Branding'],
    }),

    // Get full branding config (admin only)
    getBranding: builder.query<BrandingConfig, void>({
      query: () => '/api/settings/branding',
      providesTags: ['Branding'],
    }),

    // Update branding config (admin only)
    updateBranding: builder.mutation<UpdateBrandingResponse, UpdateBrandingDto>({
      query: (body) => ({
        url: '/api/settings/branding',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Branding'],
    }),

    // Upload branding logo (admin only)
    uploadBrandingLogo: builder.mutation<UpdateBrandingResponse, { type: string; file: File }>({
      query: ({ type, file }) => {
        const formData = new FormData();
        formData.append('file', file);
        return {
          url: `/api/settings/branding/logo/${type}`,
          method: 'POST',
          body: formData,
        };
      },
      invalidatesTags: ['Branding'],
    }),

    // Delete branding logo (admin only)
    deleteBrandingLogo: builder.mutation<UpdateBrandingResponse, { type: string }>({
      query: ({ type }) => ({
        url: `/api/settings/branding/logo/${type}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Branding'],
    }),

    // ==========================================================================
    // OAuth Settings Endpoints
    // ==========================================================================

    getOAuthSettings: builder.query<OAuthSettingsResponse, void>({
      query: () => '/api/settings/oauth',
      providesTags: ['OAuthSettings'],
    }),

    updateGoogleOAuth: builder.mutation<UpdateGoogleOAuthResponse, UpdateGoogleOAuthDto>({
      query: (body) => ({
        url: '/api/settings/oauth/google',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['OAuthSettings', 'FeatureFlags'],
    }),

    // Email/password master switch (enable/disable built-in sign-in).
    getEmailPasswordAuth: builder.query<EmailPasswordAuthStatus, void>({
      query: () => '/api/settings/auth/email-password',
      providesTags: ['FeatureFlags'],
    }),

    updateEmailPasswordAuth: builder.mutation<
      UpdateEmailPasswordAuthResponse,
      UpdateEmailPasswordAuthDto
    >({
      query: (body) => ({
        url: '/api/settings/auth/email-password',
        method: 'PATCH',
        body,
      }),
      // FeatureFlags so the status refetches; OAuthSettings so any login-method
      // probes refresh too.
      invalidatesTags: ['FeatureFlags', 'OAuthSettings'],
    }),

    // ==========================================================================
    // Google integration credentials, per service (workspace-level)
    // Story 0048: replaces the single /oauth/google/integration endpoint with
    // per-service routes so future Drive/Sheets/Gmail can have distinct
    // Cloud projects. Backend: GoogleIntegrationCredentialsService.
    // ==========================================================================

    listGoogleIntegrations: builder.query<GoogleIntegrationStatus[], void>({
      query: () => '/api/settings/google-integrations',
      providesTags: ['OAuthSettings'],
    }),

    getGoogleIntegration: builder.query<GoogleIntegrationStatus, { service: GoogleService }>({
      query: ({ service }) => `/api/settings/google-integrations/${service}`,
      providesTags: ['OAuthSettings'],
    }),

    updateGoogleIntegration: builder.mutation<
      GoogleIntegrationStatus,
      { service: GoogleService; body: UpdateGoogleIntegrationDto }
    >({
      query: ({ service, body }) => ({
        url: `/api/settings/google-integrations/${service}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['OAuthSettings', 'Integration'],
    }),

    deleteGoogleIntegration: builder.mutation<GoogleIntegrationStatus, { service: GoogleService }>({
      query: ({ service }) => ({
        url: `/api/settings/google-integrations/${service}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['OAuthSettings', 'Integration'],
    }),

    // ─── ffmpeg executor (Admin Settings → Features → Server video ops) ────
    // Backend: FfmpegExecutorSettingsController (PipelinesModule). The test
    // mutation runs against the *unsaved* draft, so it deliberately has no tags.
    getFfmpegExecutorSettings: builder.query<FfmpegExecutorStatus, void>({
      query: () => '/api/settings/ffmpeg-executor',
      providesTags: ['FfmpegExecutor'],
    }),

    updateFfmpegExecutorSettings: builder.mutation<FfmpegExecutorStatus, UpdateFfmpegExecutorDto>({
      query: (body) => ({ url: '/api/settings/ffmpeg-executor', method: 'PUT', body }),
      invalidatesTags: ['FfmpegExecutor'],
    }),

    testFfmpegExecutorConnection: builder.mutation<
      FfmpegExecutorTestResult,
      FfmpegExecutorTestDraft
    >({
      query: (body) => ({ url: '/api/settings/ffmpeg-executor/test', method: 'POST', body }),
    }),

    // ─── remote connections (Admin Settings → Infrastructure) ──────────────
    // Backend: RemoteConnectionsController. Mutations also invalidate
    // 'FfmpegExecutor' because the executor status embeds the connection it
    // points at (URL, auth, hasCredential) and its dropdown options.
    listRemoteConnections: builder.query<RemoteConnectionStatus[], void>({
      query: () => '/api/settings/remote-connections',
      providesTags: ['RemoteConnection'],
    }),

    createRemoteConnection: builder.mutation<RemoteConnectionStatus, UpsertRemoteConnectionDto>({
      query: (body) => ({ url: '/api/settings/remote-connections', method: 'POST', body }),
      invalidatesTags: ['RemoteConnection', 'FfmpegExecutor'],
    }),

    updateRemoteConnection: builder.mutation<
      RemoteConnectionStatus,
      { id: string; body: UpsertRemoteConnectionDto }
    >({
      query: ({ id, body }) => ({
        url: `/api/settings/remote-connections/${encodeURIComponent(id)}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['RemoteConnection', 'FfmpegExecutor'],
    }),

    deleteRemoteConnection: builder.mutation<void, { id: string }>({
      query: ({ id }) => ({
        url: `/api/settings/remote-connections/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['RemoteConnection', 'FfmpegExecutor'],
    }),

    // Runs against the *unsaved* draft, so it deliberately has no tags.
    testRemoteConnection: builder.mutation<RemoteConnectionTestResult, RemoteConnectionTestDraft>({
      query: (body) => ({ url: '/api/settings/remote-connections/test', method: 'POST', body }),
    }),

    // Any authenticated user (rule authors naming a connection in a
    // `remote_request` step) — name + auth only, no URL or credential.
    listRemoteConnectionNames: builder.query<RemoteConnectionName[], void>({
      query: () => '/api/remote-connections',
      providesTags: ['RemoteConnection'],
    }),

    // ─── SSO providers (story 0047) ─────────────────────────────────────────
    // CRUD over the `oidc_providers` table. Each mutation also triggers
    // backend syncOidcProviders() server-side, so the new buttons appear on
    // /login without a backend restart. Tag: 'SsoProvider' so the providers
    // list refetches after every mutation, and so /oauth/providers (consumed
    // by Login/Signup pages) refetches via 'OAuthSettings'.
    listSsoProviders: builder.query<SsoProviderStatus[], void>({
      query: () => '/api/settings/sso/providers',
      providesTags: ['SsoProvider'],
    }),

    getSsoProvider: builder.query<SsoProviderStatus, { id: string }>({
      query: ({ id }) => `/api/settings/sso/providers/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, { id }) => [{ type: 'SsoProvider', id }],
    }),

    createSsoProvider: builder.mutation<SsoProviderStatus, CreateSsoProviderDto>({
      query: (body) => ({
        url: '/api/settings/sso/providers',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['SsoProvider', 'OAuthSettings'],
    }),

    updateSsoProvider: builder.mutation<
      SsoProviderStatus,
      { id: string; body: UpdateSsoProviderDto }
    >({
      query: ({ id, body }) => ({
        url: `/api/settings/sso/providers/${encodeURIComponent(id)}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['SsoProvider', 'OAuthSettings'],
    }),

    deleteSsoProvider: builder.mutation<{ success: boolean }, { id: string }>({
      query: ({ id }) => ({
        url: `/api/settings/sso/providers/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['SsoProvider', 'OAuthSettings'],
    }),

    testSsoProvider: builder.mutation<TestSsoProviderResponse, { id: string }>({
      query: ({ id }) => ({
        url: `/api/settings/sso/providers/${encodeURIComponent(id)}/test`,
        method: 'POST',
      }),
    }),
  }),
});

export const {
  // Install telemetry hooks
  useGetTelemetryStatusQuery,
  useUpdateTelemetryMutation,
  useGetPrimaryContentQuery,
  useUpdatePrimaryContentMutation,
  useGetPrimaryContentProjectsQuery,
  // Legacy SMTP hooks
  useGetSmtpStatusQuery,
  useUpdateSmtpMutation,
  useTestSmtpSettingsMutation,
  // New email settings hooks
  useGetEmailStatusQuery,
  useUpdateEmailSettingsMutation,
  useClearEmailSettingsMutation,
  useTestEmailSettingsMutation,
  useSendTestEmailMutation,
  // Branding hooks
  useGetPublicBrandingQuery,
  useGetBrandingQuery,
  useUpdateBrandingMutation,
  useUploadBrandingLogoMutation,
  useDeleteBrandingLogoMutation,
  // OAuth settings hooks
  useGetOAuthSettingsQuery,
  useUpdateGoogleOAuthMutation,
  // Email/password master switch hooks
  useGetEmailPasswordAuthQuery,
  useUpdateEmailPasswordAuthMutation,
  // Google integration credentials (per service) — story 0048
  useListGoogleIntegrationsQuery,
  useGetGoogleIntegrationQuery,
  useUpdateGoogleIntegrationMutation,
  useDeleteGoogleIntegrationMutation,
  // ffmpeg executor hooks (Server video ops → Executor)
  useGetFfmpegExecutorSettingsQuery,
  useUpdateFfmpegExecutorSettingsMutation,
  useTestFfmpegExecutorConnectionMutation,
  // Remote connection hooks (Infrastructure → Remote connections)
  useListRemoteConnectionsQuery,
  useCreateRemoteConnectionMutation,
  useUpdateRemoteConnectionMutation,
  useDeleteRemoteConnectionMutation,
  useTestRemoteConnectionMutation,
  useListRemoteConnectionNamesQuery,
  // SSO provider hooks (story 0047)
  useListSsoProvidersQuery,
  useGetSsoProviderQuery,
  useCreateSsoProviderMutation,
  useUpdateSsoProviderMutation,
  useDeleteSsoProviderMutation,
  useTestSsoProviderMutation,
} = settingsApi;
