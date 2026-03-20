import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, FileServeHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import * as path from 'path';

// Common MIME type lookup
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
};

/**
 * File Serve Handler
 *
 * Serves files from storage through a pipeline.
 * Access control is handled by pipeline validators, not this handler.
 */
@Injectable()
export class FileServeHandler implements StepHandler<FileServeHandlerConfig> {
  readonly type = 'file_serve_handler' as const;
  private readonly logger = new Logger(FileServeHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FileServeHandlerConfig): void {
    if (!config.subDir) {
      throw new ConfigurationError('subDir is required', 'file_serve_handler');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FileServeHandlerConfig;
    const stepName = step.name || 'file_serve_handler';

    this.logger.debug(`Executing file serve handler for step '${stepName}'`);

    const owner = context.deployment?.owner;
    const repo = context.deployment?.repo;
    if (!owner || !repo) {
      throw new ConfigurationError(
        'Deployment context (owner/repo) is required for file serving',
        stepName,
      );
    }

    // Extract the file path from the request URL
    // The wildcard portion comes after /api/uploads/{subDir}/
    const requestPath = context.metadata.path;
    const prefix = `/api/uploads/${config.subDir}/`;
    let filePath = '';

    if (requestPath.startsWith(prefix)) {
      filePath = requestPath.slice(prefix.length);
    } else {
      // Try to extract from X-Original-URI if available
      const originalUri = context.metadata.headers['x-original-uri'] as string | undefined;
      if (originalUri && originalUri.includes(prefix)) {
        filePath = originalUri.slice(originalUri.indexOf(prefix) + prefix.length);
      }
    }

    if (!filePath) {
      return {
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'No file path specified',
        },
      };
    }

    // Sanitize path to prevent traversal attacks
    const sanitized = filePath.replace(/\.\./g, '').replace(/\/\//g, '/');
    const storageKey = `${owner}/${repo}/uploads/${config.subDir}/${sanitized}`;

    try {
      // Check if storage adapter supports downloadWithCacheInfo
      let data: Buffer;
      let etag: string | undefined;

      if (this.storageAdapter.downloadWithCacheInfo) {
        const result = await this.storageAdapter.downloadWithCacheInfo(storageKey);
        data = result.data;
      } else {
        data = await this.storageAdapter.download(storageKey);
      }

      // Try to get metadata for ETag
      try {
        const metadata = await this.storageAdapter.getMetadata(storageKey);
        etag = metadata.etag;
      } catch {
        // Non-fatal
      }

      // Determine content type from file extension
      const ext = path.extname(sanitized).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const cacheMaxAge = config.cacheMaxAge ?? 3600;

      // Set response headers and stream content
      const res = context.request.res;
      if (!res) {
        return {
          success: false,
          error: {
            code: 'NO_RESPONSE',
            message: 'Response object not available',
          },
        };
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', data.length);
      res.setHeader('Cache-Control', `public, max-age=${cacheMaxAge}`);
      if (etag) {
        res.setHeader('ETag', etag);
      }

      res.status(200).end(data);

      return {
        success: true,
        terminates: true, // Signal that response was already sent
      };
    } catch (error) {
      this.logger.debug(`File not found: ${storageKey}`);
      const res = context.request.res;
      if (res && !res.headersSent) {
        res.status(404).json({
          error: 'File not found',
          code: 'FILE_NOT_FOUND',
        });
      }
      return {
        success: true,
        terminates: true,
      };
    }
  }
}
