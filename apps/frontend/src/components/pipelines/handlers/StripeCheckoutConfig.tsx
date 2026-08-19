import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type {
  StripeCheckoutDiscount,
  StripeCheckoutHandlerConfig,
  StripeCheckoutLineItem,
} from './types';

interface StripeCheckoutConfigProps {
  config: Partial<StripeCheckoutHandlerConfig>;
  onChange: (config: StripeCheckoutHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

type PricingMode = 'single' | 'multi';

export function StripeCheckoutConfig({
  config,
  onChange,
  previousSteps = [],
}: StripeCheckoutConfigProps) {
  const initialPricingMode: PricingMode =
    Array.isArray(config.lineItems) && config.lineItems.length > 0 ? 'multi' : 'single';

  const [pricingMode, setPricingMode] = useState<PricingMode>(initialPricingMode);
  const [priceId, setPriceId] = useState(config.priceId || '');
  const [lineItems, setLineItems] = useState<StripeCheckoutLineItem[]>(
    config.lineItems && config.lineItems.length > 0
      ? config.lineItems
      : [{ price: '', quantity: '1' }],
  );
  const [mode, setMode] = useState<'payment' | 'subscription'>(config.mode || 'payment');
  const [successUrl, setSuccessUrl] = useState(config.successUrl || '');
  const [cancelUrl, setCancelUrl] = useState(config.cancelUrl || '');
  const [customerEmail, setCustomerEmail] = useState(config.customerEmail || '');
  const [clientReferenceId, setClientReferenceId] = useState(config.clientReferenceId || '');
  const [quantity, setQuantity] = useState(config.quantity || '1');
  const [environment, setEnvironment] = useState<'sandbox' | 'production' | ''>(
    config.environment || '',
  );
  const [allowPromotionCodes, setAllowPromotionCodes] = useState<boolean>(
    config.allowPromotionCodes ?? false,
  );
  const [trialPeriodDays, setTrialPeriodDays] = useState<string>(
    config.subscriptionData?.trialPeriodDays || '',
  );
  const [discounts, setDiscounts] = useState<
    Array<{ kind: 'coupon' | 'promotionCode'; value: string }>
  >(
    (config.discounts || []).map((d) =>
      d.coupon
        ? { kind: 'coupon' as const, value: d.coupon }
        : { kind: 'promotionCode' as const, value: d.promotionCode || '' },
    ),
  );
  const [metadata, setMetadata] = useState<Array<{ key: string; value: string }>>(
    Object.entries(config.metadata || {}).map(([key, value]) => ({ key, value })),
  );

  useEffect(() => {
    const metadataObj = metadata.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});

    const cleanedLineItems = lineItems
      .filter((item) => item.price.trim())
      .map((item) => ({
        price: item.price,
        ...(item.quantity && item.quantity !== '1' ? { quantity: item.quantity } : {}),
      }));

    const cleanedDiscounts: StripeCheckoutDiscount[] = discounts
      .filter((d) => d.value.trim())
      .map((d) =>
        d.kind === 'coupon' ? { coupon: d.value.trim() } : { promotionCode: d.value.trim() },
      );

    const usingMulti = pricingMode === 'multi';

    const next: StripeCheckoutHandlerConfig = {
      mode,
      successUrl,
      cancelUrl,
      ...(usingMulti
        ? { lineItems: cleanedLineItems }
        : { priceId, ...(quantity !== '1' ? { quantity } : {}) }),
      ...(customerEmail ? { customerEmail } : {}),
      ...(clientReferenceId ? { clientReferenceId } : {}),
      ...(environment ? { environment } : {}),
      ...(allowPromotionCodes ? { allowPromotionCodes: true } : {}),
      ...(cleanedDiscounts.length > 0 ? { discounts: cleanedDiscounts } : {}),
      ...(mode === 'subscription' && trialPeriodDays.trim()
        ? { subscriptionData: { trialPeriodDays: trialPeriodDays.trim() } }
        : {}),
      ...(Object.keys(metadataObj).length > 0 ? { metadata: metadataObj } : {}),
    };

    onChange(next);
  }, [
    pricingMode,
    priceId,
    lineItems,
    mode,
    successUrl,
    cancelUrl,
    customerEmail,
    clientReferenceId,
    quantity,
    environment,
    allowPromotionCodes,
    trialPeriodDays,
    discounts,
    metadata,
  ]);

  const updateLineItem = (i: number, patch: Partial<StripeCheckoutLineItem>) => {
    const next = [...lineItems];
    next[i] = { ...next[i], ...patch };
    setLineItems(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Stripe Environment</Label>
        <Select
          value={environment || 'default'}
          onValueChange={(v) =>
            setEnvironment(v === 'default' ? '' : (v as 'sandbox' | 'production'))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Use project default</SelectItem>
            <SelectItem value="sandbox">Sandbox</SelectItem>
            <SelectItem value="production">Production</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Override the project's active Stripe environment for this step
        </p>
      </div>

      <div className="space-y-2">
        <Label>Pricing</Label>
        <Select value={pricingMode} onValueChange={(v) => setPricingMode(v as PricingMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Single price</SelectItem>
            <SelectItem value="multi">Multiple line items (e.g. one-time + recurring)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {pricingMode === 'single' ? (
        <>
          <div className="space-y-2">
            <Label>Price ID *</Label>
            <ExpressionInput
              value={priceId}
              onChange={setPriceId}
              placeholder="price_1ABC..."
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Stripe Price ID from your product catalog
            </p>
          </div>
          <div className="space-y-2">
            <Label>Quantity</Label>
            <ExpressionInput
              value={quantity}
              onChange={setQuantity}
              placeholder="1"
              previousSteps={previousSteps}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label>Line Items *</Label>
          <p className="text-xs text-muted-foreground">
            One row per Stripe Price. Mix one-time and recurring prices to bundle (e.g. $99 site +
            $35/mo hosting). If any item is recurring, set Mode to "Subscription".
          </p>
          <div className="space-y-2">
            {lineItems.map((item, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border/50 p-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Price ID *</Label>
                    <ExpressionInput
                      value={item.price}
                      onChange={(v) => updateLineItem(i, { price: v })}
                      placeholder="price_1ABC..."
                      previousSteps={previousSteps}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Quantity</Label>
                    <ExpressionInput
                      value={item.quantity || '1'}
                      onChange={(v) => updateLineItem(i, { quantity: v })}
                      placeholder="1"
                      previousSteps={previousSteps}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLineItems(lineItems.filter((_, j) => j !== i))}
                  disabled={lineItems.length === 1}
                  className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLineItems([...lineItems, { price: '', quantity: '1' }])}
              className="text-xs text-primary hover:underline"
            >
              + Add line item
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as 'payment' | 'subscription')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="payment">One-time Payment</SelectItem>
            <SelectItem value="subscription">Subscription</SelectItem>
          </SelectContent>
        </Select>
        {pricingMode === 'multi' && mode === 'payment' && (
          <p className="text-xs text-amber-600">
            Heads up: multi-line checkouts that include any recurring price require Mode =
            Subscription.
          </p>
        )}
      </div>

      {mode === 'subscription' && (
        <div className="space-y-2">
          <Label>Free trial (days)</Label>
          <ExpressionInput
            value={trialPeriodDays}
            onChange={setTrialPeriodDays}
            placeholder="30"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            Customer is not charged for the recurring item(s) during the trial. Use "30" for one
            free month. Leave blank for no trial.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Success URL *</Label>
        <ExpressionInput
          value={successUrl}
          onChange={setSuccessUrl}
          placeholder="https://yoursite.com/success?session_id={CHECKOUT_SESSION_ID}"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">Redirect URL after successful payment</p>
      </div>

      <div className="space-y-2">
        <Label>Cancel URL *</Label>
        <ExpressionInput
          value={cancelUrl}
          onChange={setCancelUrl}
          placeholder="https://yoursite.com/cancel"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">Redirect URL when payment is cancelled</p>
      </div>

      <div className="space-y-2">
        <Label>Customer Email (optional)</Label>
        <ExpressionInput
          value={customerEmail}
          onChange={setCustomerEmail}
          placeholder="user.email"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">Pre-fill the customer's email on checkout</p>
      </div>

      <div className="space-y-2">
        <Label>Client Reference ID (optional)</Label>
        <ExpressionInput
          value={clientReferenceId}
          onChange={setClientReferenceId}
          placeholder="user.id"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Your internal reference (e.g., user ID). Available in webhook events.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label>Allow promotion codes</Label>
          <p className="text-xs text-muted-foreground">
            Show "Add promotion code" on the Stripe Checkout page so customers can apply coupons.
          </p>
        </div>
        <Switch
          checked={allowPromotionCodes}
          onCheckedChange={setAllowPromotionCodes}
          disabled={discounts.length > 0}
        />
      </div>

      <div className="space-y-2">
        <Label>Server-side discounts (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Apply a coupon or promotion code automatically — the customer doesn't enter anything.
          Common pattern: a 100%-off, duration-once coupon scoped to your hosting product to give
          the first month free while still charging the one-time website price up front. Mutually
          exclusive with "Allow promotion codes".
        </p>
        <div className="space-y-2">
          {discounts.map((d, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border/50 p-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select
                    value={d.kind}
                    onValueChange={(v) => {
                      const next = [...discounts];
                      next[i] = { ...next[i], kind: v as 'coupon' | 'promotionCode' };
                      setDiscounts(next);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coupon">Coupon</SelectItem>
                      <SelectItem value="promotionCode">Promotion code (promo_xxx)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {d.kind === 'coupon' ? 'Coupon ID' : 'Promotion Code ID'}
                  </Label>
                  <ExpressionInput
                    value={d.value}
                    onChange={(v) => {
                      const next = [...discounts];
                      next[i] = { ...next[i], value: v };
                      setDiscounts(next);
                    }}
                    placeholder={d.kind === 'coupon' ? 'coupon_abc' : 'promo_1ABC...'}
                    previousSteps={previousSteps}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDiscounts(discounts.filter((_, j) => j !== i))}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
          {discounts.length === 0 && (
            <button
              type="button"
              onClick={() => setDiscounts([{ kind: 'coupon', value: '' }])}
              disabled={allowPromotionCodes}
              className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
            >
              + Add discount
            </button>
          )}
          {allowPromotionCodes && discounts.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Disable "Allow promotion codes" above to add a server-side discount.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Metadata (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Key-value pairs attached to the checkout session. Available in webhook events via{' '}
          <code>session.metadata</code>.
        </p>
        <div className="space-y-2">
          {metadata.map((entry, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border/50 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Key</Label>
                  <ExpressionInput
                    value={entry.key}
                    onChange={(v) => {
                      const updated = [...metadata];
                      updated[i] = { ...updated[i], key: v };
                      setMetadata(updated);
                    }}
                    placeholder="key"
                    previousSteps={[]}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Value</Label>
                  <ExpressionInput
                    value={entry.value}
                    onChange={(v) => {
                      const updated = [...metadata];
                      updated[i] = { ...updated[i], value: v };
                      setMetadata(updated);
                    }}
                    placeholder="expression or literal"
                    previousSteps={previousSteps}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMetadata(metadata.filter((_, j) => j !== i))}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMetadata([...metadata, { key: '', value: '' }])}
            className="text-xs text-primary hover:underline"
          >
            + Add metadata
          </button>
        </div>
      </div>
    </div>
  );
}
