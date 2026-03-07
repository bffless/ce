import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, EmailHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
import { EmailService } from '../../email/email.service';
import { ConfigurationError, StepExecutionError } from '../errors';

/**
 * Email Handler
 *
 * Sends emails using the configured email provider.
 * Supports expressions for recipient and templates for subject/body.
 */
@Injectable()
export class EmailHandler implements StepHandler<EmailHandlerConfig> {
  readonly type = 'email_handler' as const;
  private readonly logger = new Logger(EmailHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly emailService: EmailService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: EmailHandlerConfig): void {
    if (!config.to) {
      throw new ConfigurationError('Recipient (to) is required', 'email_handler');
    }

    if (!config.subject) {
      throw new ConfigurationError('Subject is required', 'email_handler');
    }

    if (!config.body) {
      throw new ConfigurationError('Body is required', 'email_handler');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as EmailHandlerConfig;
    const stepName = step.name || 'email_handler';

    this.logger.debug(`Executing email handler for step '${stepName}'`);

    // Check if email service is configured
    if (!this.emailService.isConfigured()) {
      return {
        success: false,
        error: {
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'Email service is not configured',
          details: { step: stepName },
        },
      };
    }

    // Evaluate recipient (expression)
    const to = this.expressionEvaluator.evaluateExpression(
      config.to,
      context,
      stepName,
    ) as string;

    // Validate email format
    if (!to || typeof to !== 'string' || !this.isValidEmail(to)) {
      return {
        success: false,
        error: {
          code: 'INVALID_RECIPIENT',
          message: `Invalid email recipient: ${to}`,
          details: { to },
        },
      };
    }

    // Evaluate subject (template)
    const subject = this.expressionEvaluator.evaluateTemplate(
      config.subject,
      context,
      stepName,
    );

    // Evaluate body (template)
    const body = this.expressionEvaluator.evaluateTemplate(
      config.body,
      context,
      stepName,
    );

    // Evaluate replyTo if provided (expression)
    let replyTo: string | undefined;
    if (config.replyTo) {
      replyTo = this.expressionEvaluator.evaluateExpression(
        config.replyTo,
        context,
        stepName,
      ) as string;

      if (replyTo && !this.isValidEmail(replyTo)) {
        this.logger.warn(`Invalid replyTo address: ${replyTo}, ignoring`);
        replyTo = undefined;
      }
    }

    // Send the email
    this.logger.debug(`Sending email to ${to}`);

    const result = await this.emailService.sendEmail({
      to,
      subject,
      html: body,
      text: this.htmlToPlainText(body),
      replyTo,
    });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: 'EMAIL_SEND_FAILED',
          message: result.error || 'Failed to send email',
          details: { to, subject },
        },
      };
    }

    this.logger.debug(`Email sent successfully: ${result.messageId}`);

    return {
      success: true,
      output: {
        sent: true,
        messageId: result.messageId,
        to,
        subject,
      },
    };
  }

  private isValidEmail(email: string): boolean {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
  }

  private htmlToPlainText(html: string): string {
    // Basic HTML to plain text conversion
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
