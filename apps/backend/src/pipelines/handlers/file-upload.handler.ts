import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, FileUploadHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { db } from '../../db/client';
import { assets } from '../../db/schema';
import { AssetType } from '../../types/asset-type.enum';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

/**
 * File Upload Handler
 *
 * Handles file uploads via multipart form data.
 * Stores files in the storage adapter and creates pipeline_data + asset records.
 */
@Injectable()
export class FileUploadHandler implements StepHandler<FileUploadHandlerConfig> {
  readonly type = 'file_upload_handler' as const;
  private readonly logger = new Logger(FileUploadHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly dataService: PipelineDataService,
    private readonly schemasService: PipelineSchemasService,
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

    // Extract file from multer-parsed request
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
    if (!this.isMimeTypeAllowed(file.mimetype, allowedMimeTypes)) {
      return {
        success: false,
        error: {
          code: 'INVALID_MIME_TYPE',
          message: `File type "${file.mimetype}" is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
        },
      };
    }

    // Validate file size
    const maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // default 10MB
    if (file.size > maxFileSize) {
      return {
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size ${file.size} bytes exceeds maximum ${maxFileSize} bytes`,
        },
      };
    }

    // Build storage key
    const owner = context.deployment?.owner;
    const repo = context.deployment?.repo;
    if (!owner || !repo) {
      throw new ConfigurationError(
        'Deployment context (owner/repo) is required for file uploads',
        stepName,
      );
    }

    const uuid = randomUUID();
    // Multer encodes originalname as Latin-1; decode to UTF-8 for proper unicode support
    const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const sanitizedFilename = decodedOriginalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    let storageKey = `${owner}/${repo}/uploads/${config.subDir}`;

    if (config.dateBucket) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      storageKey += `/${today}`;
    }

    storageKey += `/${uuid}-${sanitizedFilename}`;

    // Upload to storage
    await this.storageAdapter.upload(file.buffer, storageKey, {
      mimeType: file.mimetype,
    });

    // Build the public URL path
    const alias = context.deployment?.alias ?? 'production';
    const publicPath = `/api/uploads/${config.subDir}/${uuid}-${sanitizedFilename}`;

    // Compute content hash
    const contentHash = createHash('md5').update(file.buffer).digest('hex');

    // Create pipeline_data record with metadata
    const data: Record<string, unknown> = {
      filename: sanitizedFilename,
      storage_path: storageKey,
      content_type: file.mimetype,
      size: file.size,
      url: publicPath,
      sub_dir: config.subDir,
      original_name: decodedOriginalName,
    };

    // Evaluate extra field expressions and merge into data
    if (config.extraFields) {
      for (const [fieldName, expression] of Object.entries(config.extraFields)) {
        data[fieldName] = this.expressionEvaluator.evaluateExpression(
          expression,
          context,
          stepName,
        );
      }
    }

    const record = await this.dataService.create(
      config.schemaId,
      context.projectId,
      data,
      context.user?.id,
      context.deployment?.alias ?? null,
      schema.version,
    );

    // Create asset record
    try {
      await db.insert(assets).values({
        fileName: sanitizedFilename,
        originalPath: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        size: file.size,
        projectId: context.projectId,
        uploadedBy: context.user?.id || null,
        assetType: AssetType.UPLOADS,
        publicPath,
        contentHash,
      });
    } catch (err) {
      this.logger.warn(`Failed to create asset record: ${err}`);
      // Non-fatal - the upload and pipeline_data record are the source of truth
    }

    this.logger.debug(
      `Uploaded file "${sanitizedFilename}" to ${storageKey} (record ${record.id})`,
    );

    return {
      success: true,
      output: {
        id: record.id,
        filename: sanitizedFilename,
        url: publicPath,
        storage_path: storageKey,
        content_type: file.mimetype,
        size: file.size,
        original_name: decodedOriginalName,
      },
    };
  }

  /**
   * Check if a MIME type matches allowed patterns (supports glob like "image/*")
   */
  private isMimeTypeAllowed(mimeType: string, allowedTypes: string[]): boolean {
    for (const pattern of allowedTypes) {
      if (pattern === '*/*') return true;
      if (pattern === mimeType) return true;
      // Handle wildcard patterns like "image/*"
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (mimeType.startsWith(prefix + '/')) return true;
      }
    }
    return false;
  }
}
