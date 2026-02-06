/**
 * Email Provider Abstraction Layer
 *
 * Defines the interface for email delivery providers, enabling
 * pluggable architecture for SMTP, SendGrid, AWS SES, and other providers.
 */

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: {
    name: string;
    email: string;
  };
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
}

export interface IEmailProvider {
  /**
   * Unique identifier for the provider (e.g., 'smtp', 'sendgrid', 'ses')
   */
  readonly providerType: string;

  /**
   * Human-readable provider name (e.g., 'SMTP', 'SendGrid', 'Amazon SES')
   */
  readonly displayName: string;

  /**
   * Send an email using this provider
   */
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;

  /**
   * Test the provider connection/configuration
   */
  testConnection(): Promise<TestConnectionResult>;

  /**
   * Validate provider-specific configuration
   * Throws an error if configuration is invalid
   */
  validateConfig(): void;
}
