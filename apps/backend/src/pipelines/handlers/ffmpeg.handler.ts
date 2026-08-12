import { Injectable, Inject, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import { pipeline } from 'stream/promises';
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
import { UploadRecordService } from '../upload-record.service';
import { buildExtractAudioArgs, buildProbeArgs } from '../ffmpeg/ffmpeg-args';

const OPERATIONS = ['probe', 'extract_audio', 'slice', 'concat'] as const;

/**
 * ffmpeg_handler — see the FfmpegHandlerConfig TSDoc in step-handler.interface.ts
 * for the authoritative operation reference.
 */
@Injectable()
export class FfmpegHandler implements StepHandler<FfmpegHandlerConfig> {
  readonly type = 'ffmpeg_handler' as const;
  private readonly logger = new Logger(FfmpegHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly capability: FfmpegCapabilityService,
    private readonly runner: FfmpegRunnerService,
    private readonly scratch: FfmpegScratchService,
    private readonly uploadRecord: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
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
          server: this.capability.isEnabled(),
          ops: this.capability.getOps(),
          version: this.capability.getVersion(),
        },
      };
    }

    if (!this.capability.isEnabled()) {
      return {
        success: false,
        error: {
          code: 'FFMPEG_UNAVAILABLE',
          message:
            'server video ops are unavailable on this instance (ffmpeg missing or FFMPEG_HANDLER_ENABLED=false)',
        },
      };
    }

    try {
      switch (config.operation) {
        case 'probe':
          return await this.runProbe(config, context, stepName);
        case 'extract_audio':
          return await this.runExtractAudio(config, context, stepName); // Task 7
        case 'slice':
          return await this.runSlice(config, context, stepName); // Task 8
        case 'concat':
          return await this.runConcat(config, context, stepName); // Task 8
      }
    } catch (error) {
      return this.toErrorResult(error, stepName);
    }
  }

  /** Map typed runner/scratch errors onto the stable error-code contract. */
  private toErrorResult(error: unknown, stepName: string): StepResult {
    const code = (error as { code?: string }).code;
    const known = [
      'FFMPEG_BUSY',
      'FFMPEG_INSUFFICIENT_MEMORY',
      'FFMPEG_INSUFFICIENT_DISK',
      'FFMPEG_TIMEOUT',
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

  /** ~64MB slack demanded beyond the 2× input estimate in the disk pre-flight. */
  private static readonly DISK_MARGIN_BYTES = 64 * 1024 * 1024;

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

  private async downloadToFile(key: string, destPath: string): Promise<void> {
    try {
      if (this.storageAdapter.downloadStream) {
        const { stream } = await this.storageAdapter.downloadStream(key);
        await pipeline(stream, createWriteStream(destPath));
      } else {
        // Non-streaming backend: buffered fallback (small instances only).
        const buffer = await this.storageAdapter.download(key);
        await fs.writeFile(destPath, buffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found') || message.includes('ENOENT')) {
        throw Object.assign(new Error(`input not found in storage: ${key}`), {
          code: 'FILE_NOT_FOUND',
        });
      }
      throw error;
    }
  }

  private async uploadFromFile(
    srcPath: string,
    key: string,
    mimeType: string,
  ): Promise<{ size: number }> {
    const { size } = await fs.stat(srcPath);
    if (this.storageAdapter.uploadStream) {
      await this.storageAdapter.uploadStream(createReadStream(srcPath), key, size, { mimeType });
    } else {
      await this.storageAdapter.upload(await fs.readFile(srcPath), key, { mimeType });
    }
    return { size };
  }

  /** Sum of input object sizes for the disk pre-flight; unknown sizes count 0. */
  private async inputSizeBytes(keys: string[]): Promise<number> {
    let total = 0;
    for (const key of keys) {
      try {
        total += (await this.storageAdapter.getMetadata(key)).size ?? 0;
      } catch {
        /* pre-flight is best-effort; the FILE_NOT_FOUND surfaces at download */
      }
    }
    return total;
  }

  private async runProbe(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const jobDir = await this.scratch.createJobDir();
    try {
      const localIn = path.join(jobDir, `in${path.posix.extname(inputKey) || '.bin'}`);
      await this.downloadToFile(inputKey, localIn);
      const { stdout } = await this.runner.run({
        binary: 'ffprobe',
        args: buildProbeArgs(localIn),
        cwd: jobDir,
        timeoutSeconds: 60, // probe is cheap; never let it hold the queue long
      });
      const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: unknown[] };
      return {
        success: true,
        output: {
          duration: Number(parsed.format?.duration ?? 0),
          format: parsed.format ?? {},
          streams: parsed.streams ?? [],
        },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  private async runExtractAudio(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    await this.scratch.assertFreeSpace(
      2 * (await this.inputSizeBytes([inputKey])) + FfmpegHandler.DISK_MARGIN_BYTES,
    );
    const jobDir = await this.scratch.createJobDir();
    try {
      const localIn = path.join(jobDir, `in${path.posix.extname(inputKey) || '.bin'}`);
      const localOut = path.join(jobDir, 'out.wav');
      await this.downloadToFile(inputKey, localIn);
      await this.runner.run({
        binary: 'ffmpeg',
        args: buildExtractAudioArgs(localIn, localOut),
        cwd: jobDir,
      });
      const { size } = await this.uploadFromFile(localOut, outputKey, 'audio/wav');
      return {
        success: true,
        output: { storage_path: outputKey, content_type: 'audio/wav', size },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  private async runSlice(
    _config: FfmpegHandlerConfig,
    _context: PipelineContext,
    _stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 8');
  }

  private async runConcat(
    _config: FfmpegHandlerConfig,
    _context: PipelineContext,
    _stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 8');
  }
}
