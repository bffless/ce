import { Fragment, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  {
    value: 'frames',
    label: 'Frames (stills at given times)',
    hint: 'Clean, unlabelled stills written under the output prefix as frame-01.jpg, frame-02.jpg … (the padding widens past 99); a time past the end of the source fails the step.',
  },
  {
    value: 'contact_sheet',
    label: 'Contact sheet (tiled, clock-labelled stills)',
    hint: 'Heavy — up to 131 ffmpeg/ffprobe commands at the default caps (more if you raise them), so run it in postSteps with a job row; the burned-in clock needs an ffmpeg with drawtext (otherwise cells are un-labelled and labelled is false).',
  },
];

/** Config fields each operation actually uses — drives what gets stripped on switch. */
const FIELDS_BY_OPERATION: Record<FfmpegOperation, Array<keyof Config>> = {
  // `executor` is on every operation — a probe WITH input runs a job too.
  probe: ['input', 'executor'],
  extract_audio: ['input', 'output', 'executor'],
  slice: ['input', 'output', 'spans', 'audioOutput', 'audioFades', 'executor'],
  concat: ['inputs', 'output', 'executor'],
  frames: ['input', 'outputPrefix', 'times', 'height', 'quality', 'executor'],
  contact_sheet: [
    'input',
    'outputPrefix',
    'duration',
    'interval',
    'columns',
    'cellsPerSheet',
    'maxSheets',
    'height',
    'label',
    'executor',
  ],
};

/** Deduped union of every field referenced above — kept in sync automatically. */
const ALL_OPERATION_FIELDS: Array<keyof Config> = Array.from(
  new Set(Object.values(FIELDS_BY_OPERATION).flat()),
);

/**
 * The string forms the BACKEND's `boolKnob` treats as false
 * (apps/backend/src/pipelines/handlers/ffmpeg.handler.ts). Pipeline config
 * arrives as YAML/JSON, so `label: 'off'` is reachable and runs as OFF — the
 * admin toggle has to agree with the runtime or it shows the opposite of what
 * the step does. Kept as one list feeding one predicate rather than an inline
 * comparison per call site.
 */
const FALSE_STRINGS = ['false', '0', 'no', 'off'];
/** ...and the ones it treats as true. Anything else is a ConfigurationError, not a default. */
const TRUE_STRINGS = ['true', '1', 'yes', 'on'];

/**
 * `label`'s effective value, mirroring `boolKnob(config.label, 'label', true)`.
 *
 * Tri-state on purpose. `boolKnob` THROWS for a value that is neither a boolean
 * nor one of the eight known strings — `label: 0` is the reachable case, since
 * YAML/JSON authors reach for it as a falsy value — so there is no "runs as"
 * boolean to show. Returning a plain `true` there would render a confident ON
 * for a step that hard-fails before it ever burns a label.
 */
function labelState(value: unknown): 'on' | 'off' | 'invalid' {
  if (value === undefined || value === null || value === '') return 'on'; // boolKnob's fallback
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (TRUE_STRINGS.includes(v)) return 'on';
    if (FALSE_STRINGS.includes(v)) return 'off';
  }
  return 'invalid';
}

/**
 * Mirrors `MAX_STILLS_PER_JOB` in
 * apps/backend/src/pipelines/handlers/ffmpeg.handler.ts — keep both in sync.
 * The frontend cannot import it: its tsconfig `include` is `src` and its only
 * path alias is `@/*` → `./src/*`, so there is no cross-package module
 * resolution. Same convention the app-catalog and permissions mirrors use
 * (services/appCatalogApi.ts, services/meApi.ts).
 */
const MAX_STILLS_PER_JOB = 200;

/**
 * The operation-specific half of the "Step output" legend.
 *
 * INDEXED DEFENSIVELY at the call site (`?? []`). TypeScript types a closed
 * `Record<FfmpegOperation, …>` lookup as non-optional, but `operation` comes
 * from `config` — a `Record<string, unknown>` holding whatever JSON was saved
 * — and CE has no save-time handler validation (`validateConfig` runs only
 * immediately before `execute`). So an agent-authored `operation:
 * "contactSheet"` saves cleanly, and opening that step in Admin would render
 * with a key that is in no map. There is no error boundary under
 * components/pipelines/, so an unguarded `.map` here white-screens the whole
 * admin SPA via the app-level fallback in App.tsx, not just this editor. `executor`/`timings`
 * are on every operation and are rendered separately, so they are not repeated
 * here. frames/contact_sheet write a DIRECTORY, so their output is an array of
 * stills rather than the single storage_path the other operations return.
 */
const OUTPUT_FIELDS: Record<FfmpegOperation, Array<[string, string]>> = {
  probe: [
    ['server', 'No input: whether server video ops are available'],
    ['duration', 'With input: source seconds'],
    ['format', 'With input: container essentials'],
    ['streams', 'With input: video/audio stream essentials'],
  ],
  extract_audio: [
    ['storage_path', 'Where the result was written'],
    ['content_type', 'audio/wav'],
    ['size', 'Result bytes'],
  ],
  slice: [
    ['storage_path', 'Where the result was written'],
    ['content_type', 'video/mp4'],
    ['size', 'Result bytes'],
    ['duration', 'Kept seconds, summed across the spans'],
    ['audio', 'Only with audioOutput: {storage_path, content_type, size} for the WAV'],
  ],
  concat: [
    ['storage_path', 'Where the result was written'],
    ['content_type', 'video/mp4'],
    ['size', 'Result bytes'],
    ['reencoded', 'True when the stream-copy failed and CE re-encoded'],
  ],
  frames: [
    ['frames', 'One {time, storage_path, content_type, size} per requested time'],
    ['storage_path', 'The FULL key: {owner}/{repo}/uploads/<prefix>/frame-01.jpg'],
    ['count', 'How many stills were written'],
  ],
  contact_sheet: [
    ['sheets', 'One {storage_path, content_type, size, times, index, total, cols, rows} per sheet'],
    ['storage_path', 'The FULL key: {owner}/{repo}/uploads/<prefix>/sheet-01.jpg'],
    ['interval', 'Actual seconds between sampled cells'],
    ['count', 'Total cells sampled across every sheet'],
    ['labelled', 'False when labels were off, or this ffmpeg had no drawtext'],
  ],
};

export function FfmpegHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typed = config as unknown as Partial<Config>;
  const operation = typed.operation ?? 'probe';

  // Seed the default operation into the saved config on mount. The Select below
  // renders 'probe' for an empty config, but onValueChange only fires on a real
  // selection change — so without this, a step left on the default (no other
  // field touched) would save `{}` and fail at execution time with "ffmpeg_handler
  // requires operation". Mirrors FunctionHandlerConfig's default-code seeding.
  useEffect(() => {
    if (typed.operation === undefined) {
      onChange({ ...typed, operation: 'probe' } as Config);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only seed, not a sync effect

  // Field-level edit within the current operation: patch onto the existing config.
  const update = (partial: Partial<Config>) => {
    onChange({ ...typed, operation, ...partial } as Config);
  };

  // Switching operation strips fields the new operation doesn't use (e.g. slice's
  // `spans`/`audioOutput` when moving to `concat`), so the saved config never
  // strands stale fields from a previous choice — mirrors the mode switch in
  // FileDeleteHandlerConfig.
  const switchOperation = (next: FfmpegOperation) => {
    // Safe unguarded, unlike the OUTPUT_FIELDS lookup: `next` only ever comes
    // from the Select below, whose items ARE the six FIELDS_BY_OPERATION keys —
    // it is never the saved config's value. (And `new Set(undefined)` yields an
    // empty set rather than throwing, so a future caller degrades to stripping
    // every field instead of crashing.)
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
    typeof typed.inputs === 'string'
      ? typed.inputs
      : typed.inputs
        ? JSON.stringify(typed.inputs)
        : '';

  const timesText =
    typeof typed.times === 'string' ? typed.times : typed.times ? JSON.stringify(typed.times) : '';

  const hint = OPERATIONS.find((o) => o.value === operation)?.hint;

  const stills = operation === 'frames' || operation === 'contact_sheet';
  // Empty input ⇒ undefined (fall back to the handler's default), never 0/NaN.
  const numeric = (value: string) => (value === '' ? undefined : Number(value));

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
          <Label>
            Input {operation === 'probe' ? '(optional — omit for a capability check)' : ''}
          </Label>
          <ExpressionInput
            value={typed.input ?? ''}
            onChange={(v) => update({ input: v || undefined })}
            placeholder="{{steps.upload.storage_path}} or studio/source.mp4"
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

      {operation !== 'probe' && !stills && (
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

      {stills && (
        <div className="space-y-2">
          <Label>Output prefix (uploads-relative directory)</Label>
          <ExpressionInput
            value={typed.outputPrefix ?? ''}
            onChange={(v) => update({ outputPrefix: v || undefined })}
            placeholder="studio/sheets/{{request.body.jobId}}"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            A directory, not a file. Like <code>Input</code>, it is a TEMPLATE:{' '}
            <code>{'{{steps.x.y}}'}</code> is substituted and anything else is used verbatim. Treat
            each run's prefix as disposable.
          </p>
        </div>
      )}

      {operation === 'frames' && (
        <div className="space-y-2">
          <Label>Times in seconds (JSON array or expression)</Label>
          <ExpressionInput
            value={timesText}
            onChange={(v) => update({ times: v || undefined })}
            placeholder="[1.5, 30, 92] or steps.pick.times"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            An EXPRESSION, not a template: write <code>steps.pick.times</code> bare —{' '}
            <code>{'{{steps.pick.times}}'}</code> is read as a literal string and fails. At most{' '}
            {MAX_STILLS_PER_JOB} stills per step, checked when the step RUNS. A time past the end of
            the source fails the step.
          </p>
        </div>
      )}

      {operation === 'contact_sheet' && (
        <div className="space-y-2">
          <Label>Duration in seconds (optional)</Label>
          <ExpressionInput
            value={
              typeof typed.duration === 'number' ? String(typed.duration) : (typed.duration ?? '')
            }
            onChange={(v) => update({ duration: v || undefined })}
            placeholder="steps.probe.duration"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            An EXPRESSION, not a template: write <code>steps.probe.duration</code> bare, never{' '}
            <code>{'{{...}}'}</code>. Blank means CE runs an ffprobe job first, which downloads the
            source a second time — pass a known duration for large sources.
          </p>
        </div>
      )}

      {stills && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Height in px</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={typed.height ?? ''}
              onChange={(e) => update({ height: numeric(e.target.value) })}
              placeholder="720"
            />
            <p className="text-xs text-muted-foreground">
              Width follows the aspect ratio. Default 720; 360-1080 is the useful range, though
              nothing caps it. A literal number — expressions are not resolved here.
            </p>
          </div>

          {operation === 'frames' && (
            <div className="space-y-2">
              <Label>JPEG quality (2-31)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={typed.quality ?? ''}
                onChange={(e) => update({ quality: numeric(e.target.value) })}
                placeholder="3"
              />
              <p className="text-xs text-muted-foreground">
                ffmpeg <code>-q:v</code>: 2 = best, 31 = worst. Default 3. Only checked for being a
                positive integer, so 500 is accepted and reaches ffmpeg verbatim.
              </p>
            </div>
          )}

          {operation === 'contact_sheet' && (
            <div className="space-y-2">
              <Label>Sampling interval in seconds</Label>
              <Input
                type="number"
                // The backend's `knob(..., 'number')` accepts ANY positive number, which HTML's
                // inclusive `min` cannot express (`min={0}` would wrongly allow 0). 0.1 s is the
                // practical floor for a sampling interval measured in seconds; the backend
                // remains the real gate and rejects anything <= 0 with a typed ConfigurationError.
                min={0.1}
                step="any"
                value={typed.interval ?? ''}
                onChange={(e) => update({ interval: numeric(e.target.value) })}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                The density floor on short clips. Default 5; long clips are still sampled at least
                every 30s until the sheet budget forces wider.
              </p>
            </div>
          )}
        </div>
      )}

      {operation === 'contact_sheet' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Columns</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={typed.columns ?? ''}
                onChange={(e) => update({ columns: numeric(e.target.value) })}
                placeholder="3"
              />
            </div>
            <div className="space-y-2">
              <Label>Cells per sheet</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={typed.cellsPerSheet ?? ''}
                onChange={(e) => update({ cellsPerSheet: numeric(e.target.value) })}
                placeholder="12"
              />
            </div>
            <div className="space-y-2">
              <Label>Max sheets</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={typed.maxSheets ?? ''}
                onChange={(e) => update({ maxSheets: numeric(e.target.value) })}
                placeholder="10"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Defaults 3 / 12 / 10 (the planner prefers 9 cells and only packs to the cap when the
            sheet budget forces it). Cells per sheet x max sheets may not exceed{' '}
            {MAX_STILLS_PER_JOB} — this form does not enforce that, and neither does saving: the
            step fails the first time it RUNS.
          </p>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Burn in the m:ss clock</Label>
              <p className="text-xs text-muted-foreground">
                Needs an ffmpeg with <code>drawtext</code>; one without it falls back to un-labelled
                cells and reports <code>labelled: false</code>.
              </p>
              {labelState(typed.label) === 'invalid' && (
                <p className="text-xs text-destructive">
                  Saved as <code>{JSON.stringify(typed.label)}</code>, which is neither a boolean
                  nor one of true/false/1/0/yes/no/on/off — this step will fail when it runs. Toggle
                  the switch to replace it.
                </p>
              )}
            </div>
            <Switch
              checked={labelState(typed.label) === 'on'}
              onCheckedChange={(checked) => update({ label: checked })}
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label>Executor (optional)</Label>
        <ExpressionInput
          value={typed.executor ?? ''}
          onChange={(v) => update({ executor: v || undefined })}
          placeholder="local | remote | {{expression}}"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank for the instance default. <code>local</code> runs ffmpeg on this server;{' '}
          <code>remote</code> sends the job to the configured worker (bucket storage only).
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          {(OUTPUT_FIELDS[operation] ?? []).map(([field, meaning]) => (
            <Fragment key={field}>
              <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{field}</code>
              <span className="text-muted-foreground">{meaning}</span>
            </Fragment>
          ))}
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">executor</code>
          <span className="text-muted-foreground">Which executor ran it (local/remote)</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">timings</code>
          <span className="text-muted-foreground">queue/transfer/ffmpeg/total ms</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Long encodes belong in postSteps with a job row the client polls; this step has no
          response-time budget there.
        </p>
      </div>
    </div>
  );
}
