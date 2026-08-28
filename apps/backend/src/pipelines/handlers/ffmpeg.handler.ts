import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import * as path from 'path';
import { StepHandler, FfmpegHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { FfmpegCapabilityService } from '../ffmpeg/ffmpeg-capability.service';
import { FfmpegRunnerService } from '../ffmpeg/ffmpeg-runner.service';
import { FfmpegScratchService } from '../ffmpeg/ffmpeg-scratch.service';
import { withDeadline } from '../ffmpeg/with-deadline';
import { LocalFfmpegExecutor } from '../ffmpeg/executor/local-ffmpeg.executor';
import { RemoteFfmpegExecutor } from '../ffmpeg/executor/remote/remote-ffmpeg.executor';
import { FfmpegExecutorSelector, ffmpegFlagOn } from '../ffmpeg/executor/ffmpeg-executor.selector';
import type {
  FfmpegExecutor,
  FfmpegJob,
  FfmpegJobCommand,
  FfmpegJobOutput,
  FfmpegJobResult,
} from '../ffmpeg/executor/ffmpeg-executor.interface';
import { UploadRecordService } from '../upload-record.service';
import {
  buildExtractAudioArgs,
  buildProbeArgs,
  buildSliceArgs,
  buildConcatArgs,
  buildConcatListContent,
  buildFrameArgs,
  buildTileArgs,
  planContactSheet,
  clockLabel,
  MAX_SHEETS,
  MAX_CELLS_PER_SHEET,
} from '../ffmpeg/ffmpeg-args';
import { readFfmpegEnv } from '../ffmpeg/ffmpeg-env';

const OPERATIONS = [
  'probe',
  'extract_audio',
  'slice',
  'concat',
  'frames',
  'contact_sheet',
] as const;

/**
 * Hard ceiling on stills one step may ask for — `times.length` for `frames`,
 * `maxSheets × cellsPerSheet` for `contact_sheet`. Both are reachable from
 * untrusted config (`times` is expression-resolvable, so `request.body.times`
 * is an advertised form), and each still is a sequential ffmpeg spawn whose
 * output piles up in scratch BEFORE anything is uploaded — the local disk
 * pre-flight only reserves `2 × input + margin` and does not model outputs,
 * and the remote path puts one presigned PUT URL per output in a single
 * envelope that the Worker caps at 1 MB. The planner's own natural maximum is
 * 120 stills, so this is deliberately generous: it exists to stop a runaway,
 * not to shape normal use.
 */
export const MAX_STILLS_PER_JOB = 200;

/** Defaults for the still-image knobs (frames/contact_sheet). */
const DEFAULT_FRAME_HEIGHT = 720;
const DEFAULT_FRAME_QUALITY = 3;
/** Contact-sheet cells are always q:v 3 — they are tiled down, and `quality` is the `frames` knob. */
const CELL_QUALITY = 3;
/** Ruling R80: every still is a cheap, bounded command, so none of them may hold the queue. */
const FRAME_TIMEOUT_SECONDS = 120;
const PROBE_TIMEOUT_SECONDS = 60;

/**
 * A job that failed because this ffmpeg has no `drawtext` — the ONLY failure a
 * contact sheet retries (un-labelled). Anything else is a real failure and
 * propagates untouched.
 */
function isDrawtextFailure(error: unknown): boolean {
  const e = error as { code?: string; stderrTail?: string };
  if (e?.code !== 'FFMPEG_FAILED') return false;
  // ffmpeg's OWN stderr only. Not `error.message`: that carries CE-side text
  // including paths, so an input named `.../drawtext-demo.mp4` failing for any
  // reason would trigger a pointless un-labelled re-run of a 130-command job.
  return /drawtext|no such filter/i.test(e.stderrTail ?? '');
}

/**
 * ffmpeg_handler — see the FfmpegHandlerConfig TSDoc in step-handler.interface.ts
 * for the authoritative operation reference.
 *
 * The handler resolves config to storage keys and expresses each operation as an
 * `FfmpegJob` (named scratch files + argv commands over one scratch dir); an
 * `FfmpegExecutor` materialises and runs it. Everything about WHERE ffmpeg runs
 * lives behind that seam.
 */
@Injectable()
export class FfmpegHandler implements StepHandler<FfmpegHandlerConfig> {
  readonly type = 'ffmpeg_handler' as const;
  private readonly logger = new Logger(FfmpegHandler.name);
  /** Where a step's job runs — see FfmpegExecutorSelector. */
  private readonly executors: FfmpegExecutorSelector;

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly capability: FfmpegCapabilityService,
    runner: FfmpegRunnerService,
    scratch: FfmpegScratchService,
    private readonly uploadRecord: UploadRecordService,
    @Inject(STORAGE_ADAPTER) storageAdapter: IStorageAdapter,
    @Optional() selector?: FfmpegExecutorSelector,
  ) {
    // Directly-constructed handlers (unit tests) get a selector built from the
    // same collaborators, so behaviour matches the injected wiring exactly.
    this.executors =
      selector ??
      new FfmpegExecutorSelector(
        new LocalFfmpegExecutor(runner, scratch, storageAdapter),
        new RemoteFfmpegExecutor(storageAdapter),
        capability,
      );
    this.registry.register(this);
  }

  validateConfig(config: FfmpegHandlerConfig): void {
    if (!config || !OPERATIONS.includes(config.operation)) {
      throw new ConfigurationError(
        `ffmpeg_handler requires operation: one of ${OPERATIONS.join(', ')}`,
        'ffmpeg_handler',
      );
    }
    const need = (field: keyof FfmpegHandlerConfig, ops: string[]) => {
      if (ops.includes(config.operation) && !config[field]) {
        throw new ConfigurationError(
          `ffmpeg_handler ${config.operation} requires ${String(field)}`,
          'ffmpeg_handler',
        );
      }
    };
    need('input', ['extract_audio', 'slice', 'frames', 'contact_sheet']);
    need('spans', ['slice']);
    need('times', ['frames']);
    need('inputs', ['concat']);
    need('output', ['extract_audio', 'slice', 'concat']);
    need('outputPrefix', ['frames', 'contact_sheet']);
    // Numeric knobs are validated here, at the boundary where untrusted config
    // enters — not in the pure builders, which cannot report a config error.
    // Scoped to the two ops that read them, so a pre-existing slice/concat step
    // carrying a stray field is not newly rejected.
    if (config.operation === 'frames' || config.operation === 'contact_sheet') {
      const knobs = this.knobs(config);
      if (config.operation === 'contact_sheet') {
        // Static, unlike `frames`' expression-resolved `times`, so it is a
        // configuration error rather than a runtime one.
        const budget =
          (knobs.maxSheets ?? MAX_SHEETS) * (knobs.cellsPerSheet ?? MAX_CELLS_PER_SHEET);
        if (budget > MAX_STILLS_PER_JOB) {
          throw new ConfigurationError(
            `ffmpeg_handler contact_sheet maxSheets × cellsPerSheet is ${budget}, over the ${MAX_STILLS_PER_JOB}-still ceiling for one step (MAX_STILLS_PER_JOB)`,
            'ffmpeg_handler',
          );
        }
      }
    }
  }

  /**
   * Coerce one untrusted numeric knob. Pipeline config is authored as YAML/JSON
   * by a user, so `2.5`, `"3"`, `true` and `"tall"` are all reachable here, and
   * a bad value would otherwise reach argv verbatim (`tile=2.5x2`,
   * `scale=-2:0`) where only ffmpeg itself rejects it — at run time, long after
   * the step looked valid. `undefined` means "not set": the caller defaults it.
   */
  private knob(value: unknown, field: string, kind: 'integer' | 'number'): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
    if (!Number.isFinite(n) || n <= 0 || (kind === 'integer' && !Number.isInteger(n))) {
      throw new ConfigurationError(
        `ffmpeg_handler ${field} must be a positive ${kind} (got ${JSON.stringify(value)})`,
        'ffmpeg_handler',
      );
    }
    return n;
  }

  /**
   * The boolean twin of `knob`. Config reaches us as YAML/JSON, and this very
   * diff teaches authors that strings are accepted for the numeric knobs — so
   * `label: 'false'` must turn labels OFF rather than being silently truthy.
   */
  private boolKnob(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(v)) return true;
      if (['false', '0', 'no', 'off'].includes(v)) return false;
    }
    throw new ConfigurationError(
      `ffmpeg_handler ${field} must be a boolean (got ${JSON.stringify(value)})`,
      'ffmpeg_handler',
    );
  }

  /** Every knob of frames/contact_sheet. Called from validateConfig AND from the ops (defence in depth: a directly-executed step skips validation). */
  private knobs(config: FfmpegHandlerConfig) {
    return {
      height: this.knob(config.height, 'height', 'integer') ?? DEFAULT_FRAME_HEIGHT,
      quality: this.knob(config.quality, 'quality', 'integer') ?? DEFAULT_FRAME_QUALITY,
      // The remaining four are the planner's knobs: leaving them undefined lets
      // planContactSheet apply its own documented defaults, in one place.
      interval: this.knob(config.interval, 'interval', 'number'),
      columns: this.knob(config.columns, 'columns', 'integer'),
      cellsPerSheet: this.knob(config.cellsPerSheet, 'cellsPerSheet', 'integer'),
      maxSheets: this.knob(config.maxSheets, 'maxSheets', 'integer'),
      label: this.boolKnob(config.label, 'label', true),
    };
  }

  /** The step's own cap breach, typed so the message names both the ceiling and what was asked for. */
  private tooManyStills(what: string, asked: number): never {
    throw Object.assign(
      new Error(
        `ffmpeg_handler ${what} is ${asked}, over the ${MAX_STILLS_PER_JOB}-still ceiling for one step (MAX_STILLS_PER_JOB)`,
      ),
      { code: 'INVALID_TIMES' },
    );
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FfmpegHandlerConfig;
    const stepName = step.name || 'ffmpeg_handler';

    if (config.operation === 'probe' && !config.input) {
      // Capability self-test — the /api/video/capabilities payload. Never fails.
      return { success: true, output: await this.executors.probe() };
    }

    // The operator's flag only: a remote-only instance has no local binaries and
    // must still run steps, so this must NOT be the binaries-aware isEnabled().
    if (!(await ffmpegFlagOn(this.capability))) {
      return {
        success: false,
        error: {
          code: 'FFMPEG_UNAVAILABLE',
          message:
            'server video ops are disabled on this instance (enable them in Admin Settings → Features, or ffmpeg is missing)',
        },
      };
    }

    // One ceiling over the WHOLE step — key resolution, storage transfers, the
    // queue wait and ffmpeg together — not just the spawned process (that's the
    // runner's watchdog). Every await around the process used to be unbounded,
    // so one stalled await left the step pending forever: fatal for an async
    // job, whose row stays 'running' with nothing to end it but the client's own
    // poll timeout. A post-step that never settles also suppresses the execution
    // log on rules that persist one, since the log write awaits the post-steps
    // promise (#669). The controller is per-step (this handler is a singleton
    // serving concurrent steps) and lets an executor cancel work it can cancel.
    const controller = new AbortController();
    const { signal } = controller;
    const op = async (): Promise<StepResult> => {
      // Inside the deadline: picking an executor can touch the network (the
      // remote readiness probe), and that await must be bounded like the rest.
      const executor = await this.executors.pick(this.requestedExecutor(config, context, stepName));
      switch (config.operation) {
        case 'probe':
          return this.runProbe(config, context, stepName, executor, signal);
        case 'extract_audio':
          return this.runExtractAudio(config, context, stepName, executor, signal);
        case 'slice':
          return this.runSlice(config, context, stepName, executor, signal);
        case 'concat':
          return this.runConcat(config, context, stepName, executor, signal);
        case 'frames':
          return this.runFrames(config, context, stepName, executor, signal);
        case 'contact_sheet':
          return this.runContactSheet(config, context, stepName, executor, signal);
      }
    };
    try {
      return await withDeadline(
        op(),
        readFfmpegEnv().jobMaxSeconds,
        `${config.operation} step`,
        () => controller.abort(),
      );
    } catch (error) {
      return this.toErrorResult(error, stepName);
    }
  }

  /**
   * `config.executor` as a name the selector understands, or undefined for "the
   * instance default". Template-resolved like `input`/`output`, so it can be
   * `remote`, `{{request.body.executor}}`, or `{{steps.decide.executor}}`.
   */
  private requestedExecutor(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): string | undefined {
    if (!config.executor) return undefined;
    return (
      this.expressionEvaluator.evaluateTemplate(config.executor, context, stepName).trim() ||
      undefined
    );
  }

  /**
   * Run one job on the chosen executor. The step ceiling that makes #669 hold
   * lives in `execute`, wrapped around the whole op — `signal` is the abort it
   * raises on breach, threaded through so an executor that CAN cancel (remote)
   * does; the local one runs to completion and is simply abandoned.
   */
  private async runJob(
    executor: FfmpegExecutor,
    job: FfmpegJob,
    signal: AbortSignal,
  ): Promise<FfmpegJobResult> {
    return executor.run(job, { signal });
  }

  /** Additive observability fields (D11) — present on every op output. */
  private telemetry(res: FfmpegJobResult) {
    return {
      executor: res.executor,
      timings: res.timings,
      bytesIn: res.bytesIn,
      bytesOut: res.bytesOut,
    };
  }

  /** Map typed runner/scratch errors onto the stable error-code contract. */
  private toErrorResult(error: unknown, stepName: string): StepResult {
    const code = (error as { code?: string }).code;
    const known = [
      'FFMPEG_BUSY',
      'FFMPEG_INSUFFICIENT_MEMORY',
      'FFMPEG_INSUFFICIENT_DISK',
      'FFMPEG_TIMEOUT',
      'FFMPEG_JOB_TIMEOUT',
      'FFMPEG_EXECUTOR_UNAVAILABLE',
      'FFMPEG_FAILED',
      'INVALID_INPUT_PATH',
      'INVALID_OUTPUT_PATH',
      'INVALID_SPANS',
      'INVALID_TIMES',
      // A knob that slipped past validateConfig (a directly-executed step)
      // fails as the configuration error it is, not as a mystery ffmpeg crash.
      'CONFIGURATION_ERROR',
      'FILE_NOT_FOUND',
    ];
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn({ event: 'ffmpeg_step_failed', step: stepName, code, message });
    return {
      success: false,
      error: { code: known.includes(code ?? '') ? code! : 'FFMPEG_FAILED', message },
    };
  }

  private pathError(code: 'INVALID_INPUT_PATH' | 'INVALID_OUTPUT_PATH', message: string): never {
    throw Object.assign(new Error(message), { code });
  }

  /**
   * Resolve a template to a storage key confined to the project's uploads root.
   * Accepts `/api/uploads/<rel>`, `{owner}/{repo}/uploads/<rel>`, or `<rel>`.
   * Guards per file-delete.handler.ts: reject blank, `..`, `//`, and any
   * normalized escape from the uploads root.
   */
  private async resolveKey(
    expr: string,
    context: PipelineContext,
    stepName: string,
    kind: 'input' | 'output',
  ): Promise<string> {
    const code =
      kind === 'input' ? ('INVALID_INPUT_PATH' as const) : ('INVALID_OUTPUT_PATH' as const);
    const resolved = String(
      this.expressionEvaluator.evaluateTemplate(expr, context, stepName) ?? '',
    ).trim();
    if (!resolved) this.pathError(code, `ffmpeg_handler ${kind} resolved to an empty path`);
    if (resolved.includes('..') || resolved.includes('//')) {
      this.pathError(code, `ffmpeg_handler ${kind} contains path traversal: ${resolved}`);
    }
    const { owner, repo } = await this.uploadRecord.resolveOwnerRepo(context, stepName);
    const uploadsRoot = `${owner}/${repo}/uploads/`;
    let relative: string;
    if (resolved.startsWith('/api/uploads/')) {
      relative = resolved.slice('/api/uploads/'.length);
    } else if (resolved.startsWith(uploadsRoot)) {
      relative = resolved.slice(uploadsRoot.length);
    } else {
      relative = resolved.replace(/^\/+/, '');
    }
    const key = `${uploadsRoot}${relative}`;
    // Defense-in-depth backstop (confineToRoot semantics, file-delete.handler.ts:205)
    const normalized = path.posix.normalize(key);
    if (!normalized.startsWith(uploadsRoot)) {
      this.pathError(code, `ffmpeg_handler ${kind} escapes the uploads root: ${resolved}`);
    }
    return normalized;
  }

  private async runProbe(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
    const res = await this.runJob(
      executor,
      {
        id: stepName,
        commands: [
          {
            id: 'probe',
            kind: 'ffprobe',
            argv: buildProbeArgs(`{in:${inName}}`),
            timeoutSeconds: 60, // probe is cheap; never let it hold the queue long
          },
        ],
        inputs: [{ name: inName, key: inputKey }],
        outputs: [],
        files: [],
      },
      signal,
    );
    const parsed = JSON.parse(res.stdout) as {
      format?: { duration?: string };
      streams?: unknown[];
    };
    return {
      success: true,
      output: {
        duration: Number(parsed.format?.duration ?? 0),
        format: parsed.format ?? {},
        streams: parsed.streams ?? [],
        ...this.telemetry(res),
      },
    };
  }

  private async runExtractAudio(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
    const res = await this.runJob(
      executor,
      {
        id: stepName,
        commands: [
          {
            id: 'extract',
            kind: 'ffmpeg',
            argv: buildExtractAudioArgs(`{in:${inName}}`, '{out:out.wav}'),
          },
        ],
        inputs: [{ name: inName, key: inputKey }],
        outputs: [{ name: 'out.wav', key: outputKey, contentType: 'audio/wav' }],
        files: [],
      },
      signal,
    );
    return {
      success: true,
      output: {
        storage_path: outputKey,
        content_type: 'audio/wav',
        size: res.outputs[0].bytes,
        ...this.telemetry(res),
      },
    };
  }

  /** Resolve config.spans (array of literal/expression values, or an expression yielding an array). */
  private resolveSpans(
    raw: FfmpegHandlerConfig['spans'],
    context: PipelineContext,
    stepName: string,
  ): Array<{ start: number; end: number }> {
    const fail = (msg: string): never => {
      throw Object.assign(new Error(`ffmpeg_handler spans invalid: ${msg}`), {
        code: 'INVALID_SPANS',
      });
    };
    let list: unknown = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      let parsedAsJson = false;
      if (trimmed.startsWith('[')) {
        try {
          list = JSON.parse(trimmed);
          parsedAsJson = true;
        } catch {
          // Not valid JSON — fall through to expression evaluation below.
        }
      }
      if (!parsedAsJson) {
        list = this.expressionEvaluator.evaluateExpression(raw, context, stepName);
      }
    }
    if (!Array.isArray(list) || list.length === 0) fail('expected a non-empty array');
    return (list as Array<{ start: unknown; end: unknown }>).map((s, i) => {
      const resolve = (v: unknown): number => {
        const value =
          typeof v === 'string'
            ? this.expressionEvaluator.evaluateExpression(v, context, stepName)
            : v;
        const n = Number(value);
        if (!Number.isFinite(n)) fail(`span ${i} has a non-numeric bound`);
        return n;
      };
      const start = resolve(s.start);
      const end = resolve(s.end);
      if (start < 0 || end <= start)
        fail(`span ${i} must satisfy 0 <= start < end (got ${start}..${end})`);
      return { start, end };
    });
  }

  /**
   * Resolve config.times (array of literal/expression values, or an expression
   * yielding an array) into capture seconds — the `frames` twin of resolveSpans.
   */
  private resolveTimes(
    raw: FfmpegHandlerConfig['times'],
    context: PipelineContext,
    stepName: string,
  ): number[] {
    const fail = (msg: string): never => {
      throw Object.assign(new Error(`ffmpeg_handler times invalid: ${msg}`), {
        code: 'INVALID_TIMES',
      });
    };
    let list: unknown = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      let parsedAsJson = false;
      if (trimmed.startsWith('[')) {
        try {
          list = JSON.parse(trimmed);
          parsedAsJson = true;
        } catch {
          // Not valid JSON — fall through to expression evaluation below.
        }
      }
      if (!parsedAsJson) {
        list = this.expressionEvaluator.evaluateExpression(raw, context, stepName);
      }
    }
    if (!Array.isArray(list) || list.length === 0) fail('expected a non-empty array');
    return (list as unknown[]).map((v, i) => {
      const value =
        typeof v === 'string'
          ? this.expressionEvaluator.evaluateExpression(v, context, stepName)
          : v;
      const n = Number(value);
      if (!Number.isFinite(n)) fail(`time ${i} is not a number`);
      if (n < 0) fail(`time ${i} must be >= 0 (got ${n})`);
      return n;
    });
  }

  /** `outputPrefix` as a storage key with no trailing slash, so `${prefix}/${name}` never doubles it. */
  private async resolvePrefix(
    expr: string,
    context: PipelineContext,
    stepName: string,
  ): Promise<string> {
    return (await this.resolveKey(expr, context, stepName, 'output')).replace(/\/+$/, '');
  }

  /** contact_sheet's duration, typed: a bad one fails as INVALID_TIMES naming `duration`, not as an unexplained ffmpeg crash. */
  private assertDuration(n: number): number {
    if (!Number.isFinite(n) || n <= 0) {
      throw Object.assign(
        new Error(`ffmpeg_handler contact_sheet needs a positive duration (got ${n})`),
        { code: 'INVALID_TIMES' },
      );
    }
    return n;
  }

  /**
   * ffmpeg writes NO output file when a seek lands past the end of the source,
   * so the local executor stats a file that was never created and throws a bare
   * `ENOENT … stat '/tmp/<scratch>/frame-03.jpg'` — a message that names a
   * scratch path the pipeline author has never heard of. Re-throw it naming the
   * operation, the output that is missing and the likely cause. The remote
   * executor reports its own missing-output failure from the Worker, which this
   * cannot reach (ADR-0004 keeps the Worker a dumb argv runner); when the shape
   * does not match, the original error passes through untouched.
   */
  private namedOutputFailure(error: unknown, op: string, names: string[]): unknown {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ENOENT|no such file/i.test(message)) return error;
    const missing = names.find((name) => message.includes(name));
    if (!missing) return error;
    return Object.assign(
      new Error(
        `ffmpeg_handler ${op} produced no ${missing}: ffmpeg wrote no frame there, which usually means the requested time is past the end of the source (${message})`,
      ),
      { code: 'FFMPEG_FAILED' },
    );
  }

  /**
   * One still per requested time, written under `outputPrefix`. The stills are
   * deliberately CLEAN — no burned-in label — because the point of writing them
   * to storage is that a later step re-captures a moment from the source
   * instead of cropping it out of a contact sheet.
   */
  private async runFrames(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const knobs = this.knobs(config);
    const times = this.resolveTimes(config.times, context, stepName);
    // `times` is expression-resolved, so its length is untrusted input.
    if (times.length > MAX_STILLS_PER_JOB) this.tooManyStills('frames times', times.length);
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const prefix = await this.resolvePrefix(config.outputPrefix!, context, stepName);
    const inName = `in${path.posix.extname(inputKey) || '.mp4'}`;
    // Ruling R82: ONE pad width for the whole batch, widened past 99 frames, so
    // the names stay sortable instead of jumping from frame-99 to frame-100.
    const pad = Math.max(2, String(times.length).length);
    const names = times.map((_, i) => `frame-${String(i + 1).padStart(pad, '0')}.jpg`);
    const commands: FfmpegJobCommand[] = times.map((time, i) => ({
      id: names[i].replace(/\.jpg$/, ''),
      kind: 'ffmpeg',
      timeoutSeconds: FRAME_TIMEOUT_SECONDS,
      argv: buildFrameArgs({
        input: `{in:${inName}}`,
        output: `{out:${names[i]}}`,
        time,
        height: knobs.height,
        quality: knobs.quality,
      }),
    }));
    let res: FfmpegJobResult;
    try {
      res = await this.runJob(
        executor,
        {
          id: stepName,
          commands,
          // Only the stills. Nothing else is declared, so nothing else uploads.
          outputs: names.map((name) => ({
            name,
            key: `${prefix}/${name}`,
            contentType: 'image/jpeg',
          })),
          inputs: [{ name: inName, key: inputKey }],
          files: [],
        },
        signal,
      );
    } catch (error) {
      throw this.namedOutputFailure(error, 'frames', names);
    }
    const bytes = new Map(res.outputs.map((o) => [o.name, o.bytes]));
    return {
      success: true,
      output: {
        frames: times.map((time, i) => ({
          // The REQUESTED time, unchanged — it is what a re-capture seeks to.
          time,
          storage_path: `${prefix}/${names[i]}`,
          content_type: 'image/jpeg',
          size: bytes.get(names[i]) ?? 0,
        })),
        count: times.length,
        ...this.telemetry(res),
      },
    };
  }

  /**
   * Sample the whole clip and tile the samples into timestamped sheets an LLM
   * reads as visual context. Two jobs at most: an ffprobe for the duration
   * (only when config omits it) and one job that captures every cell and then
   * tiles them, in that order, over a single scratch dir.
   */
  private async runContactSheet(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const knobs = this.knobs(config);
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const prefix = await this.resolvePrefix(config.outputPrefix!, context, stepName);
    const inName = `in${path.posix.extname(inputKey) || '.mp4'}`;
    const inputs = [{ name: inName, key: inputKey }];
    // Ruling R79: `timings`/`executor` describe the job that produced the
    // SHEETS, but the byte counters sum EVERY job the op ran, so the probe's
    // own transfer is not invisible in the telemetry.
    let bytesIn = 0;
    let bytesOut = 0;
    const account = (r: FfmpegJobResult): FfmpegJobResult => {
      bytesIn += r.bytesIn;
      bytesOut += r.bytesOut;
      return r;
    };

    let duration: number;
    if (config.duration !== undefined && config.duration !== null && config.duration !== '') {
      const value =
        typeof config.duration === 'string'
          ? this.expressionEvaluator.evaluateExpression(config.duration, context, stepName)
          : config.duration;
      duration = this.assertDuration(Number(value));
    } else {
      // Its OWN job: an executor result's `stdout` is only the LAST command's,
      // and the duration has to be known before the cells can even be planned.
      const probed = account(
        await this.runJob(
          executor,
          {
            id: `${stepName}-probe`,
            commands: [
              {
                id: 'probe',
                kind: 'ffprobe',
                argv: buildProbeArgs(`{in:${inName}}`),
                timeoutSeconds: PROBE_TIMEOUT_SECONDS,
              },
            ],
            inputs,
            outputs: [],
            files: [],
          },
          signal,
        ),
      );
      let parsed: { format?: { duration?: string } } = {};
      try {
        parsed = JSON.parse(probed.stdout) as { format?: { duration?: string } };
      } catch {
        // Unparseable ffprobe output falls through to the typed duration error.
      }
      duration = this.assertDuration(Number(parsed.format?.duration));
    }

    // Defence in depth: validateConfig refuses this budget at config time, but a
    // directly-executed step never went through it.
    const budget = (knobs.maxSheets ?? MAX_SHEETS) * (knobs.cellsPerSheet ?? MAX_CELLS_PER_SHEET);
    if (budget > MAX_STILLS_PER_JOB) {
      this.tooManyStills('contact_sheet maxSheets × cellsPerSheet', budget);
    }
    const plan = planContactSheet(duration, {
      minInterval: knobs.interval,
      columns: knobs.columns,
      cellsPerSheet: knobs.cellsPerSheet,
      maxSheets: knobs.maxSheets,
    });
    if (plan.times.length === 0) {
      throw Object.assign(
        new Error(`ffmpeg_handler contact_sheet planned no frames for a ${duration}s source`),
        { code: 'INVALID_TIMES' },
      );
    }
    // Ruling R82 again: the cell pad width comes from the TOTAL cell count and
    // the SAME width feeds both the filenames and the `%0Wd` tile pattern — a
    // hard-coded `%03d` silently breaks past 999 cells.
    const cellWidth = Math.max(3, String(plan.times.length).length);
    const cellName = (i: number) => `cell-${String(i + 1).padStart(cellWidth, '0')}.jpg`;
    const sheetWidth = Math.max(2, String(plan.sheets.length).length);
    const sheetName = (i: number) => `sheet-${String(i + 1).padStart(sheetWidth, '0')}.jpg`;

    const job = (withLabels: boolean): FfmpegJob => ({
      id: stepName,
      commands: [
        ...plan.times.map((time, i) => ({
          id: cellName(i).replace(/\.jpg$/, ''),
          kind: 'ffmpeg' as const,
          timeoutSeconds: FRAME_TIMEOUT_SECONDS,
          // Ruling R75 — cells are SCRATCH-ONLY and are addressed by a BARE
          // scratch-relative filename, never a `{out:NAME}` placeholder: both
          // executors reject an undeclared one (local: the `known` set; the
          // Worker: `names.has` → BAD_REQUEST), and the `cell-%0Wd.jpg` glob the
          // tile pass reads could never BE a declared name. Both spawn with
          // cwd = the scratch dir, which is exactly what runConcat's list file
          // already relies on ("Scratch-relative names" there).
          argv: buildFrameArgs({
            input: `{in:${inName}}`,
            output: cellName(i),
            time,
            height: knobs.height,
            quality: CELL_QUALITY,
            label: withLabels ? clockLabel(time) : undefined,
          }),
        })),
        ...plan.sheets.map((sheet) => ({
          id: sheetName(sheet.index).replace(/\.jpg$/, ''),
          kind: 'ffmpeg' as const,
          timeoutSeconds: FRAME_TIMEOUT_SECONDS,
          argv: buildTileArgs({
            pattern: `cell-%0${cellWidth}d.jpg`,
            start: sheet.start,
            count: sheet.count,
            // The sheet's ACTUAL grid width, not the `columns` config: a short
            // final sheet plans narrower (2 cells under columns:3 → cols:2).
            columns: sheet.cols,
            output: `{out:${sheetName(sheet.index)}}`,
          }),
        })),
      ],
      inputs,
      // The sheets ONLY. Cells are never listed, so no executor uploads them.
      outputs: plan.sheets.map((sheet) => ({
        name: sheetName(sheet.index),
        key: `${prefix}/${sheetName(sheet.index)}`,
        contentType: 'image/jpeg',
      })),
      files: [],
    });

    // Ruling R77: the LOCAL `-filters` probe may only SUPPRESS labels, and only
    // for the local executor — a remote-only instance has no local ffmpeg to
    // probe, so gating on it there would mean a contact sheet is NEVER
    // labelled, which defeats the point of one. `hasFilter` is tri-state:
    // only an explicit `false` suppresses (the optional call also tolerates
    // capability doubles predating it).
    const localLacksDrawtext =
      executor.name === 'local' && this.capability.hasFilter?.('drawtext') === false;
    let labelled = knobs.label && !localLacksDrawtext;
    let res: FfmpegJobResult;
    try {
      res = await this.runJob(executor, job(labelled), signal);
    } catch (error) {
      // The universal net under that probe: an ffmpeg that turns out to lack
      // drawtext (a remote Worker's, say) costs ONE un-labelled retry, not the
      // step. Every other failure propagates untouched.
      if (!labelled || !isDrawtextFailure(error)) throw error;
      this.logger.warn({ event: 'ffmpeg_contact_sheet_drawtext_missing', step: stepName });
      labelled = false;
      res = await this.runJob(executor, job(false), signal);
    }
    account(res);
    const bytes = new Map(res.outputs.map((o) => [o.name, o.bytes]));
    return {
      success: true,
      output: {
        sheets: plan.sheets.map((sheet) => ({
          storage_path: `${prefix}/${sheetName(sheet.index)}`,
          content_type: 'image/jpeg',
          size: bytes.get(sheetName(sheet.index)) ?? 0,
          times: sheet.times,
          index: sheet.index,
          total: plan.sheets.length,
          cols: sheet.cols,
          rows: sheet.rows,
        })),
        interval: plan.interval,
        count: plan.times.length,
        labelled,
        ...this.telemetry(res),
        bytesIn,
        bytesOut,
      },
    };
  }

  private async runSlice(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const spans = this.resolveSpans(config.spans, context, stepName);
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    const audioKey = config.audioOutput
      ? await this.resolveKey(config.audioOutput, context, stepName, 'output')
      : null;
    const inName = `in${path.posix.extname(inputKey) || '.mp4'}`;
    const commands: FfmpegJobCommand[] = [
      {
        id: 'slice',
        kind: 'ffmpeg',
        argv: buildSliceArgs({
          input: `{in:${inName}}`,
          output: '{out:clip.mp4}',
          spans,
          threads: executor.argvThreads(),
          audioFades: config.audioFades === true,
        }),
      },
    ];
    const outputs: FfmpegJobOutput[] = [
      { name: 'clip.mp4', key: outputKey, contentType: 'video/mp4' },
    ];
    if (audioKey) {
      // Second pass on the (small) clip — keeps the slice graph simple; cost is negligible.
      commands.push({
        id: 'wav',
        kind: 'ffmpeg',
        argv: buildExtractAudioArgs('{out:clip.mp4}', '{out:clip.wav}'),
      });
      outputs.push({ name: 'clip.wav', key: audioKey, contentType: 'audio/wav' });
    }
    const res = await this.runJob(
      executor,
      {
        id: stepName,
        commands,
        inputs: [{ name: inName, key: inputKey }],
        outputs,
        files: [],
      },
      signal,
    );
    const duration = spans.reduce((n, s) => n + (s.end - s.start), 0);
    const wav = res.outputs.find((o) => o.name === 'clip.wav');
    return {
      success: true,
      output: {
        storage_path: outputKey,
        content_type: 'video/mp4',
        size: res.outputs[0].bytes,
        duration: Number(duration.toFixed(3)),
        ...(wav && audioKey
          ? { audio: { storage_path: audioKey, content_type: 'audio/wav', size: wav.bytes } }
          : {}),
        ...this.telemetry(res),
      },
    };
  }

  private async runConcat(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
    executor: FfmpegExecutor,
    signal: AbortSignal,
  ): Promise<StepResult> {
    const configInputs = config.inputs;
    let inputsRaw: unknown = configInputs;
    if (typeof configInputs === 'string') {
      const trimmed = configInputs.trim();
      let parsed: unknown;
      let parsedAsJson = false;
      if (trimmed.startsWith('[')) {
        try {
          parsed = JSON.parse(trimmed);
          parsedAsJson = true;
        } catch {
          // Not valid JSON — fall through to expression evaluation below.
        }
      }
      inputsRaw = parsedAsJson
        ? parsed
        : this.expressionEvaluator.evaluateExpression(configInputs, context, stepName);
    }
    if (!Array.isArray(inputsRaw) || inputsRaw.length === 0) {
      this.pathError(
        'INVALID_INPUT_PATH',
        'ffmpeg_handler concat requires a non-empty inputs array',
      );
    }
    const inputKeys: string[] = [];
    for (const raw of inputsRaw as unknown[]) {
      inputKeys.push(await this.resolveKey(String(raw), context, stepName, 'input'));
    }
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    const inputs = inputKeys.map((key, i) => ({
      name: `part-${i}${path.posix.extname(key) || '.mp4'}`,
      key,
    }));
    const threads = executor.argvThreads();
    // Stream-copy first; only a process failure (stream mismatch) hands over to
    // the re-encode fallback — busy/timeout/memory abort the job untouched.
    const res = await this.runJob(
      executor,
      {
        id: stepName,
        commands: [
          {
            id: 'copy',
            kind: 'ffmpeg',
            argv: buildConcatArgs('{file:concat.txt}', '{out:final.mp4}', {
              reencode: false,
              threads,
            }),
          },
          {
            id: 'reencode',
            kind: 'ffmpeg',
            argv: buildConcatArgs('{file:concat.txt}', '{out:final.mp4}', {
              reencode: true,
              threads,
            }),
            fallbackFor: 'copy',
          },
        ],
        inputs,
        outputs: [{ name: 'final.mp4', key: outputKey, contentType: 'video/mp4' }],
        // Scratch-relative names: the concat demuxer resolves each entry against
        // the list file's own directory, which is the job's scratch dir.
        files: [{ name: 'concat.txt', content: buildConcatListContent(inputs.map((i) => i.name)) }],
      },
      signal,
    );
    const reencoded = res.commands.some((c) => c.id === 'reencode' && c.ran);
    if (reencoded) this.logger.warn({ event: 'ffmpeg_concat_reencode_fallback', step: stepName });
    return {
      success: true,
      output: {
        storage_path: outputKey,
        content_type: 'video/mp4',
        size: res.outputs[0].bytes,
        reencoded,
        ...this.telemetry(res),
      },
    };
  }
}
