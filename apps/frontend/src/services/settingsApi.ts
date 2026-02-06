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
} = settingsApi;