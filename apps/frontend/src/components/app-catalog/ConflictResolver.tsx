import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { SyncRuleConflict } from '@/services/appCatalogApi';
import {
  useLazyGetProxyRuleQuery,
  useUpdateProxyRuleMutation,
} from '@/services/proxyRulesApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyConflictField } from './applyConflictField';

interface Props {
  conflicts: SyncRuleConflict[];
}

/** Render a merge candidate compactly — these are usually short scalars or
 *  small arrays, and the full object is a click away in the rule editor. */
function preview(value: unknown): string {
  if (value === undefined) return '(not set)';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  const json = JSON.stringify(value);
  return json && json.length > 120 ? `${json.slice(0, 120)}…` : (json ?? String(value));
}

const ruleLabel = (c: SyncRuleConflict) => `${c.method ?? 'ANY'} ${c.pathPattern}`;

/**
 * Per-field resolution for rules this update left contested.
 *
 * The update already completed keeping the local value, so this is a follow-up
 * choice rather than a gate — nothing here has to be answered for the app to
 * work. "Use the app's version" writes just that one field onto the live rule,
 * leaving every other local edit in place.
 */
export function ConflictResolver({ conflicts }: Props) {
  const [fetchRule] = useLazyGetProxyRuleQuery();
  const [updateRule] = useUpdateProxyRuleMutation();
  const [applied, setApplied] = useState<Record<string, 'saving' | 'done' | string>>({});

  const resolve = async (conflict: SyncRuleConflict, field: string, theirs: unknown) => {
    const key = `${conflict.liveId}:${field}`;
    if (!conflict.liveId) {
      setApplied((s) => ({ ...s, [key]: 'This rule can no longer be addressed directly.' }));
      return;
    }
    setApplied((s) => ({ ...s, [key]: 'saving' }));
    try {
      const rule = await fetchRule(conflict.liveId).unwrap();
      const next = applyConflictField(rule as unknown as Record<string, unknown>, field, theirs);
      await updateRule({
        id: conflict.liveId,
        updates: { pipelineConfig: next.pipelineConfig, timeout: next.timeout } as never,
      }).unwrap();
      setApplied((s) => ({ ...s, [key]: 'done' }));
    } catch (e) {
      setApplied((s) => ({
        ...s,
        [key]: e instanceof Error ? e.message : 'Could not apply the app version.',
      }));
    }
  };

  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-3">
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-xs">
          This update changed {conflicts.length === 1 ? 'a field' : 'fields'} you had also edited.
          <strong> Your version was kept</strong> — take the app&apos;s instead only where you want it.
        </AlertDescription>
      </Alert>

      {conflicts.map((conflict) => (
        <div key={ruleLabel(conflict)} className="rounded-md border p-3">
          <p className="font-mono text-xs font-medium">{ruleLabel(conflict)}</p>
          <div className="mt-2 space-y-3">
            {conflict.fields.map((f) => {
              const key = `${conflict.liveId}:${f.field}`;
              const state = applied[key];
              return (
                <div key={f.field} className="space-y-1">
                  <p className="font-mono text-[11px] text-muted-foreground">{f.field}</p>
                  <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Yours</dt>
                    <dd className="font-mono break-all">{preview(f.ours)}</dd>
                    <dt className="text-muted-foreground">App&apos;s</dt>
                    <dd className="font-mono break-all">{preview(f.theirs)}</dd>
                  </dl>
                  {state === 'done' ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3 w-3" /> Using the app&apos;s version
                    </p>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state === 'saving'}
                        onClick={() => resolve(conflict, f.field, f.theirs)}
                      >
                        {state === 'saving' ? 'Applying…' : "Use the app's version"}
                      </Button>
                      {state && state !== 'saving' && (
                        <p role="alert" className="text-xs text-destructive">
                          {state}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
