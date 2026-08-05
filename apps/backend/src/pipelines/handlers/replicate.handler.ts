import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, ReplicateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ProjectAISettingsService } from '../../projects/project-ai-settings.service';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { ConfigurationError } from '../errors';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 5000;

/**
 * Threshold for using Replicate Files API vs base64 data URI.
 * Files <= 256KB are sent inline as data URIs (one fewer API call).
 * Files > 256KB are uploaded via POST /v1/files to avoid base64 bloat
 * and use Replicate's optimized delivery infrastructure.
 * Uploaded files auto-expire after 24 hours (no cleanup needed).
 */
const DATA_URI_SIZE_THRESHOLD = 256 * 1024; // 256KB

/**
 * Replicate Handler
 *
 * Calls Replicate ML models (CLIP embeddings, image generation, PDF extraction, etc.)
 * from pipeline steps. Uses the Replicate predictions API with sync mode (Prefer: wait).
 *
 * File handling: When an input value is a storage path (from a file_upload_handler step),
 * the handler automatically reads the file from storage and sends it to Replicate.
 * - Small files (<=256KB): inlined as base64 data URIs for simplicity
 * - Larger files: uploaded via Replicate's Files API (POST /v1/files), which returns
 *   a serving URL on replicate.delivery — no base64 overhead, optimized for their infra
 *
 * Reference `steps.<upload_step>.storage_path` for the file input.
 */
@Injectable()
export class ReplicateHandler implements StepHandler<ReplicateHandlerConfig> {
  readonly type = 'replicate' as const;
  private readonly logger = new Logger(ReplicateHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly projectAISettingsService: ProjectAISettingsService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: ReplicateHandlerConfig): void {
    if (!config.model) {
      throw new ConfigurationError('model is required', 'replicate');
    }

    if (!config.input || Object.keys(config.input).length === 0) {
      throw new ConfigurationError('input is required and must have at least one field', 'replicate');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as ReplicateHandlerConfig;

    // Get Replicate API token
    const serviceConfig = await this.projectAISettingsService.getServiceConfig(
      context.projectId,
      'replicate',
    );

    if (!serviceConfig) {
      return {
        success: false,
        error: {
          code: 'REPLICATE_NOT_CONFIGURED',
          message: 'Replicate API token is not configured. Add it in Settings → AI → Replicate.',
        },
      };
    }

    // Evaluate input expressions
    const evaluatedInput: Record<string, unknown> = {};
    for (const [key, expression] of Object.entries(config.input)) {
      evaluatedInput[key] = this.expressionEvaluator.evaluateExpression(
        expression,
        context,
      );
    }

    // Resolve file references: read from storage and upload to Replicate or inline as data URI
    await this.resolveFileInputs(evaluatedInput, context, serviceConfig.apiToken);

    try {
      // Resolve the version to use
      // The "version" field on POST /v1/predictions accepts:
      //   "{owner}/{name}" — official models only
      //   "{owner}/{name}:{version_hash}" — any model, pinned version
      //   "{version_hash}" — just the 64-char hash
      // Community models need a version hash. If the user didn't pin one,
      // we look up the latest version via GET /v1/models/{owner}/{name}/versions.
      let version = config.version;
      if (!version) {
        version = await this.resolveLatestVersion(config.model, serviceConfig.apiToken);
      }

      const payload: Record<string, unknown> = {
        input: evaluatedInput,
        version,
      };

      // Create prediction with Prefer: wait (sync mode, up to 60s)
      const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceConfig.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: {
            code: 'REPLICATE_API_ERROR',
            message: `Replicate API error: ${(errorBody as Record<string, string>).detail || response.statusText}`,
            details: errorBody,
          },
        };
      }

      let prediction = (await response.json()) as Record<string, unknown>;

      // If not completed yet, poll until succeeded/failed
      if (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
        const timeoutMs = config.timeout || DEFAULT_MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS;
        const maxAttempts = Math.ceil(timeoutMs / POLL_INTERVAL_MS);
        prediction = await this.pollPrediction(
          prediction.id as string,
          serviceConfig.apiToken,
          maxAttempts,
        );
      }

      if (prediction.status === 'failed') {
        return {
          success: false,
          error: {
            code: 'REPLICATE_PREDICTION_FAILED',
            message: `Prediction failed: ${prediction.error || 'Unknown error'}`,
            details: { predictionId: prediction.id, model: config.model },
          },
        };
      }

      if (prediction.status === 'canceled') {
        return {
          success: false,
          error: {
            code: 'REPLICATE_PREDICTION_CANCELED',
            message: 'Prediction was canceled',
            details: { predictionId: prediction.id, model: config.model },
          },
        };
      }

      // Extract output
      let output = prediction.output;
      if (config.outputField && output && typeof output === 'object' && !Array.isArray(output)) {
        output = (output as Record<string, unknown>)[config.outputField];
      }

      return {
        success: true,
        output: {
          predictionId: prediction.id,
          model: config.model,
          status: prediction.status,
          output,
          metrics: prediction.metrics,
        },
      };
    } catch (error) {
      this.logger.error(`Replicate handler error for step ${step.name}:`, error);
      return {
        success: false,
        error: {
          code: 'REPLICATE_EXECUTION_ERROR',
          message: `Replicate execution failed: ${(error as Error).message}`,
        },
      };
    }
  }

  /**
   * Resolve file inputs by reading from storage and making them available to Replicate.
   *
   * Detects two patterns:
   * 1. Storage path (e.g., "owner/repo/uploads/images/uuid-file.png") — reads directly
   * 2. Internal API URL (e.g., "/api/uploads/images/uuid-file.png") — converts to storage path
   *
   * For each resolved file:
   * - <= 256KB: inlined as a base64 data URI (one fewer API call)
   * - > 256KB: uploaded to Replicate's Files API, replaced with the serving URL
   */
  private async resolveFileInputs(
    input: Record<string, unknown>,
    context: PipelineContext,
    apiToken: string,
  ): Promise<void> {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== 'string') continue;

      // Skip if already a URL (http/https) or data URI
      if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
        continue;
      }

      let storagePath: string | null = null;

      // Pattern 1: Storage path (contains "uploads/" with owner/repo prefix)
      if (value.includes('/uploads/') && value.includes('/')) {
        storagePath = value;
      }

      // Pattern 2: Internal API URL like "/api/uploads/sub_dir/uuid-file.png"
      if (!storagePath && value.startsWith('/api/uploads/')) {
        storagePath = this.resolveApiUrlToStoragePath(value, context);
      }

      if (!storagePath) continue;

      const resolved = await this.resolveStorageFile(storagePath, context, apiToken);
      if (resolved) {
        input[key] = resolved;
      }
    }
  }

  /**
   * Read a file from storage and return either a data URI (small files)
   * or a Replicate Files API serving URL (larger files).
   */
  private async resolveStorageFile(
    storagePath: string,
    context: PipelineContext,
    apiToken: string,
  ): Promise<string | null> {
    try {
      const contentType = this.findContentTypeFromSteps(storagePath, context) ||
        this.guessContentType(storagePath);
      const filename = storagePath.split('/').pop() || 'file';

      const buffer = await this.storageAdapter.download(storagePath);

      if (buffer.length <= DATA_URI_SIZE_THRESHOLD) {
        // Small file: inline as data URI (avoids extra API call)
        this.logger.debug(`File ${filename} (${buffer.length} bytes) — using inline data URI`);
        const base64 = buffer.toString('base64');
        return `data:${contentType};base64,${base64}`;
      }

      // Large file: upload via Replicate Files API
      this.logger.debug(`File ${filename} (${buffer.length} bytes) — uploading via Replicate Files API`);
      return await this.uploadToReplicateFiles(buffer, contentType, filename, apiToken);
    } catch (error) {
      this.logger.warn(`Failed to resolve file for Replicate input: ${storagePath}`, error);
      return null;
    }
  }

  /**
   * Upload a file to Replicate's Files API (POST /v1/files).
   * Returns the serving URL (urls.get) which can be passed directly as a prediction input.
   * Files auto-expire after 24 hours — no cleanup needed.
   */
  private async uploadToReplicateFiles(
    buffer: Buffer,
    contentType: string,
    filename: string,
    apiToken: string,
  ): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([buffer as unknown as BlobPart], { type: contentType });
    formData.append('content', blob, filename);

    const response = await fetch(`${REPLICATE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Replicate Files API upload failed (${response.status}): ${errorBody}`);
    }

    const result = (await response.json()) as { urls?: { get?: string }; id?: string };
    const servingUrl = result.urls?.get;

    if (!servingUrl) {
      throw new Error('Replicate Files API response missing urls.get');
    }

    this.logger.debug(`Uploaded file to Replicate: ${servingUrl}`);
    return servingUrl;
  }

  /**
   * Convert an internal /api/uploads/... URL to a storage path using deployment context.
   */
  private resolveApiUrlToStoragePath(apiUrl: string, context: PipelineContext): string | null {
    const owner = context.deployment?.owner;
    const repo = context.deployment?.repo;
    if (!owner || !repo) return null;

    const pathAfterUploads = apiUrl.replace('/api/uploads/', '');
    return `${owner}/${repo}/uploads/${pathAfterUploads}`;
  }

  /**
   * Look through previous step outputs to find the content_type for a given storage_path.
   */
  private findContentTypeFromSteps(storagePath: string, context: PipelineContext): string | null {
    for (const stepOutput of Object.values(context.stepOutputs)) {
      if (stepOutput && typeof stepOutput === 'object') {
        const output = stepOutput as Record<string, unknown>;
        if (output.storage_path === storagePath && typeof output.content_type === 'string') {
          return output.content_type;
        }
      }
    }
    return null;
  }

  /**
   * Guess MIME type from file extension as fallback.
   */
  private guessContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      webm: 'video/webm',
      txt: 'text/plain',
      json: 'application/json',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Resolve a model identifier to its latest version hash.
   * Tries the model as-is first (works for official models), then
   * fetches the latest version from the API for community models.
   */
  private async resolveLatestVersion(model: string, apiToken: string): Promise<string> {
    try {
      const response = await fetch(
        `${REPLICATE_API_BASE}/models/${model}/versions`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );

      if (!response.ok) {
        // Fallback: try using the model identifier directly (works for official models)
        this.logger.warn(`Could not fetch versions for ${model} (${response.status}), using model ID directly`);
        return model;
      }

      const data = (await response.json()) as { results?: { id: string }[] };
      const latestVersion = data.results?.[0]?.id;

      if (!latestVersion) {
        this.logger.warn(`No versions found for ${model}, using model ID directly`);
        return model;
      }

      this.logger.debug(`Resolved ${model} to version ${latestVersion.substring(0, 12)}...`);
      return latestVersion;
    } catch (error) {
      this.logger.warn(`Failed to resolve version for ${model}, using model ID directly`, error);
      return model;
    }
  }

  private async pollPrediction(
    predictionId: string,
    apiToken: string,
    maxAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS,
  ): Promise<Record<string, unknown>> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(
        `${REPLICATE_API_BASE}/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to poll prediction: ${response.statusText}`);
      }

      const prediction = (await response.json()) as Record<string, unknown>;

      if (
        prediction.status === 'succeeded' ||
        prediction.status === 'failed' ||
        prediction.status === 'canceled'
      ) {
        return prediction;
      }
    }

    throw new Error(`Prediction ${predictionId} timed out after ${maxAttempts} attempts`);
  }
}
