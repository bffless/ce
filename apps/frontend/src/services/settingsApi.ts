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

export interface UpdateBrandingResponse {
  success: boolean;
  config: BrandingConfig;
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
} = settingsApi;