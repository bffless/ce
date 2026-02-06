import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { systemConfig } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { EmailService } from '../email/email.service';
import {
  EmailProviderType,
  EMAIL_PROVIDER_METADATA,
} from '../email/interfaces/provider-configs.interface';

export interface EmailStatusResponse {
  isConfigured: boolean;
  provider?: string;
  providerName?: string;
  fromAddress?: string;
  fromName?: string;
  // Provider-specific masked fields
  apiKey?: string; // Masked
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string; // Masked
}

export interface UpdateEmailDto {
  provider: EmailProviderType;
  config: Record<string, unknown>;
}

export interface TestEmailResponse {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
}

export interface SendTestEmailResponse {
  success: boolean;
  message: string;
  error?: string;
  messageId?: string;
}

@Injectable()
export class EmailSettingsService {
  private readonly logger = new Logger(EmailSettingsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private configService: ConfigService,
    private emailService: EmailService,
  ) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  /**
   * Get email configuration status (without sensitive data)
   */
  async getEmailStatus(): Promise<EmailStatusResponse> {
    try {
      const config = await this.getSystemConfig();

      // Check new email provider fields first
      if (config?.emailConfigured && config?.emailProvider && config?.emailConfig) {
        const emailConfig = JSON.parse(this.decryptData(config.emailConfig));
        const providerMeta = EMAIL_PROVIDER_METADATA[config.emailProvider as EmailProviderType];

        const response: EmailStatusResponse = {
          isConfigured: true,
          provider: config.emailProvider,
          providerName: providerMeta?.name || config.emailProvider,
          fromAddress: emailConfig.fromAddress,
          fromName: emailConfig.fromName,
        };

        // Add provider-specific masked fields
        switch (config.emailProvider) {
          case 'smtp':
            response.host = emailConfig.host;
            response.port = emailConfig.port;
            response.secure = emailConfig.secure;
            response.user = emailConfig.user ? this.maskString(emailConfig.user) : undefined;
            break;
          case 'sendgrid':
          case 'resend':
            response.apiKey = emailConfig.apiKey ? this.maskApiKey(emailConfig.apiKey) : undefined;
            break;
          case 'ses':
            response.apiKey = emailConfig.accessKeyId
              ? this.maskApiKey(emailConfig.accessKeyId)
              : undefined;
            break;
          case 'mailgun':
            response.apiKey = emailConfig.apiKey ? this.maskApiKey(emailConfig.apiKey) : undefined;
            break;
          case 'postmark':
            response.apiKey = emailConfig.serverToken
              ? this.maskApiKey(emailConfig.serverToken)
              : undefined;
            break;
        }

        return response;
      }

      // Fallback to legacy SMTP config
      if (config?.smtpConfigured && config?.smtpConfig) {
        const smtpConfig = JSON.parse(this.decryptData(config.smtpConfig));
        return {
          isConfigured: true,
          provider: 'smtp',
          providerName: 'SMTP',
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          user: smtpConfig.user ? this.maskString(smtpConfig.user) : undefined,
          fromAddress: smtpConfig.fromAddress,
          fromName: smtpConfig.fromName,
        };
      }

      return { isConfigured: false };
    } catch (error) {
      this.logger.error('Error getting email status:', error);
      return { isConfigured: false };
    }
  }

  /**
   * Update email provider configuration
   */
  async updateEmail(dto: UpdateEmailDto): Promise<EmailStatusResponse> {
    try {
      const encryptedConfig = this.encryptData(JSON.stringify(dto.config));

      const config = await this.getSystemConfig();
      if (!config) {
        throw new InternalServerErrorException('System configuration not found');
      }

      await db
        .update(systemConfig)
        .set({
          emailProvider: dto.provider,
          emailConfig: encryptedConfig,
          emailConfigured: true,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, config.id));

      // Re-configure email service with new config
      this.emailService.configure(dto.provider, dto.config);

      this.logger.log(`Email configuration updated to provider: ${dto.provider}`);

      return this.getEmailStatus();
    } catch (error) {
      this.logger.error('Error updating email:', error);
      throw new InternalServerErrorException('Failed to update email configuration');
    }
  }

  /**
   * Test email connection
   */
  async testEmailConnection(): Promise<TestEmailResponse> {
    try {
      const result = await this.emailService.testConnection();

      return {
        success: result.success,
        message: result.message,
        error: result.error,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      this.logger.error('Email connection test failed:', error);
      return {
        success: false,
        message: 'Email connection test failed',
        error: error.message,
      };
    }
  }

  /**
   * Initialize email service from stored database configuration
   * Called on application startup to restore email configuration
   */
  async initializeFromDatabase(): Promise<void> {
    try {
      const config = await this.getSystemConfig();

      // Check new email provider fields first
      if (config?.emailConfigured && config?.emailProvider && config?.emailConfig) {
        const emailConfig = JSON.parse(this.decryptData(config.emailConfig));
        this.emailService.configure(config.emailProvider as EmailProviderType, emailConfig);
        this.logger.log(`Email service initialized with provider: ${config.emailProvider}`);
        return;
      }

      // Fallback to legacy SMTP config
      if (config?.smtpConfigured && config?.smtpConfig) {
        const smtpConfig = JSON.parse(this.decryptData(config.smtpConfig));
        this.emailService.configure('smtp', smtpConfig);
        this.logger.log('Email service initialized with legacy SMTP configuration');
        return;
      }

      this.logger.log('No email configuration found in database');
    } catch (error) {
      this.logger.error('Failed to initialize email service from database:', error);
    }
  }

  /**
   * Send a test email to verify email delivery works end-to-end
   */
  async sendTestEmail(to: string): Promise<SendTestEmailResponse> {
    try {
      if (!this.emailService.isConfigured()) {
        return {
          success: false,
          message: 'Email is not configured',
          error: 'Please configure an email provider before sending test emails',
        };
      }

      const providerName = this.emailService.getProviderDisplayName() || 'Email';

      const result = await this.emailService.sendEmail({
        to,
        subject: 'Test Email from Asset Host',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Test Email Successful!</h2>
            <p>This is a test email from your Asset Host platform.</p>
            <p>If you're receiving this email, your <strong>${providerName}</strong> configuration is working correctly.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #666; font-size: 14px;">
              Sent at: ${new Date().toISOString()}<br />
              Provider: ${providerName}
            </p>
          </div>
        `,
        text: `Test Email Successful!\n\nThis is a test email from your Asset Host platform.\n\nIf you're receiving this email, your ${providerName} configuration is working correctly.\n\nSent at: ${new Date().toISOString()}\nProvider: ${providerName}`,
      });

      if (result.success) {
        this.logger.log(`Test email sent successfully to ${to}`);
        return {
          success: true,
          message: `Test email sent successfully to ${to}`,
          messageId: result.messageId,
        };
      }

      this.logger.error(`Failed to send test email to ${to}: ${result.error}`);
      return {
        success: false,
        message: 'Failed to send test email',
        error: result.error,
      };
    } catch (error) {
      this.logger.error('Error sending test email:', error);
      return {
        success: false,
        message: 'Error sending test email',
        error: error.message,
      };
    }
  }

  private async getSystemConfig() {
    const configs = await db.select().from(systemConfig).limit(1);
    return configs.length > 0 ? configs[0] : null;
  }

  private maskString(str: string): string {
    if (str.includes('@')) {
      // Email address
      const [localPart, domain] = str.split('@');
      const maskedLocal =
        localPart.length > 2 ? localPart.substring(0, 2) + '***' : localPart + '***';
      return `${maskedLocal}@${domain}`;
    }
    // Generic string
    if (str.length <= 4) return '****';
    return str.substring(0, 2) + '***' + str.substring(str.length - 2);
  }

  private maskApiKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }

  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
