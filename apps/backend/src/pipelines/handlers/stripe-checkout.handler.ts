import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IntegrationsService } from '../../integrations/integrations.service';

/**
 * One line item on a Stripe Checkout Session.
 * Both fields are expressions (resolved against the pipeline context).
 */
export interface StripeCheckoutLineItem {
  /** Stripe Price ID (expression) */
  price: string;
  /** Quantity (expression, default "1") */
  quantity?: string;
}

/**
 * Subscription-mode-only options. Ignored for one-time payments.
 */
export interface StripeCheckoutSubscriptionData {
  /**
   * Trial period in days. Expression that resolves to a number.
   * If set, the customer's first {trialPeriodDays} days are free.
   * Common use: "30" for one free month.
   *
   * NOTE: For mixed subscription sessions (one-time + recurring line items),
   * a trial defers ALL charges — including the one-time price — to the end of
   * the trial. If you want to charge the one-time price immediately while the
   * recurring price is free for one period, use `discounts` with a 100%-off
   * coupon scoped to the recurring product instead.
   */
  trialPeriodDays?: string;
}

/**
 * Server-side discount applied to the Checkout Session.
 * Provide exactly one of `coupon` or `promotionCode` per item.
 * Stripe accepts at most one item in this list.
 *
 * Cannot be combined with `allowPromotionCodes: true` — Stripe rejects sessions
 * that have both server-side discounts AND a customer-facing promo code field.
 */
export interface StripeCheckoutDiscount {
  /** Stripe Coupon ID (expression). Example: a 100%-off, duration:once coupon scoped to your hosting product. */
  coupon?: string;
  /**
   * Stripe Promotion Code object ID (expression), e.g. "promo_1ABC...".
   * This is the object ID, not the human-readable code shown to customers.
   */
  promotionCode?: string;
}

/**
 * Configuration for stripe_checkout handler
 */
export interface StripeCheckoutHandlerConfig extends BaseHandlerConfig {
  /**
   * Stripe Price ID (expression).
   * Use this for a single-price checkout. For multi-price (e.g. one-time + recurring),
   * use `lineItems` instead. If both are set, `lineItems` wins.
   */
  priceId?: string;
  /**
   * Multiple line items on the same checkout session.
   * Required when bundling a one-time price with a recurring price (mode must be 'subscription').
   */
  lineItems?: StripeCheckoutLineItem[];
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
  /** Quantity (expression, default "1") — used only with `priceId`. Ignored when `lineItems` is set. */
  quantity?: string;
  /** Override the project's active Stripe environment for this step */
  environment?: 'sandbox' | 'production';
  /** Show "Add promotion code" field on the Stripe Checkout page (customer-entered codes). */
  allowPromotionCodes?: boolean;
  /**
   * Apply discounts server-side (you choose, customer doesn't see/enter a code).
   * Mutually exclusive with `allowPromotionCodes`. Stripe accepts one item.
   */
  discounts?: StripeCheckoutDiscount[];
  /** Subscription options (free trial, etc.). Only applied when mode === 'subscription'. */
  subscriptionData?: StripeCheckoutSubscriptionData;
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
    const hasLineItems = Array.isArray(config.lineItems) && config.lineItems.length > 0;
    if (!config.priceId && !hasLineItems) {
      throw new ConfigurationError('Either priceId or lineItems is required', 'stripe_checkout');
    }
    if (hasLineItems) {
      config.lineItems!.forEach((item, i) => {
        if (!item || !item.price) {
          throw new ConfigurationError(`lineItems[${i}].price is required`, 'stripe_checkout');
        }
      });
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
    if (config.subscriptionData && config.mode !== 'subscription') {
      throw new ConfigurationError(
        "subscriptionData can only be used when mode is 'subscription'",
        'stripe_checkout',
      );
    }
    if (config.discounts && config.discounts.length > 0) {
      if (config.allowPromotionCodes) {
        throw new ConfigurationError(
          'discounts cannot be combined with allowPromotionCodes — Stripe rejects this combination',
          'stripe_checkout',
        );
      }
      config.discounts.forEach((d, i) => {
        const hasCoupon = !!(d?.coupon && d.coupon.trim());
        const hasPromo = !!(d?.promotionCode && d.promotionCode.trim());
        if (hasCoupon === hasPromo) {
          throw new ConfigurationError(
            `discounts[${i}] must have exactly one of 'coupon' or 'promotionCode'`,
            'stripe_checkout',
          );
        }
      });
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
          message:
            'Stripe integration is not configured for this project. Configure it in Project Settings > Integrations.',
        },
      };
    }

    const successUrl = String(
      this.expressionEvaluator.evaluateExpression(config.successUrl, context, step.name),
    );
    const cancelUrl = String(
      this.expressionEvaluator.evaluateExpression(config.cancelUrl, context, step.name),
    );

    const mode = config.mode || 'payment';

    // Build line_items: prefer multi-line config, fall back to legacy single priceId
    const resolveQuantity = (q: string | undefined): number => {
      if (!q) return 1;
      const n = Number(this.expressionEvaluator.evaluateExpression(q, context, step.name));
      return Number.isFinite(n) && n > 0 ? n : 1;
    };

    let lineItems: Array<{ price: string; quantity: number }>;
    if (Array.isArray(config.lineItems) && config.lineItems.length > 0) {
      lineItems = config.lineItems.map((item) => ({
        price: String(this.expressionEvaluator.evaluateExpression(item.price, context, step.name)),
        quantity: resolveQuantity(item.quantity),
      }));
    } else {
      const priceId = String(
        this.expressionEvaluator.evaluateExpression(config.priceId!, context, step.name),
      );
      lineItems = [{ price: priceId, quantity: resolveQuantity(config.quantity) }];
    }

    // Build session params
    const sessionParams: any = {
      mode,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    // Subscription-only options
    if (mode === 'subscription' && config.subscriptionData?.trialPeriodDays) {
      const trialDays = Number(
        this.expressionEvaluator.evaluateExpression(
          config.subscriptionData.trialPeriodDays,
          context,
          step.name,
        ),
      );
      if (Number.isFinite(trialDays) && trialDays > 0) {
        sessionParams.subscription_data = {
          ...(sessionParams.subscription_data || {}),
          trial_period_days: Math.floor(trialDays),
        };
      }
    }

    if (config.allowPromotionCodes) {
      sessionParams.allow_promotion_codes = true;
    }

    // Server-side discounts (coupon or promotion_code)
    if (config.discounts && config.discounts.length > 0) {
      const resolvedDiscounts = config.discounts
        .map((d) => {
          if (d.coupon && d.coupon.trim()) {
            const coupon = String(
              this.expressionEvaluator.evaluateExpression(d.coupon, context, step.name),
            ).trim();
            return coupon ? { coupon } : null;
          }
          if (d.promotionCode && d.promotionCode.trim()) {
            const promotion_code = String(
              this.expressionEvaluator.evaluateExpression(d.promotionCode, context, step.name),
            ).trim();
            return promotion_code ? { promotion_code } : null;
          }
          return null;
        })
        .filter((x): x is { coupon: string } | { promotion_code: string } => x !== null);
      if (resolvedDiscounts.length > 0) {
        sessionParams.discounts = resolvedDiscounts;
      }
    }

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

      this.logger.debug(
        `Creating Stripe Checkout Session with line_items=${JSON.stringify(lineItems)}`,
      );

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
