import { TypeInput as EmailDeliveryTypeInput } from 'supertokens-node/lib/build/ingredients/emaildelivery/types';
import { EmailService } from '../email/email.service';

/**
 * Module-level reference to the EmailService instance.
 * This gets set after NestJS DI initializes the service.
 * SuperTokens email delivery will use this at runtime.
 */
let emailServiceInstance: EmailService | null = null;

/**
 * Constructs the admin URL from a request origin.
 * Password reset links should always go to admin.<workspace>.<domain>
 *
 * Examples:
 * - https://foo.console.sahp.app → https://admin.console.sahp.app
 * - https://admin.console.sahp.app → https://admin.console.sahp.app
 * - https://bar.myworkspace.example.com → https://admin.myworkspace.example.com
 *
 * For single-tenant deployments (e.g., https://example.com), returns the origin as-is.
 */
function getAdminUrlFromOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const hostParts = url.hostname.split('.');

    // If hostname has at least 3 parts (subdomain.workspace.domain.tld),
    // replace the first part with 'admin'
    // e.g., foo.console.sahp.app → ['foo', 'console', 'sahp', 'app']
    if (hostParts.length >= 3) {
      hostParts[0] = 'admin';
      url.hostname = hostParts.join('.');
    }

    // Return origin (protocol + hostname + port if present)
    return url.origin;
  } catch (error) {
    console.warn('[Email Delivery] Failed to parse origin, using as-is:', origin, error);
    return origin;
  }
}

/**
 * Register the EmailService instance for SuperTokens email delivery.
 * Called by EmailInitService after the email service is configured.
 */
export function setEmailServiceForSuperTokens(emailService: EmailService): void {
  emailServiceInstance = emailService;
  console.log('[Email Delivery] EmailService registered for SuperTokens');
}

/**
 * Get the registered EmailService instance.
 */
export function getEmailServiceInstance(): EmailService | null {
  return emailServiceInstance;
}

/**
 * Custom email delivery service for SuperTokens
 *
 * Uses the configured EmailService provider (Resend, SMTP, SendGrid, etc.)
 * Falls back to console logging if no email provider is configured.
 */
export function createEmailDeliveryConfig(): EmailDeliveryTypeInput<any> | undefined {
  console.log(
    '[Email Delivery] Configuring SuperTokens email delivery with deferred provider lookup',
  );

  return {
    override: (originalImplementation) => ({
      ...originalImplementation,
      sendEmail: async (input) => {
        // Fix the password reset link to use our custom route
        if (input.type === 'PASSWORD_RESET') {
          input.passwordResetLink = input.passwordResetLink.replace(
            '/auth/reset-password',
            '/reset-password',
          );

          // Rewrite the domain to use admin.<workspace>.<domain>
          // This ensures reset links always go to the admin UI regardless of
          // which subdomain the user initiated the reset from
          const requestOrigin = input.userContext?.requestOrigin;
          if (requestOrigin) {
            const adminUrl = getAdminUrlFromOrigin(requestOrigin);
            // Replace the origin in the reset link
            const resetUrl = new URL(input.passwordResetLink);
            input.passwordResetLink = `${adminUrl}${resetUrl.pathname}${resetUrl.search}`;
            console.log(`[Email Delivery] Rewrote reset link to admin URL: ${adminUrl}`);
          }
        }

        // Fix the email verification link to use our custom route
        if (input.type === 'EMAIL_VERIFICATION') {
          input.emailVerifyLink = input.emailVerifyLink.replace(
            '/auth/verify-email',
            '/verify-email',
          );

          // Rewrite the domain to use admin.<workspace>.<domain>
          const requestOrigin = input.userContext?.requestOrigin;
          if (requestOrigin) {
            const adminUrl = getAdminUrlFromOrigin(requestOrigin);
            const verifyUrl = new URL(input.emailVerifyLink);
            input.emailVerifyLink = `${adminUrl}${verifyUrl.pathname}${verifyUrl.search}`;
            console.log(`[Email Delivery] Rewrote verify link to admin URL: ${adminUrl}`);
          }
        }

        const userEmail = input.user?.email || input.userContext?.email;

        // Check if EmailService is configured and available
        if (emailServiceInstance && emailServiceInstance.isConfigured()) {
          console.log(`[Email Delivery] Sending ${input.type} email via configured provider`);

          try {
            if (input.type === 'PASSWORD_RESET') {
              const result = await emailServiceInstance.sendPasswordResetEmail(
                userEmail,
                input.passwordResetLink,
              );
              if (!result.success) {
                console.error(
                  '[Email Delivery] Failed to send password reset email:',
                  result.error,
                );
                throw new Error(result.error || 'Failed to send email');
              }
              console.log('[Email Delivery] Password reset email sent successfully');
              return;
            }

            if (input.type === 'EMAIL_VERIFICATION') {
              const result = await emailServiceInstance.sendVerificationEmail(
                userEmail,
                input.emailVerifyLink,
              );
              if (!result.success) {
                console.error('[Email Delivery] Failed to send verification email:', result.error);
                throw new Error(result.error || 'Failed to send email');
              }
              console.log('[Email Delivery] Verification email sent successfully');
              return;
            }
          } catch (error) {
            console.error('[Email Delivery] Error sending email via provider:', error);
            throw error;
          }
        }

        // Fallback: Log to console if no provider is configured
        console.log('\n========================================');
        console.log('📧 EMAIL DELIVERY (Console Mode - No provider configured)');
        console.log('========================================');
        console.log('To:', userEmail);
        console.log('Type:', input.type);

        if (input.type === 'PASSWORD_RESET') {
          console.log('Subject: Reset Your Password');
          console.log('Reset Link:', input.passwordResetLink);
          console.log('\nPassword Reset Email Content:');
          console.log('---');
          console.log(`Hi there,`);
          console.log(``);
          console.log(`We received a request to reset your password.`);
          console.log(``);
          console.log(`Click the link below to reset your password:`);
          console.log(input.passwordResetLink);
          console.log(``);
          console.log(`This link will expire in 30 minutes.`);
          console.log(``);
          console.log(`If you didn't request this, you can safely ignore this email.`);
          console.log('---');
        } else if (input.type === 'EMAIL_VERIFICATION') {
          console.log('Subject: Verify Your Email');
          console.log('Verification Link:', input.emailVerifyLink);
        }

        console.log('========================================\n');
        console.warn(
          '[Email Delivery] Email was logged to console only - configure an email provider to send actual emails',
        );
      },
    }),
  };
}
