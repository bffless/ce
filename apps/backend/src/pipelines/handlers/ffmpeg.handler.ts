import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import * as path from 'path';
import {
  StepHandler,
  FfmpegHandlerConfig,
  FfmpegDrawConfig,
  FfmpegTileConfig,
} from '../execution/step-handler.interface';
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
} from '../ffmpeg/ffmpeg-args';
import type { FrameOverlay } from '../ffmpeg/ffmpeg-args';
import { readFfmpegEnv } from '../ffmpeg/ffmpeg-env';

const OPERATIONS = ['probe', 'extract_audio', 'slice', 'concat', 'frames'] as const;

/**
 * Hard ceiling on stills one step may ask for, measured on `times.length`.
 * `times` is expression-resolvable (`request.body.times` is an advertised
 * form), so its length is a resource decision made by untrusted input, and
 * each still is a sequential ffmpeg spawn whose output piles up in scratch
 * BEFORE anything is uploaded — the local disk pre-flight only reserves
 * `2 × input + margin` and does not model outputs, and the remote path puts one
 * presigned PUT URL per output in a single envelope that the Worker caps at
 * 1 MB. It is the ONE still cap the op needs: sheets are
 * `times.length / tile.perSheet`, so bounding the stills bounds them too.
 */
export const MAX_STILLS_PER_JOB = 200;

/** Defaults for the still-image knobs. */
const DEFAULT_FRAME_HEIGHT = 720;
const DEFAULT_FRAME_QUALITY = 3;
/** Grid width of a sheet when `tile` does not say — a short final sheet still lays out narrower. */
const DEFAULT_TILE_COLUMNS = 3;
/** Ruling R80: every still is a cheap, bounded command, so none of them may hold the queue. */
const FRAME_TIMEOUT_SECONDS = 120;
const PROBE_TIMEOUT_SECONDS = 60;

/**
 * The non-overlay half of a throwaway `buildFrameArgs` call, used only to
 * validate a `draw` block at the config boundary. Nothing is spawned; the
 * builder's own field checks are the point.
 */
const PREFLIGHT_FRAME = {
  input: 'in.mp4',
  output: 'out.jpg',
  time: 0,
  height: DEFAULT_FRAME_HEIGHT,
  quality: DEFAULT_FRAME_QUALITY,
};

/**
 * A `draw.text` string is resolved as an expression ONLY when it is one. The
 * evaluator itself is looser — it resolves anything whose first word is a
 * known root — which is fine for `times` (a number is never prose) and wrong
 * for text: "user guide" and "request received" are titles, and resolving them
 * would either throw on a missing property or draw something nobody wrote. So
 * the gate here is the shape of a whole path, not just its first word.
 */
const DRAW_TEXT_EXPRESSION =
  /^(?:user|steps|metadata|request|deployment|secrets)(?:\.[A-Za-z0-9_$]+|\[\d+\])+$/;

/** `{{...}}` in a drawn text is an authoring slip, not a value — see `resolveDrawTexts`. */
const TEMPLATE_SYNTAX = /\{\{.*\}\}/s;

/**
 * A job that failed because this ffmpeg has no `drawtext` — the ONLY failure a
 * `frames` step retries (without the overlay). Anything else is a real failure
 * and propagates untouched.
 */
function isDrawtextFailure(error: unknown): boolean {
  const e = error as { code?: string; stderrTail?: string };
  if (e?.code !== 'FFMPEG_FAILED') return false;
  // ffmpeg's OWN stderr only. Not `error.message`: that carries CE-side text
  // including paths, so an input named `.../drawtext-demo.mp4` failing for any
  // reason would trigger a pointless undrawn re-run of a 200-command job.
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
    need('input', ['extract_audio', 'slice', 'frames']);
    need('spans', ['slice']);
    need('times', ['frames']);
    need('inputs', ['concat']);
    need('output', ['extract_audio', 'slice', 'concat']);
    need('outputPrefix', ['frames']);
    // The knobs are validated here, at the boundary where untrusted config
    // enters — not in the pure builders, which cannot report a config error.
    // Scoped to the one op that reads them, so a pre-existing slice/concat step
    // carrying a stray field is not newly rejected. This is not a save-time
    // gate: validateConfig's only callers are pipeline-execution.service.ts:452
    // and :570, each immediately before handler.execute, so a bad knob fails on
    // the step's first request rather than when it is authored.
    if (config.operation === 'frames') {
      const knobs = this.knobs(config);
      // The rest of the `draw` block is 17a's to judge, and it judges it while
      // BUILDING an argv — so the cheapest way to surface `color`/`size`/
      // `position` as a config error at the boundary is to build one throwaway
      // command here with a placeholder text (the real text may be an
      // expression that only run time can resolve).
      if (knobs.draw)
        this.frameArgv({ ...PREFLIGHT_FRAME, overlay: this.overlay(knobs.draw, 'x') });
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
   * The boolean twin of `knob`. Config reaches us as YAML/JSON, and the
   * numeric knobs accept strings — so `draw.background: 'false'` must turn the
   * box OFF rather than being silently truthy. A wrong picture with no error
   * is worse than a config error.
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

  /**
   * A `draw:`/`tile:` block, or undefined. YAML hands an empty body back as
   * `null` and a mistyped one as a scalar, so this is a real authoring slip
   * rather than a defensive nicety — and it has to fail here, because
   * everything downstream reads properties off it.
   */
  private block<T>(value: unknown, field: 'draw' | 'tile'): T | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ConfigurationError(
        `ffmpeg_handler ${field} must be an object (got ${value === null ? 'null' : JSON.stringify(value)})`,
        'ffmpeg_handler',
      );
    }
    return value as T;
  }

  /**
   * Every knob of `frames`. Called from validateConfig AND from the op itself
   * (defence in depth: a directly-executed step skips validation).
   *
   * Ruling R103 as it now stands: values a CALLER authored throw at this edge,
   * values CE derives are clamped in depth. `tile.perSheet`/`tile.columns` used
   * to be the planner's output, which is why `buildTileArgs` clamps them; now
   * that they come from a `tile:` block they are authored config, and
   * `columns: 0` silently clamping to 1 would lay out a 1×N strip instead of
   * reporting the mistake. The clamp stays where it is as the unreachable
   * guard its TSDoc claims to be.
   */
  private knobs(config: FfmpegHandlerConfig) {
    const draw = this.block<FfmpegDrawConfig>(config.draw, 'draw');
    const tile = this.block<FfmpegTileConfig>(config.tile, 'tile');
    return {
      height: this.knob(config.height, 'height', 'integer') ?? DEFAULT_FRAME_HEIGHT,
      quality: this.knob(config.quality, 'quality', 'integer') ?? DEFAULT_FRAME_QUALITY,
      draw: draw && {
        text: draw.text,
        // `position` and `color` are 17a's to judge (it owns the enum and the
        // colour pattern) — re-checking them here would be a second, drifting
        // copy of the same rule.
        position: draw.position,
        color: draw.color,
        size: this.knob(draw.size, 'draw.size', 'number'),
        background: this.boolKnob(draw.background, 'draw.background', true),
      },
      tile: tile && {
        perSheet:
          this.knob(tile.perSheet, 'tile.perSheet', 'integer') ??
          this.missing(
            'tile.perSheet is required whenever tile is present: the number of stills on each sheet',
          ),
        columns: this.knob(tile.columns, 'tile.columns', 'integer') ?? DEFAULT_TILE_COLUMNS,
      },
    };
  }

  private missing(what: string): never {
    throw new ConfigurationError(`ffmpeg_handler ${what}`, 'ffmpeg_handler');
  }

  /** The overlay `buildFrameArgs` takes, from a validated `draw` block plus this still's own text. */
  private overlay(draw: NonNullable<ReturnType<FfmpegHandler['knobs']>['draw']>, text: string) {
    return {
      text,
      position: draw.position,
      size: draw.size,
      color: draw.color,
      background: draw.background,
    } as FrameOverlay;
  }

  /**
   * `buildFrameArgs`, with its plain `Error`s mapped onto the typed config
   * error the pipeline contract promises. 17a deliberately throws for an
   * authored value it cannot use (Ruling R103: clamping `size: 3` would render
   * text nobody asked for, and a colour has no nearest valid neighbour), but a
   * raw Error would surface as a generic handler failure — so name the field
   * the author has to fix.
   */
  private frameArgv(o: Parameters<typeof buildFrameArgs>[0]): string[] {
    try {
      return buildFrameArgs(o);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const named = /overlay (text|position|size|color|background)\b/.exec(message);
      throw new ConfigurationError(
        `ffmpeg_handler ${named ? `draw.${named[1]}` : 'draw'} is invalid: ${message}`,
        'ffmpeg_handler',
      );
    }
  }

  /**
   * One drawn text per still, or undefined when the step asked for no `draw`.
   *
   * `text` mirrors `times`: a JSON array string, a BARE expression resolving
   * to a string or an array, or the value itself. It differs in one way that
   * matters — a plain string is legitimate CONTENT here, so it is only treated
   * as an expression when it has the shape of a whole path
   * (`DRAW_TEXT_EXPRESSION`); prose beginning with an expression root is drawn
   * as written.
   *
   * `{{...}}` is refused outright. For `times` a braced value fails on its own
   * ("expected a non-empty array"), but a braced TEXT would happily draw the
   * literal braces into the picture — a silent wrong image, which is the one
   * failure mode this op keeps fencing.
   */
  private resolveDrawTexts(
    draw: ReturnType<FfmpegHandler['knobs']>['draw'],
    count: number,
    context: PipelineContext,
    stepName: string,
  ): string[] | undefined {
    if (!draw) return undefined;
    const fail = (msg: string): never => {
      throw new ConfigurationError(`ffmpeg_handler draw.text ${msg}`, 'ffmpeg_handler');
    };
    const resolve = (v: unknown): unknown =>
      typeof v === 'string' && DRAW_TEXT_EXPRESSION.test(v.trim())
        ? this.expressionEvaluator.evaluateExpression(v.trim(), context, stepName)
        : v;
    const one = (v: unknown, where: string): string => {
      if (typeof v !== 'string' && typeof v !== 'number') {
        fail(`${where} must be a string (got ${v === null ? 'null' : typeof v})`);
      }
      const text = String(v);
      if (TEMPLATE_SYNTAX.test(text)) {
        fail(
          `${where} is a {{template}}, which draw.text does not support: write a BARE expression (steps.x.title) or the literal text`,
        );
      }
      return text;
    };

    let value: unknown = draw.text;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      let parsedAsJson = false;
      if (trimmed.startsWith('[')) {
        try {
          value = JSON.parse(trimmed);
          parsedAsJson = true;
        } catch {
          // Not valid JSON — fall through to the expression/literal path below.
        }
      }
      if (!parsedAsJson) value = resolve(value);
    }
    if (Array.isArray(value)) {
      if (value.length !== count) {
        fail(
          `is an array of ${value.length} entries but ${count} times were requested — one text per still, or a single string for all of them`,
        );
      }
      return value.map((v, i) => one(resolve(v), `entry ${i}`));
    }
    if (value === undefined || value === null) fail('is required when draw is present');
    return new Array<string>(count).fill(one(value, 'must be a string or an array of strings'));
  }

  /**
   * Chunk the requested times into sheets. `cols` is each sheet's ACTUAL grid
   * width — a short final sheet is narrower than the `columns` knob, and
   * `buildTileArgs` documents that it must be handed that narrower value.
   * `start` is the sheet's first cell as a 1-based number, which is exactly
   * ffmpeg's `-start_number`.
   */
  private planSheets(times: number[], tile: { perSheet: number; columns: number }) {
    const sheets: Array<{
      index: number;
      start: number;
      times: number[];
      cols: number;
      rows: number;
    }> = [];
    for (let from = 0; from < times.length; from += tile.perSheet) {
      const chunk = times.slice(from, from + tile.perSheet);
      const cols = Math.min(chunk.length, tile.columns);
      sheets.push({
        index: sheets.length,
        start: from + 1,
        times: chunk,
        cols,
        rows: Math.ceil(chunk.length / cols),
      });
    }
    return sheets;
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
            timeoutSeconds: PROBE_TIMEOUT_SECONDS, // probe is cheap; never let it hold the queue long
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
        `ffmpeg_handler ${op} produced no ${missing}: ffmpeg wrote no image there, which usually means a requested time is past the end of the source (${message})`,
      ),
      { code: 'FFMPEG_FAILED' },
    );
  }

  /**
   * One still per requested time — plus, optionally, one line of text drawn on
   * each (`draw`) and a tiling of them into contact sheets (`tile`). That is
   * one operation, not three: a sheet is `times` + `tile`, a title card is a
   * single time + `draw`, and a clean thumbnail strip is neither. CE supplies
   * the DRAWING and the TILING; what the text says and where the times fall is
   * the calling app's policy (Ruling R99).
   *
   * Without `tile` every still is uploaded under `outputPrefix`. With it the
   * stills stay SCRATCH-ONLY — addressed by a BARE scratch-relative filename,
   * never a `{out:NAME}` placeholder, because both executors reject an
   * undeclared one (local: the `known` set; the Worker: `names.has` →
   * BAD_REQUEST) and the `cell-%0Wd.jpg` glob the tile pass reads could never
   * BE a declared name (Ruling R75; both executors spawn with cwd = the
   * scratch dir, which is what runConcat's list file already relies on). Only
   * the sheets are declared as job outputs, so no executor can upload a cell
   * however the argv is written.
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
    const texts = this.resolveDrawTexts(knobs.draw, times.length, context, stepName);
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const prefix = await this.resolvePrefix(config.outputPrefix!, context, stepName);
    const inName = `in${path.posix.extname(inputKey) || '.mp4'}`;
    const tile = knobs.tile;
    const sheets = tile ? this.planSheets(times, tile) : [];

    // Ruling R82: ONE pad width for the whole batch, widened past the two/three
    // digits so the names stay sortable instead of jumping from 99 to 100 — and
    // for cells the SAME width feeds both the filenames and the `%0Wd` tile
    // pattern, which a hard-coded `%03d` would silently break past 999.
    const stillWidth = Math.max(tile ? 3 : 2, String(times.length).length);
    const stillName = (i: number) =>
      `${tile ? 'cell' : 'frame'}-${String(i + 1).padStart(stillWidth, '0')}.jpg`;
    const sheetWidth = Math.max(2, String(sheets.length).length);
    const sheetName = (i: number) => `sheet-${String(i + 1).padStart(sheetWidth, '0')}.jpg`;
    // The stills OR the sheets — never both. Nothing else is declared, so
    // nothing else uploads.
    const outputs: FfmpegJobOutput[] = tile
      ? sheets.map((sheet) => ({
          name: sheetName(sheet.index),
          key: `${prefix}/${sheetName(sheet.index)}`,
          contentType: 'image/jpeg',
        }))
      : times.map((_, i) => ({
          name: stillName(i),
          key: `${prefix}/${stillName(i)}`,
          contentType: 'image/jpeg',
        }));

    const job = (withDraw: boolean): FfmpegJob => ({
      id: stepName,
      commands: [
        ...times.map((time, i) => ({
          id: stillName(i).replace(/\.jpg$/, ''),
          kind: 'ffmpeg' as const,
          timeoutSeconds: FRAME_TIMEOUT_SECONDS,
          argv: this.frameArgv({
            input: `{in:${inName}}`,
            output: tile ? stillName(i) : `{out:${stillName(i)}}`,
            time,
            height: knobs.height,
            quality: knobs.quality,
            overlay: withDraw && texts ? this.overlay(knobs.draw!, texts[i]) : undefined,
          }),
        })),
        ...sheets.map((sheet) => ({
          id: sheetName(sheet.index).replace(/\.jpg$/, ''),
          kind: 'ffmpeg' as const,
          timeoutSeconds: FRAME_TIMEOUT_SECONDS,
          argv: buildTileArgs({
            pattern: `cell-%0${stillWidth}d.jpg`,
            start: sheet.start,
            count: sheet.times.length,
            // This sheet's ACTUAL grid width, not the `columns` knob: a short
            // final sheet is narrower (2 cells under columns:3 lay out 2 wide).
            columns: sheet.cols,
            output: `{out:${sheetName(sheet.index)}}`,
          }),
        })),
      ],
      inputs: [{ name: inName, key: inputKey }],
      outputs,
      files: [],
    });

    // Ruling R77: the LOCAL `-filters` probe may only SUPPRESS a draw, and only
    // for the local executor — a remote-only instance has no local ffmpeg to
    // probe, so gating on it there would mean nothing is ever drawn.
    // `hasFilter` is tri-state: only an explicit `false` suppresses (the
    // optional call also tolerates capability doubles predating it).
    const localLacksDrawtext =
      executor.name === 'local' && this.capability.hasFilter?.('drawtext') === false;
    let drawn = texts !== undefined && !localLacksDrawtext;
    let res: FfmpegJobResult;
    try {
      res = await this.runJob(executor, job(drawn), signal);
    } catch (error) {
      // The universal net under that probe: an ffmpeg that turns out to lack
      // drawtext (a remote Worker's, say) costs ONE undrawn retry, not the
      // step. Every other failure propagates untouched — through
      // `namedOutputFailure`, which turns the bare ENOENT of an image ffmpeg
      // never wrote into a message naming it.
      if (!drawn || !isDrawtextFailure(error)) {
        throw this.namedOutputFailure(
          error,
          'frames',
          outputs.map((o) => o.name),
        );
      }
      this.logger.warn({ event: 'ffmpeg_frames_drawtext_missing', step: stepName });
      drawn = false;
      try {
        res = await this.runJob(executor, job(false), signal);
      } catch (retryError) {
        throw this.namedOutputFailure(
          retryError,
          'frames',
          outputs.map((o) => o.name),
        );
      }
    }
    const bytes = new Map(res.outputs.map((o) => [o.name, o.bytes]));
    return {
      success: true,
      output: tile
        ? {
            sheets: sheets.map((sheet) => ({
              storage_path: `${prefix}/${sheetName(sheet.index)}`,
              content_type: 'image/jpeg',
              size: bytes.get(sheetName(sheet.index)) ?? 0,
              times: sheet.times,
              index: sheet.index,
              total: sheets.length,
              cols: sheet.cols,
              rows: sheet.rows,
            })),
            count: times.length,
            drawn,
            ...this.telemetry(res),
          }
        : {
            frames: times.map((time, i) => ({
              // The REQUESTED time, unchanged — it is what a re-capture seeks to.
              time,
              storage_path: `${prefix}/${stillName(i)}`,
              content_type: 'image/jpeg',
              size: bytes.get(stillName(i)) ?? 0,
            })),
            count: times.length,
            drawn,
            ...this.telemetry(res),
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
