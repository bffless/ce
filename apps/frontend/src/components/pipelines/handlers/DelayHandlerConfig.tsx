import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { ExpressionInput } from './ExpressionInput';
import type { DelayHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

type Unit = 'ms' | 'seconds';

function initialUnit(typed: Partial<Config>): Unit {
  if (typed.ms !== undefined) return 'ms';
  if (typed.seconds !== undefined) return 'seconds';
  return 'seconds';
}

function initialValue(typed: Partial<Config>, unit: Unit): string {
  const raw = unit === 'ms' ? typed.ms : typed.seconds;
  if (raw === undefined || raw === null) return '';
  return String(raw);
}

export function DelayHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [unit, setUnit] = useState<Unit>(initialUnit(typedConfig));
  const [value, setValue] = useState<string>(initialValue(typedConfig, initialUnit(typedConfig)));

  useEffect(() => {
    if (value === '') {
      onChange({} as Config);
      return;
    }
    const asNumber = Number(value);
    const isLiteralNumber = !Number.isNaN(asNumber) && /^\s*-?\d+(\.\d+)?\s*$/.test(value);
    const resolved: number | string = isLiteralNumber ? asNumber : value;
    onChange({ [unit]: resolved } as Config);
  }, [unit, value, onChange]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Duration</Label>
        <div className="flex gap-2">
          <div className="flex-1">
            <ExpressionInput
              value={value}
              onChange={setValue}
              placeholder={unit === 'ms' ? '1000' : '5'}
              previousSteps={previousSteps}
            />
          </div>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className="rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="seconds">seconds</option>
            <option value="ms">ms</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Pause the pipeline for this duration. Accepts a literal number or an expression
          (e.g. <code>request.body.waitMs</code>). Capped at 60 seconds.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">delayedMs</code>
          <span className="text-muted-foreground">Actual delay applied (ms, after clamping)</span>
        </div>
      </div>
    </div>
  );
}
