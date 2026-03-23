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

  useEffect(() => {
    onChange({
      priceId,
      mode,
      successUrl,
      cancelUrl,
      ...(customerEmail ? { customerEmail } : {}),
      ...(clientReferenceId ? { clientReferenceId } : {}),
      ...(quantity !== '1' ? { quantity } : {}),
    });
  }, [priceId, mode, successUrl, cancelUrl, customerEmail, clientReferenceId, quantity]);

  return (
    <div className="space-y-4">
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
    </div>
  );
}
