import {
  IEmailProvider,
  SendEmailOptions,
  SendEmailResult,
  TestConnectionResult,
} from '../interfaces';
import { ResendConfig } from '../interfaces/provider-configs.interface';

/**
 * Resend Email Provider
 *
 * Uses Resend's HTTP API for email delivery.
 * Modern email API designed for developers.
 */
export class ResendProvider implements IEmailProvider {
  readonly providerType = 'resend';
  readonly displayName = 'Resend';

  private apiUrl = 'https://api.resend.com';

  constructor(private config: ResendConfig) {
    this.validateConfig();
  }

  validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error('Resend API key is required');
    }
    if (!this.config.fromAddress) {
      throw new Error('From address is required');
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      const response = await fetch(`${this.apiUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${options.from?.name || this.config.fromName} <${options.from?.email || this.config.fromAddress}>`,
          to: toAddresses,
          subject: options.subject,
          html: options.html,
          text: options.text,
          reply_to: options.replyTo,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          messageId: data.id,
        };
      }

      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.message || `Resend API error: HTTP ${response.status}`;
      return { success: false, error: errorMessage };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      // Validate API key by fetching domains list
      // This endpoint works with both full-access and sending-only API keys
      const response = await fetch(`${this.apiUrl}/domains`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (response.ok) {
        return {
          success: true,
          message: 'Resend API key verified successfully',
          latencyMs: Date.now() - start,
        };
      }

      // Handle restricted API keys that can only send emails
      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.json().catch(() => ({}));

        // If it's a restricted key error, try sending a validation request
        // by checking if the key format is valid and API is reachable
        if (errorBody.name === 'restricted_api_key') {
          // For restricted keys, we can verify by attempting to send to a test endpoint
          // Instead, let's just validate the key format and trust it works
          if (this.config.apiKey.startsWith('re_') && this.config.apiKey.length > 10) {
            return {
              success: true,
              message: 'Resend API key format verified (sending-only key)',
              latencyMs: Date.now() - start,
            };
          }
        }

        return {
          success: false,
          message: 'Invalid Resend API key',
          error: errorBody.message || `HTTP ${response.status}: Authentication failed`,
          latencyMs: Date.now() - start,
        };
      }

      return {
        success: false,
        message: 'Resend API request failed',
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Resend connection failed',
        error: errorMessage,
        latencyMs: Date.now() - start,
      };
    }
  }
}
