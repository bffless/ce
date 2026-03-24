import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type { StripeCheckoutHandlerConfig } from './types';

interface StripeCheckoutConfigProps {
  config: Partial<StripeCheckoutHandlerConfig>;
  onChange: (config: StripeCheckoutHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

export function StripeCheckoutConfig({ config, onChange, previousSteps = [] }: StripeCheckoutConfigProps) {
  const [priceId, setPriceId] = useState(config.priceId || '');
  const [mode, setMode] = useState<'payment' | 'subscription'>(config.mode || 'payment');
  const [successUrl, setSuccessUrl] = useState(config.successUrl || '');
  const [cancelUrl, setCancelUrl] = useState(config.cancelUrl || '');
  const [customerEmail, setCustomerEmail] = useState(config.customerEmail || '');
  const [clientReferenceId, setClientReferenceId] = useState(config.clientReferenceId || '');
  const [quantity, setQuantity] = useState(config.quantity || '1');
  const [environment, setEnvironment] = useState<'sandbox' | 'production' | ''>(config.environment || '');
  const [metadata, setMetadata] = useState<Array<{ key: string; value: string }>>(
    Object.entries(config.metadata || {}).map(([key, value]) => ({ key, value }))
  );

  useEffect(() => {
    const metadataObj = metadata.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});
    onChange({
      priceId,
      mode,
      successUrl,
      cancelUrl,
      ...(customerEmail ? { customerEmail } : {}),
      ...(clientReferenceId ? { clientReferenceId } : {}),
      ...(quantity !== '1' ? { quantity } : {}),
      ...(environment ? { environment } : {}),
      ...(Object.keys(metadataObj).length > 0 ? { metadata: metadataObj } : {}),
    });
  }, [priceId, mode, successUrl, cancelUrl, customerEmail, clientReferenceId, quantity, environment, metadata]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Stripe Environment</Label>
        <Select value={environment || 'default'} onValueChange={(v) => setEnvironment(v === 'default' ? '' : v as 'sandbox' | 'production')}>
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
      </div>

      <div className="space-y-2">
        <Label>Success URL *</Label>
        <ExpressionInput
          value={successUrl}
          onChange={setSuccessUrl}
          placeholder="https://yoursite.com/success?session_id={CHECKOUT_SESSION_ID}"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Redirect URL after successful payment
        </p>
      </div>

      <div className="space-y-2">
        <Label>Cancel URL *</Label>
        <ExpressionInput
          value={cancelUrl}
          onChange={setCancelUrl}
          placeholder="https://yoursite.com/cancel"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Redirect URL when payment is cancelled
        </p>
      </div>

      <div className="space-y-2">
        <Label>Customer Email (optional)</Label>
        <ExpressionInput
          value={customerEmail}
          onChange={setCustomerEmail}
          placeholder="user.email"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Pre-fill the customer's email on checkout
        </p>
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

      <div className="space-y-2">
        <Label>Quantity</Label>
        <ExpressionInput
          value={quantity}
          onChange={setQuantity}
          placeholder="1"
          previousSteps={previousSteps}
        />
      </div>

      <div className="space-y-2">
        <Label>Metadata (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Key-value pairs attached to the checkout session. Available in webhook events via <code>session.metadata</code>.
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
