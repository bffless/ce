import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, FileUploadHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { UploadRecordService } from '../upload-record.service';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import * as path from 'path';

/**
 * File Upload Handler
 *
 * Handles file uploads from two sources:
 * 1. Multipart form data (default) — user uploads a file via form
 * 2. URL download (sourceUrl) — fetches a file from a URL (e.g., Replicate output)
 *
 * In both cases, stores the file in the storage adapter and creates
 * pipeline_data + asset records with the same output shape.
 */
@Injectable()
export class FileUploadHandler implements StepHandler<FileUploadHandlerConfig> {
  readonly type = 'file_upload_handler' as const;
  private readonly logger = new Logger(FileUploadHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
    private readonly uploadRecords: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FileUploadHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'file_upload_handler');
    }
    if (!config.subDir) {
      throw new ConfigurationError('subDir is required', 'file_upload_handler');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FileUploadHandlerConfig;
    const stepName = step.name || 'file_upload_handler';

    this.logger.debug(`Executing file upload handler for step '${stepName}'`);

    // Verify schema exists and belongs to project
    const schema = await this.schemasService.getById(config.schemaId);
    if (!schema) {
      throw new SchemaNotFoundError(config.schemaId, stepName);
    }
    if (schema.projectId !== context.projectId) {
      throw new ConfigurationError(
        `Schema '${config.schemaId}' does not belong to this project`,
        stepName,
      );
    }

    // Determine file source: URL download or multipart form upload
    let fileBuffer: Buffer;
    let mimeType: string;
    let originalName: string;

    if (config.sourceUrl) {
      // URL download mode: fetch the file from a URL expression
      const resolved = await this.resolveFileFromUrl(config.sourceUrl, context, stepName);
      if (!resolved.success) {
        return resolved.error!;
      }
      fileBuffer = resolved.buffer!;
      mimeType = resolved.mimeType!;
      originalName = resolved.filename!;
    } else {
      // Multipart form upload mode (original behavior)
      const file = (context.request as any).file as Express.Multer.File | undefined;
      if (!file) {
        return {
          success: false,
          error: {
            code: 'NO_FILE',
            message: 'No file uploaded. Send a multipart form with a "file" field.',
          },
        };
      }

      // Validate MIME type
      const allowedMimeTypes = config.allowedMimeTypes || ['*/*'];
      if (!this.uploadRecords.isMimeTypeAllowed(file.mimetype, allowedMimeTypes)) {
        return {
          success: false,
          error: {
            code: 'INVALID_MIME_TYPE',
            message: `File type "${file.mimetype}" is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
          },
        };
      }

      fileBuffer = file.buffer;
      mimeType = file.mimetype;
      // Multer encodes originalname as Latin-1; decode to UTF-8 for proper unicode support
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    }

    // Validate file size
    const maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // default 10MB
    if (fileBuffer.length > maxFileSize) {
      return {
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size ${fileBuffer.length} bytes exceeds maximum ${maxFileSize} bytes`,
        },
      };
    }

    // Convert image format if configured (e.g., PNG → WebP)
    if (config.convertTo && mimeType.startsWith('image/')) {
      const isHeic = mimeType === 'image/heic' || mimeType === 'image/heif';
      if (isHeic) {
        return {
          success: false,
          error: {
            code: 'UNSUPPORTED_FORMAT',
            message: 'HEIC/HEIF files must be converted to JPEG or WebP in the browser before uploading.',
          },
        };
      }

      const targetMime = `image/${config.convertTo}`;
      if (mimeType !== targetMime) {
        try {
          const sharp = (await import('sharp')).default;
          let pipeline = sharp(fileBuffer);

          switch (config.convertTo) {
            case 'png': pipeline = pipeline.png(); break;
            case 'jpeg': pipeline = pipeline.jpeg({ quality: 90 }); break;
            case 'webp': pipeline = pipeline.webp({ quality: 90 }); break;
          }

          fileBuffer = await pipeline.toBuffer();

          mimeType = targetMime;
          const ext = '.' + config.convertTo;
          const baseName = path.basename(originalName, path.extname(originalName));
          originalName = baseName + ext;
          this.logger.debug(`Converted image to ${config.convertTo} (${fileBuffer.length} bytes)`);
        } catch (err) {
          return {
            success: false,
            error: {
              code: 'IMAGE_CONVERSION_FAILED',
              message: `Failed to convert image from ${mimeType} to ${config.convertTo}: ${(err as Error).message}`,
            },
          };
        }
      }
    }

    // Apply filename override if configured
    if (config.filename) {
      const resolved = this.expressionEvaluator.evaluateExpression(
        config.filename,
        context,
        stepName,
      );
      if (resolved && typeof resolved === 'string') {
        // Preserve extension from original if the override doesn't have one
        const overrideExt = path.extname(resolved);
        const originalExt = path.extname(originalName);
        originalName = overrideExt ? resolved : resolved + originalExt;
      }
    }

    // Build storage key (shared with the presigned upload path).
    const { owner, repo } = await this.uploadRecords.resolveOwnerRepo(context, stepName);
    const keyParts = this.uploadRecords.buildUploadKey({
      owner,
      repo,
      subDir: config.subDir,
      originalName,
      dateBucket: config.dateBucket,
    });

    // Upload to storage (proxied — bytes pass through the backend).
    await this.storageAdapter.upload(fileBuffer, keyParts.storageKey, {
      mimeType,
    });

    // Compute content hash
    const contentHash = createHash('md5').update(fileBuffer).digest('hex');

    // Evaluate extra field expressions.
    let extraData: Record<string, unknown> | undefined;
    if (config.extraFields) {
      extraData = {};
      for (const [fieldName, expression] of Object.entries(config.extraFields)) {
        extraData[fieldName] = this.expressionEvaluator.evaluateExpression(
          expression,
          context,
          stepName,
        );
      }
    }

    // Write pipeline_data + asset records (shared with the presigned path).
    const output = await this.uploadRecords.createUploadRecords({
      context,
      schemaId: config.schemaId,
      schemaVersion: schema.version,
      subDir: config.subDir,
      storageKey: keyParts.storageKey,
      storedFilename: keyParts.storedFilename,
      sanitizedFilename: keyParts.sanitizedFilename,
      originalName,
      mimeType,
      size: fileBuffer.length,
      publicPath: keyParts.publicPath,
      contentHash,
      extraData,
    });

    return { success: true, output };
  }

  /**
   * Fetch a file from a URL (evaluated from an expression).
   * Extracts filename from URL path or Content-Disposition header,
   * and MIME type from Content-Type header.
   */
  private async resolveFileFromUrl(
    sourceUrlExpression: string,
    context: PipelineContext,
    stepName: string,
  ): Promise<{
    success: boolean;
    buffer?: Buffer;
    mimeType?: string;
    filename?: string;
    error?: StepResult;
  }> {
    const url = this.expressionEvaluator.evaluateExpression(
      sourceUrlExpression,
      context,
      stepName,
    );

    if (!url || typeof url !== 'string') {
      return {
        success: false,
        error: {
          success: false,
          error: {
            code: 'INVALID_SOURCE_URL',
            message: `sourceUrl expression "${sourceUrlExpression}" resolved to ${url === null ? 'null' : typeof url}, expected a URL string`,
          },
        },
      };
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return {
        success: false,
        error: {
          success: false,
          error: {
            code: 'INVALID_SOURCE_URL',
            message: `sourceUrl must be an HTTP(S) URL, got: ${url.substring(0, 100)}`,
          },
        },
      };
    }

    try {
      this.logger.debug(`Downloading file from URL: ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        return {
          success: false,
          error: {
            success: false,
            error: {
              code: 'SOURCE_URL_FETCH_FAILED',
              message: `Failed to download file from URL (${response.status}): ${url}`,
            },
          },
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Extract MIME type from Content-Type header
      const contentType = response.headers.get('content-type');
      const mimeType = contentType?.split(';')[0]?.trim() || 'application/octet-stream';

      // Extract filename from Content-Disposition header or URL path
      let filename = this.extractFilenameFromHeaders(response.headers);
      if (!filename) {
        filename = this.extractFilenameFromUrl(url);
      }

      return { success: true, buffer, mimeType, filename };
    } catch (error) {
      return {
        success: false,
        error: {
          success: false,
          error: {
            code: 'SOURCE_URL_FETCH_FAILED',
            message: `Failed to download file from URL: ${(error as Error).message}`,
          },
        },
      };
    }
  }

  /**
   * Try to extract filename from Content-Disposition header.
   */
  private extractFilenameFromHeaders(headers: Headers): string | null {
    const disposition = headers.get('content-disposition');
    if (!disposition) return null;

    // Match filename="..." or filename*=UTF-8''...
    const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
    return match ? decodeURIComponent(match[1].replace(/"/g, '')) : null;
  }

  /**
   * Extract filename from URL path as fallback.
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').pop();
      if (lastSegment && lastSegment.includes('.')) {
        return decodeURIComponent(lastSegment);
      }
    } catch {
      // ignore URL parse errors
    }
    return `download-${randomUUID().substring(0, 8)}`;
  }
}
