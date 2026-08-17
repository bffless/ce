import { Injectable, Inject, Logger } from '@nestjs/common';
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
import { FfmpegStepTimeoutError } from '../ffmpeg/ffmpeg-errors';
import { LocalFfmpegExecutor } from '../ffmpeg/executor/local-ffmpeg.executor';
import type {
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
} from '../ffmpeg/ffmpeg-args';
import { readFfmpegEnv } from '../ffmpeg/ffmpeg-env';

const OPERATIONS = ['probe', 'extract_audio', 'slice', 'concat'] as const;

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
  /** Task 4 replaces this with injected executors + a per-step selector. */
  private readonly local: LocalFfmpegExecutor;

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly capability: FfmpegCapabilityService,
    runner: FfmpegRunnerService,
    scratch: FfmpegScratchService,
    private readonly uploadRecord: UploadRecordService,
    @Inject(STORAGE_ADAPTER) storageAdapter: IStorageAdapter,
  ) {
    this.local = new LocalFfmpegExecutor(runner, scratch, storageAdapter);
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
    need('input', ['extract_audio', 'slice']);
    need('spans', ['slice']);
    need('inputs', ['concat']);
    need('output', ['extract_audio', 'slice', 'concat']);
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FfmpegHandlerConfig;
    const stepName = step.name || 'ffmpeg_handler';

    if (config.operation === 'probe' && !config.input) {
      // Capability self-test — the /api/video/capabilities payload. Never fails.
      return {
        success: true,
        output: {
          server: await this.capability.isEnabled(),
          ops: await this.capability.getOps(),
          version: this.capability.getVersion(),
        },
      };
    }

    if (!(await this.capability.isEnabled())) {
      return {
        success: false,
        error: {
          code: 'FFMPEG_UNAVAILABLE',
          message:
            'server video ops are disabled on this instance (enable them in Admin Settings → Features, or ffmpeg is missing)',
        },
      };
    }

    try {
      switch (config.operation) {
        case 'probe':
          return await this.runProbe(config, context, stepName);
        case 'extract_audio':
          return await this.runExtractAudio(config, context, stepName);
        case 'slice':
          return await this.runSlice(config, context, stepName);
        case 'concat':
          return await this.runConcat(config, context, stepName);
      }
    } catch (error) {
      return this.toErrorResult(error, stepName);
    }
  }

  /**
   * Run one job under the whole-step ceiling. The runner's watchdog only covers
   * the spawned process; everything around it (queue wait, storage transfers)
   * used to be unbounded, so one stalled await left the step pending forever —
   * fatal for an async job, whose row stays 'running' with nothing to end it but
   * the client's own poll timeout. A post-step that never settles also
   * suppresses the execution log on rules that persist one, since the log write
   * awaits the post-steps promise (#669).
   */
  private async runJob(job: FfmpegJob): Promise<FfmpegJobResult> {
    const controller = new AbortController();
    return this.withDeadline(
      this.local.run(job, { signal: controller.signal }),
      readFfmpegEnv().jobMaxSeconds,
      `${job.id} step`,
      () => controller.abort(),
    );
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

  /**
   * Bound an await that has no timeout of its own. On breach the step fails
   * with FFMPEG_JOB_TIMEOUT naming the phase; the abandoned work is left to
   * settle on its own (its `finally` still cleans up, and orphaned scratch
   * dirs are swept hourly) — the point is that the STEP always settles.
   * `onTimeout` lets the caller signal the abandoned work (a remote executor
   * cancels its job; the local one has nothing to cancel).
   */
  private withDeadline<T>(
    work: Promise<T>,
    seconds: number,
    phase: string,
    onTimeout?: () => void,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // The abandoned work may reject later with nobody listening.
        work.catch(() => undefined);
        onTimeout?.();
        reject(
          new FfmpegStepTimeoutError(
            `ffmpeg_handler ${phase} exceeded ${seconds}s and was abandoned`,
          ),
        );
      }, seconds * 1000);
    });
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
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
      'FFMPEG_FAILED',
      'INVALID_INPUT_PATH',
      'INVALID_OUTPUT_PATH',
      'INVALID_SPANS',
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
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
    const res = await this.runJob({
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
    });
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
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
    const res = await this.runJob({
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
    });
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

  private async runSlice(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
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
          threads: this.local.argvThreads(),
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
    const res = await this.runJob({
      id: stepName,
      commands,
      inputs: [{ name: inName, key: inputKey }],
      outputs,
      files: [],
    });
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
    const threads = this.local.argvThreads();
    // Stream-copy first; only a process failure (stream mismatch) hands over to
    // the re-encode fallback — busy/timeout/memory abort the job untouched.
    const res = await this.runJob({
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
    });
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
