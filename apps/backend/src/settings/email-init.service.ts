import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EmailSettingsService } from './email-settings.service';
import { EmailService } from '../email/email.service';
import { setEmailServiceForSuperTokens } from '../auth/email-delivery.service';

/**
 * Email Init Service
 *
 * Initializes the email service on application startup by loading
 * the stored email configuration from the database.
 * Also registers the EmailService with SuperTokens for password reset
 * and email verification emails.
 */
@Injectable()
export class EmailInitService implements OnModuleInit {
  private readonly logger = new Logger(EmailInitService.name);

  constructor(
    private readonly emailSettingsService: EmailSettingsService,
    private readonly emailService: EmailService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing email service from database configuration...');

    try {
      await this.emailSettingsService.initializeFromDatabase();
      this.logger.log('Email service initialization complete');
    } catch (error) {
      this.logger.warn(`Failed to initialize email service: ${error}`);
      // Non-fatal - the system will work, just email won't be available until configured
    }

    // Register the EmailService with SuperTokens for password reset and verification emails
    // This allows SuperTokens to use whatever email provider is configured (Resend, SMTP, etc.)
    setEmailServiceForSuperTokens(this.emailService);
    this.logger.log('EmailService registered with SuperTokens email delivery');
  }
}
