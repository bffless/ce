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
import crypto from 'crypto';

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
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
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
 * Serves files from storage through a pipeline using streaming.
 * Supports HTTP Range requests for efficient video/audio playback.
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
    const requestPath = context.metadata.path;
    const prefix = `/api/uploads/${config.subDir}/`;
    let filePath = '';

    if (requestPath.startsWith(prefix)) {
      filePath = requestPath.slice(prefix.length);
    } else {
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
      const cacheMaxAge = config.cacheMaxAge ?? 3600;
      cacheControlHeader = `public, max-age=${cacheMaxAge}`;
    }

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

    try {
      // Try streaming path first (avoids buffering entire file in memory)
      if (this.storageAdapter.downloadStream) {
        return await this.serveWithStream(
          storageKey,
          contentType,
          cacheControlHeader,
          context,
          res,
        );
      }

      // Fallback: buffer-based serving for adapters without stream support
      return await this.serveWithBuffer(storageKey, contentType, cacheControlHeader, res);
    } catch (error) {
      this.logger.debug(`File not found: ${storageKey}`);
      if (!res.headersSent) {
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

  /**
   * Stream file directly from storage to response.
   * Supports HTTP Range requests for video/audio seeking.
   */
  private async serveWithStream(
    storageKey: string,
    contentType: string,
    cacheControlHeader: string,
    context: PipelineContext,
    res: any,
  ): Promise<StepResult> {
    const result = await this.storageAdapter.downloadStream!(storageKey);
    const fileSize = result.size;
    const rangeHeader = context.metadata.headers['range'] as string | undefined;

    // Common headers for all responses
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', cacheControlHeader);
    if (result.etag) {
      // Mix cache-control into ETag so CDN refetches when cache rules change
      const combined = crypto.createHash('md5').update(`${result.etag.replace(/"/g, '')}:${cacheControlHeader}`).digest('hex');
      res.setHeader('ETag', `"${combined}"`);
    }

    if (rangeHeader) {
      // Parse Range header (e.g., "bytes=0-1023")
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        // Destroy the unused stream to prevent resource leaks
        if (typeof (result.stream as any).destroy === 'function') {
          (result.stream as any).destroy();
        }
        return { success: true, terminates: true };
      }

      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        if (typeof (result.stream as any).destroy === 'function') {
          (result.stream as any).destroy();
        }
        return { success: true, terminates: true };
      }

      const chunkSize = end - start + 1;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.status(206);

      // For range requests, we need to slice the stream
      // Pipe through and track bytes to only send the requested range
      let bytesRead = 0;
      const stream = result.stream;

      stream.on('data', (chunk: Buffer) => {
        const chunkStart = bytesRead;
        const chunkEnd = bytesRead + chunk.length;
        bytesRead += chunk.length;

        // Calculate overlap between this chunk and the requested range
        const overlapStart = Math.max(chunkStart, start);
        const overlapEnd = Math.min(chunkEnd, end + 1);

        if (overlapStart < overlapEnd) {
          const slice = chunk.slice(overlapStart - chunkStart, overlapEnd - chunkStart);
          res.write(slice);
        }

        // If we've read past the end, we can stop
        if (bytesRead > end) {
          if (typeof (stream as any).destroy === 'function') {
            (stream as any).destroy();
          }
          res.end();
        }
      });

      stream.on('end', () => {
        if (!res.writableEnded) {
          res.end();
        }
      });

      stream.on('error', (err: Error) => {
        this.logger.error(`Stream error during range serve: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        } else if (!res.writableEnded) {
          res.end();
        }
      });
    } else {
      // Full file response — stream directly
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.status(200);

      const stream = result.stream;
      stream.pipe(res);

      stream.on('error', (err: Error) => {
        this.logger.error(`Stream error during full serve: ${err.message}`);
        if (!res.writableEnded) {
          res.end();
        }
      });
    }

    return {
      success: true,
      terminates: true,
    };
  }

  /**
   * Fallback: buffer-based serving for adapters without stream support
   */
  private async serveWithBuffer(
    storageKey: string,
    contentType: string,
    cacheControlHeader: string,
    res: any,
  ): Promise<StepResult> {
    let data: Buffer;

    if (this.storageAdapter.downloadWithCacheInfo) {
      const result = await this.storageAdapter.downloadWithCacheInfo(storageKey);
      data = result.data;
    } else {
      data = await this.storageAdapter.download(storageKey);
    }

    let etag: string | undefined;
    try {
      const metadata = await this.storageAdapter.getMetadata(storageKey);
      etag = metadata.etag;
    } catch {
      // Non-fatal
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', cacheControlHeader);
    res.setHeader('Accept-Ranges', 'bytes');
    if (etag) {
      // Mix cache-control into ETag so CDN refetches when cache rules change
      const combined = crypto.createHash('md5').update(`${etag.replace(/"/g, '')}:${cacheControlHeader}`).digest('hex');
      res.setHeader('ETag', `"${combined}"`);
    }

    res.status(200).end(data);

    return {
      success: true,
      terminates: true,
    };
  }
}
