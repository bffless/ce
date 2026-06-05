import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { UploadRecordService } from '../upload-record.service';

export interface PresignedUploadHandlerConfig {
  /**
   * Storage sub-directory (e.g. "images", "documents")
   */
  subDir: string;

  /**
   * Enable YYYY-MM-DD date folders in the storage path
   * @default false
   */
  dateBucket?: boolean;

  /**
   * Expression resolving to the original filename for the upload.
   * @default "request.body.filename"
   */
  filename?: string;

  /**
   * Presigned URL expiration in seconds.
   * @default 3600
   */
  expiresIn?: number;

  /**
   * Maximum file size in bytes. Echoed back to the client as a hint and
   * enforced at the register step (the backend never sees the bytes here).
   */
  maxFileSize?: number;

  /**
   * Allowed MIME type patterns. Echoed back to the client as a hint and
   * enforced at the register step.
   */
  allowedMimeTypes?: string[];
}

/**
 * Presigned Upload Handler (prepare phase)
 *
 * Mints a time-limited presigned PUT URL so the client can upload a file
 * DIRECTLY to the storage bucket, bypassing nginx and the backend entirely.
 * No bytes pass through the server. After the client PUTs the file, it calls a
 * second pipeline using `register_upload` to verify the object and write the
 * DB records.
 *
 * Only works on storage backends that support presigned uploads (S3, GCS,
 * MinIO, Azure). On local storage this fails with PRESIGNED_NOT_SUPPORTED —
 * use `file_upload_handler` (proxied) instead.
 */
@Injectable()
export class PresignedUploadHandler
  implements StepHandler<PresignedUploadHandlerConfig>
{
  readonly type = 'presigned_upload' as const;
  private readonly logger = new Logger(PresignedUploadHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly uploadRecords: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: PresignedUploadHandlerConfig): void {
    if (!config.subDir) {
      throw new ConfigurationError('subDir is required', 'presigned_upload');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as PresignedUploadHandlerConfig;
    const stepName = step.name || 'presigned_upload';

    // This path only works when the storage backend can mint presigned URLs.
    const supportsPresigned = this.storageAdapter.supportsPresignedUrls?.() ?? false;
    if (!supportsPresigned || !this.storageAdapter.getPresignedUploadUrl) {
      return {
        success: false,
        error: {
          code: 'PRESIGNED_NOT_SUPPORTED',
          message:
            'The configured storage backend does not support direct (presigned) uploads. ' +
            'Switch to S3, GCS, MinIO, or Azure storage, or use a proxied file_upload_handler instead.',
        },
      };
    }

    // Resolve the original filename from the request.
    const filenameExpr = config.filename || 'request.body.filename';
    const originalName = this.expressionEvaluator.evaluateExpression(
      filenameExpr,
      context,
      stepName,
    );
    if (!originalName || typeof originalName !== 'string') {
      return {
        success: false,
        error: {
          code: 'MISSING_FILENAME',
          message: `filename expression "${filenameExpr}" resolved to ${
            originalName === null ? 'null' : typeof originalName
          }, expected a filename string`,
        },
      };
    }

    const { owner, repo } = await this.uploadRecords.resolveOwnerRepo(context, stepName);
    const keyParts = this.uploadRecords.buildUploadKey({
      owner,
      repo,
      subDir: config.subDir,
      originalName,
      dateBucket: config.dateBucket,
    });

    const expiresIn = config.expiresIn ?? 3600;

    let uploadUrl: string;
    try {
      uploadUrl = await this.storageAdapter.getPresignedUploadUrl(
        keyParts.storageKey,
        expiresIn,
      );
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'PRESIGNED_URL_FAILED',
          message: `Failed to generate presigned upload URL: ${(err as Error).message}`,
        },
      };
    }

    this.logger.debug(
      `Issued presigned upload URL for ${keyParts.storageKey} (expires in ${expiresIn}s)`,
    );

    return {
      success: true,
      output: {
        // The client PUTs the file bytes to this URL.
        uploadUrl,
        // Pass storageKey + originalName back to the register_upload step.
        storageKey: keyParts.storageKey,
        publicPath: keyParts.publicPath,
        storedFilename: keyParts.storedFilename,
        originalName,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        // Hints for the client to validate before uploading.
        maxFileSize: config.maxFileSize ?? null,
        allowedMimeTypes: config.allowedMimeTypes ?? null,
      },
    };
  }
}
