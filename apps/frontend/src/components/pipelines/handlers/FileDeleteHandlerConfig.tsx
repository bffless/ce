import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { FileDeleteHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

/**
 * Config editor for the destructive file_delete handler.
 *
 * The user picks ONE of two modes: delete a whole prefix ("folder") or a single
 * object key. Both are relative to the project's uploads root and support
 * expressions (e.g. "projects/{{request.body.projectId}}/").
 */
export function FileDeleteHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  // Track the selected mode in local state. Deriving it from whether `key` has
  // content would strand the user in prefix mode: switching to Key while the key
  // is still empty would leave the derived mode at 'prefix', so the Key field
  // could never appear. Seed from the existing config (key present → key).
  const [mode, setMode] = useState<'prefix' | 'key'>(
    typeof typedConfig.key === 'string' && typedConfig.key.length > 0 ? 'key' : 'prefix',
  );

  const update = (partial: Partial<Config>) => {
    onChange({ ...typedConfig, ...partial } as Config);
  };

  const switchMode = (next: 'prefix' | 'key') => {
    setMode(next);
    // Keep only the field for the selected mode so exactly one is sent.
    if (next === 'prefix') {
      onChange({ ...typedConfig, key: undefined } as Config);
    } else {
      onChange({ ...typedConfig, prefix: undefined } as Config);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-destructive">Destructive.</span> Deletes objects under
        this project's uploads root. Gate the rule with an <code>auth_required</code> validator.
      </div>

      <div className="space-y-2">
        <Label>Mode</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => switchMode('prefix')}
            className={`rounded border px-3 py-1.5 text-sm ${
              mode === 'prefix' ? 'border-primary bg-primary/10 font-medium' : 'border-input'
            }`}
          >
            Prefix (folder)
          </button>
          <button
            type="button"
            onClick={() => switchMode('key')}
            className={`rounded border px-3 py-1.5 text-sm ${
              mode === 'key' ? 'border-primary bg-primary/10 font-medium' : 'border-input'
            }`}
          >
            Single key
          </button>
        </div>
      </div>

      {mode === 'prefix' ? (
        <div className="space-y-2">
          <Label>Prefix</Label>
          <ExpressionInput
            value={typedConfig.prefix || ''}
            onChange={(v) => update({ prefix: v })}
            placeholder="e.g., projects/{{request.body.projectId}}/"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            Deletes every object whose key starts with this, relative to the uploads root. A blank
            or <code>..</code>-containing value is rejected.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Key</Label>
          <ExpressionInput
            value={typedConfig.key || ''}
            onChange={(v) => update({ key: v })}
            placeholder="e.g., projects/abc123/source/uuid-file.mov"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            Deletes a single object, relative to the uploads root.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Dry run</Label>
          <p className="text-xs text-muted-foreground">
            List and report what would be deleted, but delete nothing.
          </p>
        </div>
        <Switch
          checked={typedConfig.dryRun === true}
          onCheckedChange={(checked) => update({ dryRun: checked })}
        />
      </div>

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">deleted</code>
          <span className="text-muted-foreground">Number of objects deleted</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
            {mode === 'prefix' ? 'prefix' : 'key'}
          </code>
          <span className="text-muted-foreground">The {mode} that was targeted</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">dryRun</code>
          <span className="text-muted-foreground">Whether this was a dry run</span>
        </div>
      </div>
    </div>
  );
}
