import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExpressionInput } from './ExpressionInput';
import type { SignedUrlHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

export function SignedUrlHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [path, setPath] = useState(typedConfig.path || '');
  const [expiresIn, setExpiresIn] = useState<number | undefined>(typedConfig.expiresIn);

  useEffect(() => {
    onChange({
      path,
      ...(expiresIn !== undefined ? { expiresIn } : {}),
    });
  }, [path, expiresIn, onChange]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Storage Path</Label>
        <ExpressionInput
          value={path}
          onChange={setPath}
          placeholder="e.g., steps.upload.storage_path"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Expression resolving to the storage key of the file.
          Typically references a previous file upload step's <code>storage_path</code> output.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Expires In (seconds)</Label>
        <Input
          type="number"
          min={60}
          max={604800}
          value={expiresIn ?? ''}
          onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="3600"
        />
        <p className="text-xs text-muted-foreground">
          How long the signed URL remains valid. Default: 3600 (1 hour). Max: 604800 (7 days).
        </p>
      </div>

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">url</code>
          <span className="text-muted-foreground">Time-limited presigned URL</span>
        </div>
      </div>
    </div>
  );
}
