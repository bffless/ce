import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ExpressionInput } from './ExpressionInput';
import type { FileDeleteHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

type Mode = 'prefix' | 'key' | 'prefixes';
type ListForm = 'static' | 'expression';

/** Turn a textarea's "one prefix per line" text into the array the handler takes. */
const linesToList = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Config editor for the destructive file_delete handler.
 *
 * The user picks ONE of three modes: delete a whole prefix ("folder"), a single
 * object key, or MANY prefixes in one step. All are relative to the project's
 * uploads root and support expressions (e.g. "projects/{{request.body.projectId}}/").
 *
 * The prefixes mode has two forms, mirroring the handler's `keys` shape: a
 * static list (one prefix template per line → `string[]`) or a single bare
 * expression that resolves to an array at runtime (→ `string`).
 */
export function FileDeleteHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  // Track the selected mode in local state. Deriving it from whether `key` has
  // content would strand the user in prefix mode: switching to Key while the key
  // is still empty would leave the derived mode at 'prefix', so the Key field
  // could never appear. Seed from the existing config (prefixes present →
  // prefixes; key present → key; otherwise prefix).
  const [mode, setMode] = useState<Mode>(() => {
    if (typedConfig.prefixes !== undefined) return 'prefixes';
    if (typeof typedConfig.key === 'string' && typedConfig.key.length > 0) return 'key';
    return 'prefix';
  });

  // Same reasoning for the list form: a string `prefixes` is an expression,
  // anything else (array or absent) is the static list.
  const [listForm, setListForm] = useState<ListForm>(
    typeof typedConfig.prefixes === 'string' ? 'expression' : 'static',
  );

  // The textarea keeps its own text so blank lines / a trailing newline survive
  // while typing; the config only ever receives the trimmed, non-empty lines.
  const [listText, setListText] = useState(
    Array.isArray(typedConfig.prefixes) ? typedConfig.prefixes.join('\n') : '',
  );

  const update = (partial: Partial<Config>) => {
    onChange({ ...typedConfig, ...partial } as Config);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    // Keep only the field for the selected mode so exactly one is sent.
    const cleared: Partial<Config> = {
      ...typedConfig,
      prefix: undefined,
      key: undefined,
      prefixes: undefined,
    };
    if (next === 'prefix') {
      onChange({ ...cleared, prefix: typedConfig.prefix } as Config);
    } else if (next === 'key') {
      onChange({ ...cleared, key: typedConfig.key } as Config);
    } else {
      onChange({
        ...cleared,
        prefixes:
          listForm === 'expression'
            ? typeof typedConfig.prefixes === 'string'
              ? typedConfig.prefixes
              : ''
            : linesToList(listText),
      } as Config);
    }
  };

  const switchListForm = (next: ListForm) => {
    setListForm(next);
    // A string is always read as an expression by the handler, so the two
    // forms never share a value — reset to the empty value of the new form.
    update({ prefixes: next === 'expression' ? '' : linesToList(listText) });
  };

  const modeButton = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => switchMode(value)}
      className={`rounded border px-3 py-1.5 text-sm ${
        mode === value ? 'border-primary bg-primary/10 font-medium' : 'border-input'
      }`}
    >
      {label}
    </button>
  );

  const listFormButton = (value: ListForm, label: string) => (
    <button
      type="button"
      onClick={() => switchListForm(value)}
      className={`rounded border px-2 py-1 text-xs ${
        listForm === value ? 'border-primary bg-primary/10 font-medium' : 'border-input'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-destructive">Destructive.</span> Deletes objects under
        this project's uploads root. Gate the rule with an <code>auth_required</code> validator.
      </div>

      <div className="space-y-2">
        <Label>Mode</Label>
        <div className="flex gap-2">
          {modeButton('prefix', 'Prefix (folder)')}
          {modeButton('key', 'Single key')}
          {modeButton('prefixes', 'Prefixes (list)')}
        </div>
      </div>

      {mode === 'prefix' && (
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
      )}

      {mode === 'key' && (
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

      {mode === 'prefixes' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Prefixes</Label>
            <div className="flex gap-1">
              {listFormButton('static', 'Static list')}
              {listFormButton('expression', 'Expression')}
            </div>
          </div>
          {listForm === 'static' ? (
            <>
              <Textarea
                value={listText}
                onChange={(e) => {
                  setListText(e.target.value);
                  update({ prefixes: linesToList(e.target.value) });
                }}
                placeholder={'e.g.\nruns/{{steps.a.id}}/\nruns/{{steps.b.id}}/'}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                One prefix per line, each relative to the uploads root and each supporting
                expressions. Everything under every listed prefix is deleted; the result is the
                summed count. A blank or <code>..</code>-containing entry is rejected.
              </p>
            </>
          ) : (
            <>
              <ExpressionInput
                value={typeof typedConfig.prefixes === 'string' ? typedConfig.prefixes : ''}
                onChange={(v) => update({ prefixes: v })}
                placeholder="e.g., steps.cutoff.prefixes"
                previousSteps={previousSteps}
              />
              <p className="text-xs text-muted-foreground">
                A single expression that resolves at runtime to an array of prefixes (e.g. a prior
                step listing every expired run folder). An empty array is a no-op.
              </p>
            </>
          )}
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
          <span className="text-muted-foreground">
            {mode === 'prefixes'
              ? 'Objects deleted across all prefixes'
              : 'Number of objects deleted'}
          </span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{mode}</code>
          <span className="text-muted-foreground">
            {mode === 'prefixes'
              ? 'The resolved prefixes that were targeted'
              : `The ${mode} that was targeted`}
          </span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">dryRun</code>
          <span className="text-muted-foreground">Whether this was a dry run</span>
        </div>
      </div>
    </div>
  );
}
