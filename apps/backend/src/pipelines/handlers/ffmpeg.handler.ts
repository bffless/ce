import { Injectable, Inject, Logger } from '@nestjs/common';
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
    ];
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn({ event: 'ffmpeg_step_failed', step: stepName, code, message });
    return {
      success: false,
      error: { code: known.includes(code ?? '') ? code! : 'FFMPEG_FAILED', message },
    };
  }

  private async runProbe(
    _config: FfmpegHandlerConfig,
    _context: PipelineContext,
    _stepName: string,
  ): Promise<StepResult> {
    // Implemented in Task 7 alongside the shared storage plumbing (needs downloadToFile).
    throw new Error('probe with input: implemented in Task 7');
  }

  private async runExtractAudio(
    _config: FfmpegHandlerConfig,
    _context: PipelineContext,
    _stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 7');
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
