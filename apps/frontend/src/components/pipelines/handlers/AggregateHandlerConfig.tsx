import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import type { AggregateHandlerConfig } from './types';

interface AggregateHandlerConfigProps {
  config: Partial<AggregateHandlerConfig>;
  onChange: (config: AggregateHandlerConfig) => void;
}

const OPERATIONS: {
  value: AggregateHandlerConfig['operation'];
  label: string;
  requiresField: boolean;
}[] = [
  { value: 'count', label: 'Count', requiresField: false },
  { value: 'sum', label: 'Sum', requiresField: true },
  { value: 'avg', label: 'Average', requiresField: true },
  { value: 'min', label: 'Minimum', requiresField: true },
  { value: 'max', label: 'Maximum', requiresField: true },
];

export function AggregateHandlerConfig({ config, onChange }: AggregateHandlerConfigProps) {
  const [operation, setOperation] = useState<AggregateHandlerConfig['operation']>(
    config.operation || 'count',
  );
  const [field, setField] = useState(config.field || '');

  const selectedOp = OPERATIONS.find((op) => op.value === operation);
  const requiresField = selectedOp?.requiresField ?? false;

  useEffect(() => {
    onChange({
      operation,
      field: requiresField ? field : undefined,
    });
  }, [operation, field, requiresField, onChange]);

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This handler operates on array data from a previous step (e.g., data_query).
          Place it after a step that returns an array of records.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="operation">Operation</Label>
        <Select
          value={operation}
          onValueChange={(v) => setOperation(v as AggregateHandlerConfig['operation'])}
        >
          <SelectTrigger id="operation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {requiresField && (
        <div className="space-y-2">
          <Label htmlFor="field">Field to Aggregate</Label>
          <Input
            id="field"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="e.g., amount, price, score"
          />
          <p className="text-xs text-muted-foreground">
            The numeric field from each record to use for the calculation.
          </p>
        </div>
      )}

      <div className="p-3 bg-muted/50 rounded-md text-sm">
        <p className="font-medium mb-1">Output:</p>
        <code className="text-xs">
          {operation === 'count'
            ? '{ operation: "count", result: <number> }'
            : `{ operation: "${operation}", field: "${field || '<field>'}", result: <number>, count: <number> }`}
        </code>
      </div>
    </div>
  );
}
