import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info } from 'lucide-react';
import type { StripeWebhookHandlerConfig } from './types';

interface StripeWebhookConfigProps {
  config: Partial<StripeWebhookHandlerConfig>;
  onChange: (config: StripeWebhookHandlerConfig) => void;
}

export function StripeWebhookConfig({ config, onChange }: StripeWebhookConfigProps) {
  const [eventTypes, setEventTypes] = useState<string[]>(config.allowedEventTypes || []);
  const [environment, setEnvironment] = useState<'sandbox' | 'production' | ''>(config.environment || '');

  useEffect(() => {
    onChange({
      ...(eventTypes.length > 0 ? { allowedEventTypes: eventTypes } : {}),
      ...(environment ? { environment } : {}),
    });
  }, [eventTypes, environment]);

  const addEventType = () => {
    setEventTypes([...eventTypes, 'checkout.session.completed']);
  };

  const removeEventType = (index: number) => {
    setEventTypes(eventTypes.filter((_, i) => i !== index));
  };

  const updateEventType = (index: number, value: string) => {
    const updated = [...eventTypes];
    updated[index] = value;
    setEventTypes(updated);
  };

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

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Verifies the Stripe webhook signature using the webhook secret from
          Project Settings &gt; Integrations. The verified event is available to
          subsequent steps as <code>steps.{'{step_name}'}</code>.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Allowed Event Types (optional)</Label>
          <Button variant="outline" size="sm" onClick={addEventType}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Filter which Stripe events this pipeline accepts. Leave empty to accept all events.
        </p>

        {eventTypes.map((eventType, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input
              value={eventType}
              onChange={(e) => updateEventType(index, e.target.value)}
              placeholder="checkout.session.completed"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeEventType(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium">Common event types:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li><code>checkout.session.completed</code> — payment completed</li>
          <li><code>invoice.payment_succeeded</code> — subscription payment</li>
          <li><code>customer.subscription.deleted</code> — subscription cancelled</li>
        </ul>
      </div>
    </div>
  );
}
