import { IEmailProvider } from '../interfaces';
import {
  EmailProviderType,
  SmtpConfig,
  SendGridConfig,
  ResendConfig,
} from '../interfaces/provider-configs.interface';
import { SmtpProvider } from './smtp.provider';
import { SendGridProvider } from './sendgrid.provider';
import { ResendProvider } from './resend.provider';

export { SmtpProvider } from './smtp.provider';
export { SendGridProvider } from './sendgrid.provider';
export { ResendProvider } from './resend.provider';

/**
 * Get managed email configuration from environment variables
 * Returns null if managed email is not configured
 */
function getManagedEmailConfig(): { provider: EmailProviderType; config: Record<string, unknown> } | null {
  const provider = process.env.MANAGED_EMAIL_PROVIDER as EmailProviderType;
  const apiKey = process.env.MANAGED_EMAIL_API_KEY;
  const fromAddress = process.env.MANAGED_EMAIL_FROM_ADDRESS || process.env.MANAGED_EMAIL_FROM;
  const fromName = process.env.MANAGED_EMAIL_FROM_NAME || 'Platform';

  if (!provider || !apiKey || !fromAddress) {
    return null;
  }

  // Build config based on the underlying provider type
  switch (provider) {
    case 'resend':
    case 'sendgrid':
      return {
        provider,
        config: {
          apiKey,
          fromAddress,
          fromName,
        },
      };
    case 'smtp':
      return {
        provider,
        config: {
          host: process.env.MANAGED_EMAIL_SMTP_HOST,
          port: parseInt(process.env.MANAGED_EMAIL_SMTP_PORT || '587', 10),
          secure: process.env.MANAGED_EMAIL_SMTP_SECURE === 'true',
          user: process.env.MANAGED_EMAIL_SMTP_USER,
          password: apiKey, // Use API key as password for SMTP
          fromAddress,
          fromName,
        },
      };
    default:
      return null;
  }
}

/**
 * Email Provider Factory
 *
 * Creates email provider instances based on provider type and configuration.
 * This factory pattern enables dynamic provider selection at runtime.
 */
export function createEmailProvider(
  providerType: EmailProviderType,
  config: Record<string, unknown>,
): IEmailProvider {
  switch (providerType) {
    case 'smtp':
      return new SmtpProvider(config as unknown as SmtpConfig);

    case 'sendgrid':
      return new SendGridProvider(config as unknown as SendGridConfig);

    case 'resend':
      return new ResendProvider(config as unknown as ResendConfig);

    case 'managed': {
      // Managed email uses platform-provided credentials from env vars
      const managedConfig = getManagedEmailConfig();
      if (!managedConfig) {
        throw new Error(
          'Managed email is not configured. Set MANAGED_EMAIL_PROVIDER, MANAGED_EMAIL_API_KEY, and MANAGED_EMAIL_FROM_ADDRESS environment variables.',
        );
      }
      // Recursively create the underlying provider
      return createEmailProvider(managedConfig.provider, managedConfig.config);
    }

    case 'ses':
      // AWS SES provider - can be added later
      throw new Error('AWS SES provider is not yet implemented. Please use SendGrid or Resend.');

    case 'mailgun':
      // Mailgun provider - can be added later
      throw new Error('Mailgun provider is not yet implemented. Please use SendGrid or Resend.');

    case 'postmark':
      // Postmark provider - can be added later
      throw new Error('Postmark provider is not yet implemented. Please use SendGrid or Resend.');

    default:
      throw new Error(`Unknown email provider: ${providerType}`);
  }
}

/**
 * Get list of currently implemented providers
 */
export function getImplementedProviders(): EmailProviderType[] {
  return ['smtp', 'resend', 'sendgrid', 'managed'];
}

/**
 * Check if a provider is implemented
 */
export function isProviderImplemented(providerType: EmailProviderType): boolean {
  return getImplementedProviders().includes(providerType);
}
