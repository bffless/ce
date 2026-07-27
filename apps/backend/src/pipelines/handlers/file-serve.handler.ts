import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, FileServeHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { CacheConfigService } from '../../cache-rules/cache-config.service';
import { resolveContentType } from '../../common/utils/content-type.util';
import { db } from '../../db/client';
import { projects } from '../../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

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
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FileServeHandlerConfig): void {
    const hasKey = typeof config.key === 'string' && config.key.length > 0;
    if (!config.subDir && !hasKey) {
      throw new ConfigurationError('Either "subDir" or "key" is required', 'file_serve_handler');
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

    const requestPath = context.metadata.path;

    // The relative path used to derive both the storage key and the content
    // type. In `key` mode it is the explicit (interpolated) key; otherwise it is
    // extracted from the request URL under /api/uploads/<subDir>/.
    let relativePath: string;

    const hasKey = typeof config.key === 'string' && config.key.length > 0;
    if (hasKey) {
      // Explicit key mode: a prior step (e.g. a manifest lookup) names the
      // object to serve, instead of it being derived from the request path.
      // The key is relative to the project's uploads root, mirroring
      // file_delete's `key`. This keeps a Site's assets served in-place under
      // /api/sites/<id>/<rel> so relative sub-resources re-enter the manifest.
      const resolved = this.expressionEvaluator.evaluateTemplate(
        config.key!,
        context,
        stepName,
      );
      const trimmed = (resolved ?? '').trim();
      if (!trimmed || trimmed === '/') {
        return {
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'Resolved key is empty' },
        };
      }
      if (resolved.includes('..')) {
        return {
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: `Resolved key "${resolved}" contains ".." — path traversal is not allowed`,
          },
        };
      }
      relativePath = resolved.replace(/^\/+/, '');
    } else {
      // Path-derived mode: extract the file path from the request URL.
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
      relativePath = `${config.subDir}/${sanitized}`;
    }

    const storageKey = `${owner}/${repo}/uploads/${relativePath}`;

    // The content type is resolved per response, not here: storage reports the
    // type it recorded for the object, which beats guessing from the extension.
    // `relativePath` is what that resolution falls back to.

    // Resolve cache headers: check cache rules first, fall back to config/default.
    // Files served through a pipeline are typically behind app-defined access
    // control this handler can't see, so the safe default is `private` (never a
    // shared/CDN cache) — `public` is opt-in via the step config. `cacheability`
    // is expression-interpolated like `key`, so a prior ACL-gate step can
    // resolve it per request (e.g. only when a served object is genuinely
    // Anyone-viewable). A matching cache rule's own `cacheability` still wins
    // over this default.
    const resolvedCacheability = config.cacheability
      ? this.expressionEvaluator.evaluateTemplate(config.cacheability, context, stepName)
      : undefined;
    const isPublicContent = resolvedCacheability === 'public';
    let cacheControlHeader: string;
    const cacheConfig = await this.cacheConfigService.getCacheConfig(
      context.projectId,
      requestPath,
      false,
    );
    if (cacheConfig.source === 'rule') {
      cacheControlHeader = this.cacheConfigService.buildCacheControlHeader(
        cacheConfig,
        isPublicContent,
      );
    } else {
      const cacheMaxAge = config.cacheMaxAge ?? 3600;
      cacheControlHeader = `${isPublicContent ? 'public' : 'private'}, max-age=${cacheMaxAge}`;
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
          relativePath,
          cacheControlHeader,
          context,
          res,
        );
      }

      // Fallback: buffer-based serving for adapters without stream support
      return await this.serveWithBuffer(storageKey, relativePath, cacheControlHeader, res);
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
   *
   * For range requests, only the requested byte range is fetched from storage
   * (via downloadStream's range options) and piped straight to the response so
   * backpressure is honored — never buffering the whole object in memory or
   * pulling the full file from storage for a partial request.
   */
  private async serveWithStream(
    storageKey: string,
    relativePath: string,
    cacheControlHeader: string,
    context: PipelineContext,
    res: any,
  ): Promise<StepResult> {
    const rangeHeader = context.metadata.headers['range'] as string | undefined;

    // Mix cache-control into ETag so CDN refetches when cache rules change
    const setEtag = (etag?: string) => {
      if (!etag) return;
      const combined = crypto
        .createHash('md5')
        .update(`${etag.replace(/"/g, '')}:${cacheControlHeader}`)
        .digest('hex');
      res.setHeader('ETag', `"${combined}"`);
    };

    // Pipe a storage stream to the response with backpressure + cleanup.
    const pipeStream = (stream: NodeJS.ReadableStream) => {
      // Commit the status line + headers synchronously, before this handler
      // returns. stream.pipe() only flushes headers on its first (async) data
      // chunk, so without this the proxy middleware sees res.headersSent === false
      // when the pipeline resolves and writes its own JSON result body over the
      // response — the client receives `{"success":true}` instead of the file.
      if (typeof res.flushHeaders === 'function' && !res.headersSent) {
        res.flushHeaders();
      }
      stream.pipe(res);
      stream.on('error', (err: Error) => {
        this.logger.error(`Stream error during serve: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        } else if (!res.writableEnded) {
          res.end();
        }
      });
      // If the client disconnects mid-stream (common when scrubbing video,
      // which cancels in-flight range requests), stop pulling from storage.
      res.on('close', () => {
        if (!res.writableEnded && typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
      });
    };

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', cacheControlHeader);

    if (rangeHeader) {
      // Need the total object size to validate the range and build Content-Range.
      const meta = await this.storageAdapter.getMetadata(storageKey);
      const fileSize = meta.size;

      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return { success: true, terminates: true };
      }

      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return { success: true, terminates: true };
      }

      // Fetch ONLY the requested range from storage.
      const { stream } = await this.storageAdapter.downloadStream!(storageKey, { start, end });

      res.setHeader('Content-Type', resolveContentType(relativePath, meta.mimeType));
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      setEtag(meta.etag);
      res.status(206);

      pipeStream(stream);
    } else {
      // Full file response — stream directly.
      const result = await this.storageAdapter.downloadStream!(storageKey);

      res.setHeader('Content-Type', resolveContentType(relativePath, result.mimeType));
      res.setHeader('Content-Length', result.size);
      setEtag(result.etag);
      res.status(200);

      pipeStream(result.stream);
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
    relativePath: string,
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
    let storedType: string | undefined;
    try {
      const metadata = await this.storageAdapter.getMetadata(storageKey);
      etag = metadata.etag;
      storedType = metadata.mimeType;
    } catch {
      // Non-fatal
    }

    res.setHeader('Content-Type', resolveContentType(relativePath, storedType));
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
