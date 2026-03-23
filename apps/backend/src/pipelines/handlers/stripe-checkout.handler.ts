import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IntegrationsService } from '../../integrations/integrations.service';

/**
 * Configuration for stripe_checkout handler
 */
export interface StripeCheckoutHandlerConfig extends BaseHandlerConfig {
  /** Stripe Price ID (expression) */
  priceId: string;
  /** Checkout mode */
  mode?: 'payment' | 'subscription';
  /** Redirect URL after successful payment (expression) */
  successUrl: string;
  /** Redirect URL on cancel (expression) */
  cancelUrl: string;
  /** Pre-fill customer email (expression) */
  customerEmail?: string;
  /** Client reference ID for tracking (expression, e.g. user ID) */
  clientReferenceId?: string;
  /** Additional metadata key-value pairs (expression values) */
  metadata?: Record<string, string>;
  /** Quantity (expression, default "1") */
  quantity?: string;
  /** Override the project's active Stripe environment for this step */
  environment?: 'sandbox' | 'production';
}

/**
 * Stripe Checkout Handler
 *
 * Creates a Stripe Checkout Session and returns the session URL.
 * The frontend can then redirect the user to complete payment.
 *
 * Requires Stripe integration to be configured in project settings.
 */
@Injectable()
export class StripeCheckoutHandler implements StepHandler<StripeCheckoutHandlerConfig> {
  readonly type = 'stripe_checkout' as const;
  private readonly logger = new Logger(StripeCheckoutHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly integrationsService: IntegrationsService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: StripeCheckoutHandlerConfig): void {
    if (!config.priceId) {
      throw new ConfigurationError('priceId is required', 'stripe_checkout');
    }
    if (!config.successUrl) {
      throw new ConfigurationError('successUrl is required', 'stripe_checkout');
    }
    if (!config.cancelUrl) {
      throw new ConfigurationError('cancelUrl is required', 'stripe_checkout');
    }
    if (config.mode && !['payment', 'subscription'].includes(config.mode)) {
      throw new ConfigurationError(
        `Invalid mode '${config.mode}'. Must be 'payment' or 'subscription'`,
        'stripe_checkout',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as StripeCheckoutHandlerConfig;

    // Get Stripe keys from project integration config
    const stripeConfig = await this.integrationsService.getActiveConfig(
      context.projectId,
      'stripe',
      config.environment,
    );

    if (!stripeConfig?.secretKey) {
      return {
        success: false,
        error: {
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe integration is not configured for this project. Configure it in Project Settings > Integrations.',
        },
      };
    }

    // Resolve expressions
    const priceId = String(
      this.expressionEvaluator.evaluateExpression(config.priceId, context, step.name),
    );
    const successUrl = String(
      this.expressionEvaluator.evaluateExpression(config.successUrl, context, step.name),
    );
    const cancelUrl = String(
      this.expressionEvaluator.evaluateExpression(config.cancelUrl, context, step.name),
    );

    const mode = config.mode || 'payment';

    // Build line items
    const quantityStr = config.quantity || '1';
    const quantity = Number(
      this.expressionEvaluator.evaluateExpression(quantityStr, context, step.name),
    ) || 1;

    // Build session params
    const sessionParams: any = {
      mode,
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    // Optional: customer email
    if (config.customerEmail) {
      const email = this.expressionEvaluator.evaluateExpression(
        config.customerEmail,
        context,
        step.name,
      );
      if (email) {
        sessionParams.customer_email = String(email);
      }
    }

    // Optional: client reference ID
    if (config.clientReferenceId) {
      const refId = this.expressionEvaluator.evaluateExpression(
        config.clientReferenceId,
        context,
        step.name,
      );
      if (refId) {
        sessionParams.client_reference_id = String(refId);
      }
    }

    // Optional: metadata
    if (config.metadata) {
      const resolvedMetadata: Record<string, string> = {};
      for (const [key, expr] of Object.entries(config.metadata)) {
        const resolved = this.expressionEvaluator.evaluateExpression(expr, context, step.name);
        if (resolved !== undefined && resolved !== null) {
          resolvedMetadata[key] = String(resolved);
        }
      }
      sessionParams.metadata = resolvedMetadata;
    }

    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeConfig.secretKey as string);

      this.logger.debug(`Creating Stripe Checkout Session with price ${priceId}`);

      const session = await stripe.checkout.sessions.create(sessionParams);

      return {
        success: true,
        output: {
          sessionId: session.id,
          url: session.url,
        },
      };
    } catch (error: any) {
      this.logger.error(`Stripe Checkout failed for step ${step.name}: ${error.message}`);

      return {
        success: false,
        error: {
          code: 'STRIPE_CHECKOUT_ERROR',
          message: `Stripe Checkout failed: ${error.message}`,
          details: {
            type: error.type,
            code: error.code,
          },
        },
      };
    }
  }
}
