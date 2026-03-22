import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, FileServeHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { CacheConfigService } from '../../cache-rules/cache-config.service';
import { db } from '../../db/client';
import { projects } from '../../db/schema';
import { eq } from 'drizzle-orm';
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
    private readonly cacheConfigService: CacheConfigService,
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
          'Could not resolve project for file serving storage path',
          stepName,
        );
      }
      owner = project.owner;
      repo = project.name;
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
      // Strip query string first since $request_uri includes it
      const rawOriginalUri = context.metadata.headers['x-original-uri'] as string | undefined;
      const originalUri = rawOriginalUri?.split('?')[0];
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

      // Resolve cache headers: check cache rules first, fall back to config/default
      let cacheControlHeader: string;
      const cacheConfig = await this.cacheConfigService.getCacheConfig(
        context.projectId,
        requestPath,
        false,
      );
      if (cacheConfig.source === 'rule') {
        cacheControlHeader = this.cacheConfigService.buildCacheControlHeader(cacheConfig, true);
      } else {
        // No cache rule matched — use handler config default or 3600s
        const cacheMaxAge = config.cacheMaxAge ?? 3600;
        cacheControlHeader = `public, max-age=${cacheMaxAge}`;
      }

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
      res.setHeader('Cache-Control', cacheControlHeader);
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
