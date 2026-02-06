/**
 * Provider-Specific Configuration Types
 *
 * Each email provider has its own configuration requirements.
 * These interfaces define the shape of configuration for each provider.
 */

// Base configuration shared by all providers
export interface BaseEmailConfig {
  fromName: string;
  fromAddress: string;
}

// SMTP Configuration (traditional email servers)
export interface SmtpConfig extends BaseEmailConfig {
  host: string;
  port: number;
  secure: boolean; // true for SSL (465), false for STARTTLS (587)
  user?: string;
  password?: string;
}

// SendGrid Configuration (HTTP API)
export interface SendGridConfig extends BaseEmailConfig {
  apiKey: string;
}

// AWS SES Configuration
export interface AwsSesConfig extends BaseEmailConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Mailgun Configuration
export interface MailgunConfig extends BaseEmailConfig {
  apiKey: string;
  domain: string;
  region?: 'us' | 'eu'; // API endpoint region
}

// Resend Configuration
export interface ResendConfig extends BaseEmailConfig {
  apiKey: string;
}

// Postmark Configuration
export interface PostmarkConfig extends BaseEmailConfig {
  serverToken: string;
}

// Managed Email Configuration (platform-provided credentials from env vars)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ManagedEmailConfig {}

// Union type for all provider configurations
export type EmailProviderConfig =
  | { provider: 'smtp'; config: SmtpConfig }
  | { provider: 'sendgrid'; config: SendGridConfig }
  | { provider: 'ses'; config: AwsSesConfig }
  | { provider: 'mailgun'; config: MailgunConfig }
  | { provider: 'resend'; config: ResendConfig }
  | { provider: 'postmark'; config: PostmarkConfig }
  | { provider: 'managed'; config: ManagedEmailConfig };

// Email provider type enum
export type EmailProviderType = 'smtp' | 'sendgrid' | 'ses' | 'mailgun' | 'resend' | 'postmark' | 'managed';

// Provider metadata for UI display
export interface EmailProviderMetadata {
  id: EmailProviderType;
  name: string;
  description: string;
  requiresPorts: boolean;
  fields: string[];
  docsUrl?: string;
  warning?: string;
  recommended?: boolean;
}

// Provider metadata registry
export const EMAIL_PROVIDER_METADATA: Record<EmailProviderType, EmailProviderMetadata> = {
  smtp: {
    id: 'smtp',
    name: 'SMTP',
    description: 'Traditional SMTP server (Gmail, Outlook, etc.)',
    requiresPorts: true,
    fields: ['host', 'port', 'secure', 'user', 'password', 'fromName', 'fromAddress'],
    warning:
      'Many cloud providers (DigitalOcean, AWS, GCP) block outbound SMTP ports by default. If connection tests fail, consider using an HTTP-based provider.',
  },
  sendgrid: {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Twilio SendGrid email API',
    requiresPorts: false,
    fields: ['apiKey', 'fromName', 'fromAddress'],
    docsUrl: 'https://docs.sendgrid.com/api-reference/api-keys/create-api-keys',
    recommended: false,
  },
  ses: {
    id: 'ses',
    name: 'Amazon SES',
    description: 'AWS Simple Email Service',
    requiresPorts: false,
    fields: ['region', 'accessKeyId', 'secretAccessKey', 'fromName', 'fromAddress'],
    docsUrl: 'https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html',
  },
  mailgun: {
    id: 'mailgun',
    name: 'Mailgun',
    description: 'Mailgun email API',
    requiresPorts: false,
    fields: ['apiKey', 'domain', 'region', 'fromName', 'fromAddress'],
    docsUrl: 'https://documentation.mailgun.com/en/latest/api-intro.html',
  },
  resend: {
    id: 'resend',
    name: 'Resend',
    description: 'Resend email API for developers',
    requiresPorts: false,
    fields: ['apiKey', 'fromName', 'fromAddress'],
    docsUrl: 'https://resend.com/docs/api-reference/api-keys',
    recommended: true,
  },
  postmark: {
    id: 'postmark',
    name: 'Postmark',
    description: 'Postmark transactional email',
    requiresPorts: false,
    fields: ['serverToken', 'fromName', 'fromAddress'],
    docsUrl: 'https://postmarkapp.com/developer/api/overview',
  },
  managed: {
    id: 'managed',
    name: 'Platform Managed',
    description: 'Platform-provided email service with automatic configuration',
    requiresPorts: false,
    fields: [], // No user-configurable fields - uses platform env vars
    recommended: true,
  },
};
