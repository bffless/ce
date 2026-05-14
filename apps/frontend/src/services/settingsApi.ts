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

export type SettingsEmailProvider = 'managed' | 'smtp' | 'sendgrid' | 'ses' | 'mailgun' | 'resend' | 'postmark';

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

// DEPRECATED — legacy alias kept so callers updated incrementally still
// compile. Identical to GoogleIntegrationStatus minus `service`. Removed
// in story 0050.
export interface GoogleOAuthIntegrationStatus {
  isConfigured: boolean;
  clientIdMasked?: string;
  hasSecret?: boolean;
}

export interface UpdateGoogleOAuthIntegrationDto {
  clientId: string;
  clientSecret: string;
}

export interface UpdateBrandingResponse {
  success: boolean;
  config: BrandingConfig;
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

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Get primary content configuration
    getPrimaryContent: builder.query<PrimaryContentConfig, void>({
      query: () => '/api/settings/primary-content',
      providesTags: ['PrimaryContent'],
    }),

    // Update primary content configuration
    updatePrimaryContent: builder.mutation<
      UpdatePrimaryContentResponse,
      UpdatePrimaryContentDto
    >({
      query: (body) => ({
        url: '/api/settings/primary-content',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['PrimaryContent'],
    }),

    // Get available projects for primary content
    getPrimaryContentProjects: builder.query<
      { projects: ProjectForPrimaryContent[] },
      void
    >({
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

    deleteGoogleIntegration: builder.mutation<
      GoogleIntegrationStatus,
      { service: GoogleService }
    >({
      query: ({ service }) => ({
        url: `/api/settings/google-integrations/${service}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['OAuthSettings', 'Integration'],
    }),

    // ─── Legacy hooks (forwarded to service='calendar') ─────────────────────
    // Kept so any in-flight code paths keep working through the deprecation
    // window. Removed in story 0050 alongside the backend route aliases.
    getGoogleOAuthIntegration: builder.query<GoogleOAuthIntegrationStatus, void>({
      query: () => '/api/settings/google-integrations/calendar',
      providesTags: ['OAuthSettings'],
      transformResponse: (response: GoogleIntegrationStatus): GoogleOAuthIntegrationStatus => ({
        isConfigured: response.isConfigured,
        clientIdMasked: response.clientIdMasked,
        hasSecret: response.hasSecret,
      }),
    }),

    updateGoogleOAuthIntegration: builder.mutation<
      GoogleOAuthIntegrationStatus,
      UpdateGoogleOAuthIntegrationDto
    >({
      query: (body) => ({
        url: '/api/settings/google-integrations/calendar',
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['OAuthSettings', 'Integration'],
      transformResponse: (response: GoogleIntegrationStatus): GoogleOAuthIntegrationStatus => ({
        isConfigured: response.isConfigured,
        clientIdMasked: response.clientIdMasked,
        hasSecret: response.hasSecret,
      }),
    }),

    deleteGoogleOAuthIntegration: builder.mutation<GoogleOAuthIntegrationStatus, void>({
      query: () => ({
        url: '/api/settings/google-integrations/calendar',
        method: 'DELETE',
      }),
      invalidatesTags: ['OAuthSettings', 'Integration'],
      transformResponse: (response: GoogleIntegrationStatus): GoogleOAuthIntegrationStatus => ({
        isConfigured: response.isConfigured,
        clientIdMasked: response.clientIdMasked,
        hasSecret: response.hasSecret,
      }),
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

    updateSsoProvider: builder.mutation<SsoProviderStatus, { id: string; body: UpdateSsoProviderDto }>({
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
  // Google integration credentials (per service) — story 0048
  useListGoogleIntegrationsQuery,
  useGetGoogleIntegrationQuery,
  useUpdateGoogleIntegrationMutation,
  useDeleteGoogleIntegrationMutation,
  // Legacy hooks — service='calendar' shims, removed in story 0050
  useGetGoogleOAuthIntegrationQuery,
  useUpdateGoogleOAuthIntegrationMutation,
  useDeleteGoogleOAuthIntegrationMutation,
  // SSO provider hooks (story 0047)
  useListSsoProvidersQuery,
  useGetSsoProviderQuery,
  useCreateSsoProviderMutation,
  useUpdateSsoProviderMutation,
  useDeleteSsoProviderMutation,
  useTestSsoProviderMutation,
} = settingsApi;