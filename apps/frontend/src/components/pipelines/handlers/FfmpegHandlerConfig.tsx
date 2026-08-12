import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { FfmpegHandlerConfig as Config, FfmpegOperation } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

const OPERATIONS: { value: FfmpegOperation; label: string; hint: string }[] = [
  {
    value: 'probe',
    label: 'Probe / capability check',
    hint: 'No input: returns {server, ops, version}. With input: duration + streams.',
  },
  {
    value: 'extract_audio',
    label: 'Extract audio (16 kHz WAV)',
    hint: 'The transcription contract: mono, 16 kHz.',
  },
  {
    value: 'slice',
    label: 'Slice (cut kept spans into one clip)',
    hint: 'Heavy — run in postSteps with a job row.',
  },
  {
    value: 'concat',
    label: 'Concat (stitch clips)',
    hint: 'Stream-copy first; re-encodes automatically on mismatch.',
  },
];

/** Config fields each operation actually uses — drives what gets stripped on switch. */
const FIELDS_BY_OPERATION: Record<FfmpegOperation, Array<keyof Config>> = {
  probe: ['input'],
  extract_audio: ['input', 'output'],
  slice: ['input', 'output', 'spans', 'audioOutput', 'audioFades'],
  concat: ['inputs', 'output'],
};

const ALL_OPERATION_FIELDS: Array<keyof Config> = [
  'input',
  'inputs',
  'spans',
  'output',
  'audioOutput',
  'audioFades',
];

export function FfmpegHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typed = config as unknown as Partial<Config>;
  const operation = typed.operation ?? 'probe';

  // Field-level edit within the current operation: patch onto the existing config.
  const update = (partial: Partial<Config>) => {
    onChange({ ...typed, operation, ...partial } as Config);
  };

  // Switching operation strips fields the new operation doesn't use (e.g. slice's
  // `spans`/`audioOutput` when moving to `concat`), so the saved config never
  // strands stale fields from a previous choice — mirrors the mode switch in
  // FileDeleteHandlerConfig.
  const switchOperation = (next: FfmpegOperation) => {
    const keep = new Set(FIELDS_BY_OPERATION[next]);
    const cleared: Record<string, unknown> = { ...typed, operation: next };
    for (const field of ALL_OPERATION_FIELDS) {
      if (!keep.has(field)) delete cleared[field];
    }
    onChange(cleared as unknown as Config);
  };

  const spansText =
    typeof typed.spans === 'string' ? typed.spans : typed.spans ? JSON.stringify(typed.spans) : '';
  const inputsText =
    typeof typed.inputs === 'string' ? typed.inputs : typed.inputs ? JSON.stringify(typed.inputs) : '';

  const hint = OPERATIONS.find((o) => o.value === operation)?.hint;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Operation</Label>
        <Select value={operation} onValueChange={(v) => switchOperation(v as FfmpegOperation)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>

      {operation !== 'concat' && (
        <div className="space-y-2">
          <Label>Input {operation === 'probe' ? '(optional — omit for a capability check)' : ''}</Label>
          <ExpressionInput
            value={typed.input ?? ''}
            onChange={(v) => update({ input: v || undefined })}
            placeholder="steps.upload.storage_path or studio/source.mp4"
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'concat' && (
        <div className="space-y-2">
          <Label>Inputs (JSON array or expression)</Label>
          <ExpressionInput
            value={inputsText}
            onChange={(v) => update({ inputs: v || undefined })}
            placeholder='["studio/s1.mp4", "studio/s2.mp4"] or request.body.parts'
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'slice' && (
        <div className="space-y-2">
          <Label>Spans (JSON array or expression)</Label>
          <ExpressionInput
            value={spansText}
            onChange={(v) => update({ spans: v || undefined })}
            placeholder='[{"start": 0, "end": 12.5}] or request.body.spans'
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation !== 'probe' && (
        <div className="space-y-2">
          <Label>Output path (uploads-relative)</Label>
          <ExpressionInput
            value={typed.output ?? ''}
            onChange={(v) => update({ output: v || undefined })}
            placeholder="studio/clips/{{request.body.jobId}}.mp4"
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'slice' && (
        <>
          <div className="space-y-2">
            <Label>Audio output (optional WAV alongside the clip)</Label>
            <ExpressionInput
              value={typed.audioOutput ?? ''}
              onChange={(v) => update({ audioOutput: v || undefined })}
              placeholder="studio/clips/{{request.body.jobId}}.wav"
              previousSteps={previousSteps}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Audio edge fades</Label>
              <p className="text-xs text-muted-foreground">
                ~10 ms fades per span — use for scene assembly.
              </p>
            </div>
            <Switch
              checked={typed.audioFades === true}
              onCheckedChange={(checked) => update({ audioFades: checked || undefined })}
            />
          </div>
        </>
      )}

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storage_path</code>
          <span className="text-muted-foreground">Where the result was written</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">content_type</code>
          <span className="text-muted-foreground">video/mp4 or audio/wav</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">size</code>
          <span className="text-muted-foreground">Result bytes</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Long encodes belong in postSteps with a job row the client polls; this step has no
          response-time budget there.
        </p>
      </div>
    </div>
  );
}
