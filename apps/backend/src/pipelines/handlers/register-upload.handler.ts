import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { UploadRecordService } from '../upload-record.service';

export interface RegisterUploadHandlerConfig {
  /**
   * Schema ID for storing upload metadata records
   */
  schemaId: string;

  /**
   * Storage sub-directory the file was uploaded into (e.g. "images").
   * Used for the sub_dir field; should match the presigned_upload step.
   * Supports expressions, e.g. "projects/{{request.body.projectId}}".
   */
  subDir: string;

  /**
   * Expression resolving to the storage key returned by the presigned_upload step.
   * @default "request.body.storageKey"
   */
  storageKey?: string;

  /**
   * Expression resolving to the original (display) filename.
   * Falls back to the filename parsed from the storage key.
   * @default "request.body.originalName"
   */
  originalName?: string;

  /**
   * Maximum allowed file size in bytes. Enforced against the actual uploaded
   * object via storage metadata. Violations delete the orphaned object.
   * @default 524288000 (500MB)
   */
  maxFileSize?: number;

  /**
   * Allowed MIME type patterns (e.g. ["image/*", "application/pdf"]).
   * Enforced against the object's stored content-type when available.
   * @default ["*\/*"]
   */
  allowedMimeTypes?: string[];

  /**
   * Delete the uploaded object if it fails size/MIME validation.
   * @default true
   */
  deleteOnViolation?: boolean;

  /**
   * Extra field mappings: { schemaField: "expression" }.
   * Built-in fields (filename, storage_path, etc.) are always included.
   */
  extraFields?: Record<string, string>;
}

const DEFAULT_MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Register Upload Handler (finalize phase)
 *
 * Second half of the presigned direct-to-bucket upload flow. After the client
 * has PUT the file directly to storage using the URL from `presigned_upload`,
 * this step verifies the object actually landed, reads its true size/MIME from
 * storage metadata, enforces limits, and writes the SAME pipeline_data + asset
 * records the proxied file_upload_handler would have — so both upload paths look
 * identical in the database. The bytes never pass through the backend.
 */
@Injectable()
export class RegisterUploadHandler
  implements StepHandler<RegisterUploadHandlerConfig>
{
  readonly type = 'register_upload' as const;
  private readonly logger = new Logger(RegisterUploadHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
    private readonly uploadRecords: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: RegisterUploadHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'register_upload');
    }
    if (!config.subDir) {
      throw new ConfigurationError('subDir is required', 'register_upload');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as RegisterUploadHandlerConfig;
    const stepName = step.name || 'register_upload';

    // Verify schema exists and belongs to this project.
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

    // Resolve the storage key the client claims it uploaded to.
    const storageKeyExpr = config.storageKey || 'request.body.storageKey';
    const rawStorageKey = this.expressionEvaluator.evaluateExpression(
      storageKeyExpr,
      context,
      stepName,
    );
    if (!rawStorageKey || typeof rawStorageKey !== 'string') {
      return {
        success: false,
        error: {
          code: 'MISSING_STORAGE_KEY',
          message: `storageKey expression "${storageKeyExpr}" resolved to ${
            rawStorageKey === null ? 'null' : typeof rawStorageKey
          }, expected the storageKey returned by the presigned_upload step`,
        },
      };
    }

    // Security: confirm the key stays within this project's uploads area.
    // Prevents an untrusted client from registering arbitrary storage keys.
    const { owner, repo } = await this.uploadRecords.resolveOwnerRepo(context, stepName);
    const keyParts = this.uploadRecords.parseUploadKey(rawStorageKey, owner, repo);
    if (!keyParts) {
      return {
        success: false,
        error: {
          code: 'INVALID_STORAGE_KEY',
          message:
            'storageKey is not a valid upload key for this project. ' +
            'It must be the key returned by a presigned_upload step.',
        },
      };
    }

    // Confirm the object actually exists (client really did upload it).
    const exists = await this.storageAdapter.exists(keyParts.storageKey);
    if (!exists) {
      return {
        success: false,
        error: {
          code: 'UPLOAD_NOT_FOUND',
          message:
            'No uploaded file found at the given storageKey. ' +
            'The presigned PUT may have failed or not completed.',
        },
      };
    }

    // Read true size + content-type from storage metadata (not client-supplied).
    const metadata = await this.storageAdapter.getMetadata(keyParts.storageKey);
    const size = metadata.size;
    const mimeType = metadata.mimeType || 'application/octet-stream';

    // Enforce size limit against the actual object.
    const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    const deleteOnViolation = config.deleteOnViolation ?? true;
    if (size > maxFileSize) {
      if (deleteOnViolation) {
        await this.safeDelete(keyParts.storageKey);
      }
      return {
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size ${size} bytes exceeds maximum ${maxFileSize} bytes`,
        },
      };
    }

    // Enforce MIME type when storage reports a meaningful content-type.
    // (Presigned PUTs only record a content-type if the client set the header,
    // so an octet-stream fallback is treated as "unknown" and not rejected.)
    const allowedMimeTypes = config.allowedMimeTypes || ['*/*'];
    const mimeKnown = !!metadata.mimeType && mimeType !== 'application/octet-stream';
    if (mimeKnown && !this.uploadRecords.isMimeTypeAllowed(mimeType, allowedMimeTypes)) {
      if (deleteOnViolation) {
        await this.safeDelete(keyParts.storageKey);
      }
      return {
        success: false,
        error: {
          code: 'INVALID_MIME_TYPE',
          message: `File type "${mimeType}" is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
        },
      };
    }

    // Resolve the display name (client-provided, falls back to the key's name).
    let originalName = keyParts.sanitizedFilename;
    const originalNameExpr = config.originalName || 'request.body.originalName';
    const resolvedName = this.expressionEvaluator.evaluateExpression(
      originalNameExpr,
      context,
      stepName,
    );
    if (resolvedName && typeof resolvedName === 'string') {
      originalName = resolvedName;
    }

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

    // subDir is recorded as the sub_dir metadata field; it may be an expression
    // (e.g. "projects/{{request.body.projectId}}") to match the presigned step.
    const subDir = this.uploadRecords.resolveSubDir(config.subDir, context, stepName);

    const output = await this.uploadRecords.createUploadRecords({
      context,
      schemaId: config.schemaId,
      schemaVersion: schema.version,
      subDir,
      storageKey: keyParts.storageKey,
      storedFilename: keyParts.storedFilename,
      sanitizedFilename: keyParts.sanitizedFilename,
      originalName,
      mimeType,
      size,
      publicPath: keyParts.publicPath,
      contentHash: metadata.etag ?? null,
      extraData,
      schemaFields: schema.fields,
    });

    return { success: true, output };
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.storageAdapter.delete(key);
    } catch (err) {
      this.logger.warn(`Failed to delete orphaned upload ${key}: ${err}`);
    }
  }
}
