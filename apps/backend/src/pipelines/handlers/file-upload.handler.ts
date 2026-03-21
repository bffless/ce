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
import { assets, projects } from '../../db/schema';
import { AssetType } from '../../types/asset-type.enum';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';

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
      if (!this.isMimeTypeAllowed(file.mimetype, allowedMimeTypes)) {
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

    // Build storage key — get owner/repo from deployment context, or fall back to project lookup
    let owner = context.deployment?.owner;
    let repo = context.deployment?.repo;
    if (!owner || !repo) {
      const [project] = await db
        .select({ owner: projects.owner, name: projects.name })
        .from(projects)
        .where(eq(projects.id, context.projectId))
        .limit(1);
      if (!project) {
        throw new ConfigurationError(
          'Could not resolve project for file upload storage path',
          stepName,
        );
      }
      owner = project.owner;
      repo = project.name;
    }

    const uuid = randomUUID();
    const sanitizedFilename = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    let storageKey = `${owner}/${repo}/uploads/${config.subDir}`;

    if (config.dateBucket) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      storageKey += `/${today}`;
    }

    storageKey += `/${uuid}-${sanitizedFilename}`;

    // Upload to storage
    await this.storageAdapter.upload(fileBuffer, storageKey, {
      mimeType,
    });

    // Build the public URL path
    const publicPath = `/api/uploads/${config.subDir}/${uuid}-${sanitizedFilename}`;

    // Compute content hash
    const contentHash = createHash('md5').update(fileBuffer).digest('hex');

    // Create pipeline_data record with metadata
    const data: Record<string, unknown> = {
      filename: sanitizedFilename,
      storage_path: storageKey,
      content_type: mimeType,
      size: fileBuffer.length,
      url: publicPath,
      sub_dir: config.subDir,
      original_name: originalName,
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
        originalPath: originalName,
        storageKey,
        mimeType,
        size: fileBuffer.length,
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
        content_type: mimeType,
        size: fileBuffer.length,
        original_name: originalName,
      },
    };
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
