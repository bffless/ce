import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { sanitizeDownloadFilename } from '../../common/utils/download-filename.util';

export interface SignedUrlHandlerConfig {
  /**
   * Storage key / path (supports expressions, e.g. "steps.upload.storage_path")
   */
  path: string;

  /**
   * URL expiration in seconds
   * @default 3600
   */
  expiresIn?: number;

  /**
   * Optional filename to force a download under (supports expressions, e.g.
   * "steps.resolvePath.filename", or a literal like "video.mp4"). When present
   * and non-empty after sanitizing, the signed URL carries
   * `Content-Disposition: attachment; filename="..."`.
   *
   * Ignored on local storage, which cannot presign.
   */
  filename?: string;
}

/**
 * Re-exported from `common/utils/download-filename.util` so existing importers
 * (and the handler's own spec) keep working. The implementation moved out of
 * this file because the local-filesystem signed-download route in `storage/`
 * needs the same sanitizer, and `storage/` must not import from `pipelines/`.
 */
export { sanitizeDownloadFilename };

/**
 * Signed URL Handler
 *
 * Generates a time-limited presigned URL for a file in storage.
 * Uses the storage adapter's getUrl() which returns presigned URLs
 * for S3/MinIO/GCS/Azure, or a backend-served URL for local storage.
 */
@Injectable()
export class SignedUrlHandler implements StepHandler<SignedUrlHandlerConfig> {
  readonly type = 'signed_url' as const;
  private readonly logger = new Logger(SignedUrlHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: SignedUrlHandlerConfig): void {
    if (!config.path) {
      throw new ConfigurationError('path is required', 'signed_url');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as SignedUrlHandlerConfig;
    const stepName = step.name || 'signed_url';
    const expiresIn = config.expiresIn ?? 3600;

    // Resolve the path expression
    const resolvedPath = this.expressionEvaluator.evaluateExpression(
      config.path,
      context,
      stepName,
    );

    if (!resolvedPath || typeof resolvedPath !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_PATH',
          message: `path expression "${config.path}" resolved to ${resolvedPath === null ? 'null' : typeof resolvedPath}, expected a storage path string`,
        },
      };
    }

    // Resolve + sanitize the optional download filename. An absent or
    // unusable filename means no disposition at all, which keeps every existing
    // caller (e.g. Studio's `useSignedBytes`) byte-identical.
    const resolvedFilename = config.filename
      ? this.expressionEvaluator.evaluateExpression(config.filename, context, stepName)
      : undefined;
    const downloadFilename = sanitizeDownloadFilename(resolvedFilename);

    try {
      const url = await this.storageAdapter.getUrl(
        resolvedPath,
        expiresIn,
        downloadFilename ? { downloadFilename } : undefined,
      );

      this.logger.debug(`Generated signed URL for ${resolvedPath} (expires in ${expiresIn}s)`);

      return {
        success: true,
        output: { url },
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'SIGNED_URL_FAILED',
          message: `Failed to generate signed URL: ${(err as Error).message}`,
        },
      };
    }
  }
}
