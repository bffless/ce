import {
  IEmailProvider,
  SendEmailOptions,
  SendEmailResult,
  TestConnectionResult,
} from '../interfaces';
import { SendGridConfig } from '../interfaces/provider-configs.interface';

/**
 * SendGrid Email Provider
 *
 * Uses SendGrid's HTTP API for email delivery.
 * Bypasses SMTP port restrictions common on cloud providers.
 */
export class SendGridProvider implements IEmailProvider {
  readonly providerType = 'sendgrid';
  readonly displayName = 'SendGrid';

  private apiUrl = 'https://api.sendgrid.com/v3';

  constructor(private config: SendGridConfig) {
    this.validateConfig();
  }

  validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error('SendGrid API key is required');
    }
    if (!this.config.fromAddress) {
      throw new Error('From address is required');
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      const response = await fetch(`${this.apiUrl}/mail/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: toAddresses.map((email) => ({ email })),
            },
          ],
          from: {
            email: options.from?.email || this.config.fromAddress,
            name: options.from?.name || this.config.fromName,
          },
          reply_to: options.replyTo ? { email: options.replyTo } : undefined,
          subject: options.subject,
          content: [
            ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
            ...(options.html ? [{ type: 'text/html', value: options.html }] : []),
          ],
        }),
      });

      if (response.ok || response.status === 202) {
        return {
          success: true,
          messageId: response.headers.get('x-message-id') || undefined,
        };
      }

      const errorBody = await response.json().catch(() => ({}));
      const errorMessage =
        errorBody.errors?.[0]?.message || `SendGrid API error: HTTP ${response.status}`;
      return { success: false, error: errorMessage };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      // Validate API key by checking scopes
      const response = await fetch(`${this.apiUrl}/scopes`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const hasMailSend = data.scopes?.includes('mail.send');

        if (!hasMailSend) {
          return {
            success: false,
            message: 'API key does not have mail.send permission',
            error: 'The API key is valid but lacks the mail.send scope required to send emails.',
            latencyMs: Date.now() - start,
          };
        }

        return {
          success: true,
          message: 'SendGrid API key verified with mail.send permission',
          latencyMs: Date.now() - start,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'Invalid SendGrid API key',
          error: `HTTP ${response.status}: Authentication failed`,
          latencyMs: Date.now() - start,
        };
      }

      return {
        success: false,
        message: 'SendGrid API request failed',
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'SendGrid connection failed',
        error: errorMessage,
        latencyMs: Date.now() - start,
      };
    }
  }
}
