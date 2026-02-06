import { Injectable, Logger } from '@nestjs/common';
import {
  IEmailProvider,
  SendEmailOptions,
  SendEmailResult,
  TestConnectionResult,
} from './interfaces';
import {
  EmailProviderType,
  EMAIL_PROVIDER_METADATA,
  EmailProviderMetadata,
} from './interfaces/provider-configs.interface';
import { createEmailProvider, getImplementedProviders, isProviderImplemented } from './providers';

/**
 * Email Service
 *
 * Central service for managing email provider lifecycle and sending emails.
 * This service is used by SuperTokens for password reset emails and
 * can be used throughout the application for notifications.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private provider: IEmailProvider | null = null;
  private providerType: EmailProviderType | null = null;
  private providerConfig: Record<string, unknown> | null = null;

  /**
   * Configure the email service with a provider
   */
  configure(providerType: EmailProviderType, config: Record<string, unknown>): void {
    this.logger.log(`Configuring email provider: ${providerType}`);

    if (!isProviderImplemented(providerType)) {
      throw new Error(`Email provider '${providerType}' is not implemented`);
    }

    this.provider = createEmailProvider(providerType, config);
    this.providerType = providerType;
    this.providerConfig = config;

    this.logger.log(`Email provider configured: ${this.provider.displayName}`);
  }

  /**
   * Check if the email service is configured
   */
  isConfigured(): boolean {
    return this.provider !== null;
  }

  /**
   * Get the current provider type
   */
  getProviderType(): EmailProviderType | null {
    return this.providerType;
  }

  /**
   * Get the current provider display name
   */
  getProviderDisplayName(): string | null {
    return this.provider?.displayName || null;
  }

  /**
   * Send an email using the configured provider
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.provider) {
      this.logger.warn('Attempted to send email but no provider is configured');
      return {
        success: false,
        error: 'Email provider is not configured',
      };
    }

    this.logger.debug(
      `Sending email to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`,
    );

    const result = await this.provider.sendEmail(options);

    if (result.success) {
      this.logger.debug(`Email sent successfully: ${result.messageId}`);
    } else {
      this.logger.error(`Failed to send email: ${result.error}`);
    }

    return result;
  }

  /**
   * Test the current provider connection
   */
  async testConnection(): Promise<TestConnectionResult> {
    if (!this.provider) {
      return {
        success: false,
        message: 'Email provider is not configured',
      };
    }

    this.logger.debug(`Testing connection for ${this.provider.displayName}`);
    return this.provider.testConnection();
  }

  /**
   * Test a provider configuration without persisting it
   */
  async testProviderConfig(
    providerType: EmailProviderType,
    config: Record<string, unknown>,
  ): Promise<TestConnectionResult> {
    if (!isProviderImplemented(providerType)) {
      return {
        success: false,
        message: `Email provider '${providerType}' is not implemented`,
      };
    }

    try {
      const tempProvider = createEmailProvider(providerType, config);
      return tempProvider.testConnection();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: 'Failed to create provider',
        error: errorMessage,
      };
    }
  }

  /**
   * Send a password reset email
   */
  async sendPasswordResetEmail(email: string, resetLink: string): Promise<SendEmailResult> {
    return this.sendEmail({
      to: email,
      subject: 'Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Reset Your Password</h2>
          <p>You requested a password reset. Click the button below to create a new password:</p>
          <p style="margin: 30px 0;">
            <a href="${resetLink}"
               style="background-color: #0066cc; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 4px; display: inline-block;">
              Reset Password
            </a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; word-break: break-all;">${resetLink}</p>
          <p style="color: #999; font-size: 14px; margin-top: 30px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `Reset Your Password\n\nYou requested a password reset. Click this link to create a new password:\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`,
    });
  }

  /**
   * Send an email verification email
   */
  async sendVerificationEmail(email: string, verifyLink: string): Promise<SendEmailResult> {
    return this.sendEmail({
      to: email,
      subject: 'Verify Your Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify Your Email</h2>
          <p>Please verify your email address by clicking the button below:</p>
          <p style="margin: 30px 0;">
            <a href="${verifyLink}"
               style="background-color: #0066cc; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 4px; display: inline-block;">
              Verify Email
            </a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; word-break: break-all;">${verifyLink}</p>
        </div>
      `,
      text: `Verify Your Email\n\nPlease verify your email address by clicking this link:\n${verifyLink}`,
    });
  }

  /**
   * Send a workspace invitation email
   */
  async sendInvitationEmail(
    email: string,
    inviteLink: string,
    options?: {
      inviterName?: string;
      workspaceName?: string;
      role?: string;
    },
  ): Promise<SendEmailResult> {
    const inviterName = options?.inviterName || 'A workspace administrator';
    const workspaceName = options?.workspaceName || 'the workspace';
    const role = options?.role || 'member';

    return this.sendEmail({
      to: email,
      subject: `You've been invited to join ${workspaceName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You're Invited!</h2>
          <p>${inviterName} has invited you to join <strong>${workspaceName}</strong> as a <strong>${role}</strong>.</p>
          <p style="margin: 30px 0;">
            <a href="${inviteLink}"
               style="background-color: #0066cc; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 4px; display: inline-block;">
              Accept Invitation
            </a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; word-break: break-all;">${inviteLink}</p>
          <p style="color: #999; font-size: 14px; margin-top: 30px;">
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `You're Invited!\n\n${inviterName} has invited you to join ${workspaceName} as a ${role}.\n\nClick this link to accept the invitation:\n${inviteLink}\n\nIf you weren't expecting this invitation, you can safely ignore this email.`,
    });
  }

  /**
   * Get list of available email providers with metadata
   */
  getAvailableProviders(): EmailProviderMetadata[] {
    const implementedProviders = getImplementedProviders();

    return Object.values(EMAIL_PROVIDER_METADATA)
      .filter((provider) => implementedProviders.includes(provider.id))
      .map((provider) => ({
        ...provider,
        // Add implementation status
        implemented: true,
      }));
  }

  /**
   * Get all providers (including not yet implemented)
   */
  getAllProviders(): (EmailProviderMetadata & { implemented: boolean })[] {
    const implementedProviders = getImplementedProviders();

    return Object.values(EMAIL_PROVIDER_METADATA).map((provider) => ({
      ...provider,
      implemented: implementedProviders.includes(provider.id),
    }));
  }
}
