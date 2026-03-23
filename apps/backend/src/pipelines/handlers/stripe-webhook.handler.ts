import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IntegrationsService } from '../../integrations/integrations.service';

/**
 * Configuration for stripe_webhook handler
 */
export interface StripeWebhookHandlerConfig extends BaseHandlerConfig {
  /**
   * Which Stripe event types to accept.
   * If specified, events not in this list are rejected.
   * If omitted, all event types are accepted.
   */
  allowedEventTypes?: string[];
  /** Override the project's active Stripe environment for this step */
  environment?: 'sandbox' | 'production';
}

/**
 * Stripe Webhook Handler
 *
 * Validates Stripe webhook signatures and parses the event.
 * Use this as the first step in a pipeline proxy rule that receives
 * Stripe webhook POST requests.
 *
 * The handler:
 * 1. Reads the raw body and stripe-signature header from the request
 * 2. Gets the webhook secret from the project's Stripe integration config
 * 3. Verifies the signature using the Stripe SDK
 * 4. Optionally filters by event type
 * 5. Outputs the verified Stripe event object
 *
 * Subsequent steps can access event data via expressions:
 *   steps.stripe_webhook.type          -> "checkout.session.completed"
 *   steps.stripe_webhook.data.object   -> the Stripe object (Session, Invoice, etc.)
 *   steps.stripe_webhook.data.object.client_reference_id -> user ID from checkout
 *   steps.stripe_webhook.data.object.amount_total -> payment amount in cents
 */
@Injectable()
export class StripeWebhookHandler implements StepHandler<StripeWebhookHandlerConfig> {
  readonly type = 'stripe_webhook' as const;
  private readonly logger = new Logger(StripeWebhookHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly integrationsService: IntegrationsService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: StripeWebhookHandlerConfig): void {
    if (config.allowedEventTypes && !Array.isArray(config.allowedEventTypes)) {
      throw new ConfigurationError(
        'allowedEventTypes must be an array of strings',
        'stripe_webhook',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as StripeWebhookHandlerConfig;

    // Get signature header
    const signature = context.request.headers['stripe-signature'];
    if (!signature) {
      return {
        success: false,
        error: {
          code: 'STRIPE_WEBHOOK_NO_SIGNATURE',
          message: 'Missing stripe-signature header',
        },
      };
    }

    // Get raw body for signature verification
    const rawBody = (context.request as any).rawBody;
    if (!rawBody) {
      return {
        success: false,
        error: {
          code: 'STRIPE_WEBHOOK_NO_RAW_BODY',
          message: 'Raw body not available for signature verification. Ensure rawBody is enabled in NestJS.',
        },
      };
    }

    // Get Stripe config from project integration settings
    const stripeConfig = await this.integrationsService.getActiveConfig(
      context.projectId,
      'stripe',
      config.environment,
    );

    if (!stripeConfig?.secretKey || !stripeConfig?.webhookSecret) {
      return {
        success: false,
        error: {
          code: 'STRIPE_WEBHOOK_NOT_CONFIGURED',
          message: 'Stripe integration is not configured with webhook secret. Configure it in Project Settings > Integrations.',
        },
      };
    }

    // Verify signature and construct event
    let event: any;
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeConfig.secretKey as string);
      event = stripe.webhooks.constructEvent(
        rawBody,
        Array.isArray(signature) ? signature[0] : signature,
        stripeConfig.webhookSecret as string,
      );
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
      return {
        success: false,
        error: {
          code: 'STRIPE_WEBHOOK_INVALID_SIGNATURE',
          message: 'Invalid webhook signature',
        },
      };
    }

    // Filter by event type if configured
    if (config.allowedEventTypes && config.allowedEventTypes.length > 0) {
      if (!config.allowedEventTypes.includes(event.type)) {
        this.logger.debug(`Ignoring event type '${event.type}' (not in allowedEventTypes)`);
        return {
          success: true,
          output: { ignored: true, eventType: event.type },
          terminates: true, // Stop pipeline, return success
        };
      }
    }

    this.logger.log(`Verified Stripe webhook event: ${event.type} (${event.id})`);

    // Output the full event for subsequent steps to use
    return {
      success: true,
      output: event,
    };
  }
}
