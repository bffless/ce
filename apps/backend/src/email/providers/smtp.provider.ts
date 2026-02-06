import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  IEmailProvider,
  SendEmailOptions,
  SendEmailResult,
  TestConnectionResult,
} from '../interfaces';
import { SmtpConfig } from '../interfaces/provider-configs.interface';

/**
 * SMTP Email Provider
 *
 * Uses nodemailer to send emails via traditional SMTP servers.
 * Supports Gmail, Outlook, custom mail servers, etc.
 */
export class SmtpProvider implements IEmailProvider {
  readonly providerType = 'smtp';
  readonly displayName = 'SMTP';

  private transporter: Transporter;

  constructor(private config: SmtpConfig) {
    this.validateConfig();
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user && config.password
          ? {
              user: config.user,
              pass: config.password,
            }
          : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
  }

  validateConfig(): void {
    if (!this.config.host) {
      throw new Error('SMTP host is required');
    }
    if (!this.config.port) {
      throw new Error('SMTP port is required');
    }
    if (!this.config.fromAddress) {
      throw new Error('From address is required');
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const result = await this.transporter.sendMail({
        from: `"${options.from?.name || this.config.fromName}" <${options.from?.email || this.config.fromAddress}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      await this.transporter.verify();
      return {
        success: true,
        message: 'SMTP connection verified successfully',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Provide more helpful error messages for common issues
      let friendlyMessage = 'SMTP connection failed';
      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        friendlyMessage = 'Connection timed out. SMTP ports may be blocked by your cloud provider.';
      } else if (errorMessage.includes('ECONNREFUSED')) {
        friendlyMessage = 'Connection refused. Check your host and port settings.';
      } else if (
        errorMessage.includes('Invalid login') ||
        errorMessage.includes('authentication')
      ) {
        friendlyMessage = 'Authentication failed. Check your username and password.';
      }

      return {
        success: false,
        message: friendlyMessage,
        error: errorMessage,
        latencyMs: Date.now() - start,
      };
    }
  }
}
