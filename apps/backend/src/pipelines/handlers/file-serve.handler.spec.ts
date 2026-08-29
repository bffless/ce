// The handler resolves an attachment filename from the asset row for the
// served key. Chainable mock: queue a result per query with db.__queue(rows).
jest.mock('../../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'orderBy', 'limit'];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) {
    chainable[method] = jest.fn(() => chainable);
  }
  chainable.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { db } from '../../db/client';
import { FileServeHandler, isDownloadFlagTruthy } from './file-serve.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { IStorageAdapter } from '../../storage/storage.interface';
import { CacheConfigService } from '../../cache-rules/cache-config.service';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

describe('FileServeHandler — streaming & range', () => {
  const makeRes = () => {
    const res: any = {
      headersSent: false,
      writableEnded: false,
      setHeader: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      json: jest.fn(),
    };
    res.status = jest.fn(() => res);
    // Mirror Node: flushHeaders commits the headers synchronously.
    res.flushHeaders = jest.fn(() => {
      res.headersSent = true;
    });
    return res;
  };

  const makeStream = () => ({ pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() });

  const buildHandler = (storage: Partial<IStorageAdapter>) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const cacheConfigService = {
      getCacheConfig: jest.fn().mockResolvedValue({ source: 'default' }),
      buildCacheControlHeader: jest.fn(),
    } as unknown as CacheConfigService;
    return new FileServeHandler(
      registry,
      storage as IStorageAdapter,
      cacheConfigService,
      new ExpressionEvaluator(),
    );
  };

  const step = {
    id: 'serve',
    name: 'serve',
    handlerType: 'file_serve_handler',
    config: { subDir: 'export' },
  } as unknown as PipelineStep;

  const buildContext = (
    res: any,
    headers: Record<string, unknown>,
    steps: Record<string, unknown> = {},
  ): PipelineContext =>
    ({
      projectId: 'p1',
      deployment: { owner: 'o', repo: 'r', commitSha: 'sha' },
      metadata: { path: '/api/uploads/export/video.mp4', headers },
      stepOutputs: steps,
      request: { res },
    }) as unknown as PipelineContext;

  const STORAGE_KEY = 'o/r/uploads/export/video.mp4';

  it('serves a range request by fetching only the requested bytes and piping (206)', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn().mockResolvedValue({ key: STORAGE_KEY, size: 10000, etag: 'abc' }),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, { range: 'bytes=0-1023' }), step);

    // Only the requested range is fetched from storage.
    expect(storage.downloadStream).toHaveBeenCalledWith(STORAGE_KEY, { start: 0, end: 1023 });
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/10000');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 1024);
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('treats an open-ended range (bytes=0-) as through end of file', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn().mockResolvedValue({ key: STORAGE_KEY, size: 10000, etag: 'abc' }),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, { range: 'bytes=0-' }), step);

    expect(storage.downloadStream).toHaveBeenCalledWith(STORAGE_KEY, { start: 0, end: 9999 });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-9999/10000');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 10000);
  });

  it('streams the whole object with no range options when there is no Range header (200)', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, {}), step);

    expect(storage.downloadStream).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.getMetadata).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 10000);
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('flushes headers synchronously so the response is committed before returning (no result body clobber)', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, {}), step);

    // Headers must be flushed before piping (pipe only flushes on its first
    // async chunk), and committed before the handler resolves — otherwise the
    // proxy middleware's `if (res.headersSent) return` guard misses and it
    // overwrites the stream with the pipeline's JSON result body.
    expect(res.flushHeaders).toHaveBeenCalled();
    const flushOrder = res.flushHeaders.mock.invocationCallOrder[0];
    const pipeOrder = stream.pipe.mock.invocationCallOrder[0];
    expect(flushOrder).toBeLessThan(pipeOrder);
    expect(res.headersSent).toBe(true);
  });

  it('returns 416 for an unsatisfiable range without touching storage data', async () => {
    const storage = {
      downloadStream: jest.fn(),
      getMetadata: jest.fn().mockResolvedValue({ key: STORAGE_KEY, size: 1000, etag: 'abc' }),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, { range: 'bytes=2000-3000' }), step);

    expect(res.status).toHaveBeenCalledWith(416);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */1000');
    expect(storage.downloadStream).not.toHaveBeenCalled();
  });

  // Pipeline-served files are typically behind app-defined access control
  // (e.g. an ACL gate), but this handler can't see that. Defaulting to `public`
  // lets a CDN cache and serve gated bytes to anyone — so the safe default is
  // `private` (browser-only, never a shared/CDN cache). Public is opt-in.
  it('defaults Cache-Control to private when there is no rule and no override', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();

    await handler.execute(buildContext(res, {}), step);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Cache-Control',
      expect.stringContaining('public'),
    );
  });

  it('serves public only when the step opts in via cacheability: "public"', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const publicStep = {
      ...step,
      config: { subDir: 'export', cacheability: 'public' },
    } as unknown as PipelineStep;

    await handler.execute(buildContext(res, {}), publicStep);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
  });

  // `cacheability` is expression-interpolated like `key`, so an app's ACL-gate
  // step (e.g. one that resolves an "Anyone can view" grant) can drive the
  // Cache-Control directive per request instead of a fixed step config.
  it('resolves cacheability from a template expression populated by a prior ACL-gate step', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const gatedStep = {
      ...step,
      config: { subDir: 'export', cacheability: '{{steps.gate.cacheability}}' },
    } as unknown as PipelineStep;

    await handler.execute(buildContext(res, {}, { gate: { cacheability: 'public' } }), gatedStep);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
  });

  it('stays private when the resolved cacheability expression is not exactly "public"', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const gatedStep = {
      ...step,
      config: { subDir: 'export', cacheability: '{{steps.gate.cacheability}}' },
    } as unknown as PipelineStep;

    await handler.execute(buildContext(res, {}, { gate: { cacheability: 'private' } }), gatedStep);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
  });

  it('stays private when the cacheability expression cannot be resolved (step never ran)', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10000, etag: 'abc' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const gatedStep = {
      ...step,
      config: { subDir: 'export', cacheability: '{{steps.gate.cacheability}}' },
    } as unknown as PipelineStep;

    await handler.execute(buildContext(res, {}, {}), gatedStep);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
  });
});

// An explicit `key` lets a prior step (e.g. a manifest lookup) name the object to
// serve, instead of deriving it from the request path. This keeps a Site's assets
// served in-place under /api/sites/<id>/<rel> (no cross-namespace redirect), so
// relative sub-resources re-enter the manifest. The key is relative to the
// project's uploads root ({owner}/{repo}/uploads/), mirroring file_delete's `key`.
describe('FileServeHandler — explicit key mode', () => {
  const makeRes = () => {
    const res: any = {
      headersSent: false,
      writableEnded: false,
      setHeader: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      json: jest.fn(),
    };
    res.status = jest.fn(() => res);
    // Mirror Node: flushHeaders commits the headers synchronously.
    res.flushHeaders = jest.fn(() => {
      res.headersSent = true;
    });
    return res;
  };

  const makeStream = () => ({ pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() });

  const buildHandler = (storage: Partial<IStorageAdapter>) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const cacheConfigService = {
      getCacheConfig: jest.fn().mockResolvedValue({ source: 'default' }),
      buildCacheControlHeader: jest.fn(),
    } as unknown as CacheConfigService;
    return new FileServeHandler(
      registry,
      storage as IStorageAdapter,
      cacheConfigService,
      new ExpressionEvaluator(),
    );
  };

  const buildContext = (
    res: any,
    path: string,
    steps: Record<string, unknown> = {},
  ): PipelineContext =>
    ({
      projectId: 'p1',
      deployment: { owner: 'o', repo: 'r', commitSha: 'sha' },
      metadata: { path, headers: {} },
      stepOutputs: steps,
      request: { res },
    }) as unknown as PipelineContext;

  it('serves the object named by `key` (relative to uploads root), ignoring the request path', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 42, etag: 'e' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const step = {
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { key: 'content/abc-styles.css' },
    } as unknown as PipelineStep;

    await handler.execute(buildContext(res, '/api/sites/site-123/styles.css'), step);

    expect(storage.downloadStream).toHaveBeenCalledWith('o/r/uploads/content/abc-styles.css');
    expect(res.status).toHaveBeenCalledWith(200);
    // Content-Type comes from the key's extension, not the request path.
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/css; charset=utf-8');
  });

  it('interpolates a `key` expression resolved from a prior step', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 10, etag: 'e' }),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const step = {
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { key: '{{steps.resolve.serveKey}}' },
    } as unknown as PipelineStep;

    await handler.execute(
      buildContext(res, '/api/sites/site-123/app.js', {
        resolve: { serveKey: 'content/def-app.js' },
      }),
      step,
    );

    expect(storage.downloadStream).toHaveBeenCalledWith('o/r/uploads/content/def-app.js');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/javascript; charset=utf-8',
    );
  });

  it('rejects a resolved key containing ".." (path traversal)', async () => {
    const storage = {
      downloadStream: jest.fn(),
      getMetadata: jest.fn(),
    };
    const handler = buildHandler(storage);
    const res = makeRes();
    const step = {
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { key: 'content/../../etc/passwd' },
    } as unknown as PipelineStep;

    const result = await handler.execute(buildContext(res, '/api/sites/s/x'), step);

    expect(result.success).toBe(false);
    expect(storage.downloadStream).not.toHaveBeenCalled();
  });
});

describe('FileServeHandler — content type', () => {
  const makeRes = () => {
    const res: any = {
      headersSent: false,
      writableEnded: false,
      setHeader: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      json: jest.fn(),
    };
    res.status = jest.fn(() => res);
    res.flushHeaders = jest.fn(() => {
      res.headersSent = true;
    });
    return res;
  };

  const makeStream = () => ({ pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() });

  const buildHandler = (storage: Partial<IStorageAdapter>) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const cacheConfigService = {
      getCacheConfig: jest.fn().mockResolvedValue({ source: 'default' }),
      buildCacheControlHeader: jest.fn(),
    } as unknown as CacheConfigService;
    return new FileServeHandler(
      registry,
      storage as IStorageAdapter,
      cacheConfigService,
      new ExpressionEvaluator(),
    );
  };

  const buildContext = (res: any, path: string): PipelineContext =>
    ({
      projectId: 'p1',
      deployment: { owner: 'o', repo: 'r', commitSha: 'sha' },
      metadata: { path, headers: {} },
      stepOutputs: {},
      request: { res },
    }) as unknown as PipelineContext;

  const serve = async (
    key: string,
    storageOverrides: Partial<{ streamMime: string; metaMime: string; stream: boolean }> = {},
  ) => {
    const { streamMime, metaMime, stream = true } = storageOverrides;
    const res = makeRes();
    const storage: any = {
      getMetadata: jest.fn().mockResolvedValue({ size: 42, etag: 'e', mimeType: metaMime }),
    };
    if (stream) {
      storage.downloadStream = jest
        .fn()
        .mockResolvedValue({ stream: makeStream(), size: 42, etag: 'e', mimeType: streamMime });
    } else {
      storage.download = jest.fn().mockResolvedValue(Buffer.from('x'));
    }
    const step = {
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { key },
    } as unknown as PipelineStep;

    await buildHandler(storage).execute(buildContext(res, '/api/uploads/content/x'), step);
    return res;
  };

  it('serves HTML with a charset so browsers do not fall back to windows-1252', async () => {
    const res = await serve('content/reports/index.html');

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
  });

  it('serves extensions missing from the old table by their real type, not octet-stream', async () => {
    const res = await serve('content/notes.md');

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown; charset=utf-8');
  });

  it('prefers the type storage recorded for the object over the extension guess', async () => {
    const res = await serve('content/download.bin', { streamMime: 'application/pdf' });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
  });

  it('falls back to the extension when storage reports octet-stream', async () => {
    const res = await serve('content/styles.css', { streamMime: 'application/octet-stream' });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/css; charset=utf-8');
  });

  it('applies the same resolution on the buffered path', async () => {
    const res = await serve('content/notes.md', { stream: false, metaMime: 'text/markdown' });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown; charset=utf-8');
  });
});

// `download` is opt-in per request: when it resolves truthy the object is
// served as an attachment (Content-Disposition), named after the upload
// record's original name (falling back to the key's basename). Everything
// else — range handling, caching, content type — is untouched.
describe('FileServeHandler — download (Content-Disposition: attachment)', () => {
  const mockDb = db as unknown as {
    __queue: (rows: unknown) => void;
    __reset: () => void;
    select: jest.Mock;
  };

  const makeRes = () => {
    const res: any = {
      headersSent: false,
      writableEnded: false,
      setHeader: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      json: jest.fn(),
    };
    res.status = jest.fn(() => res);
    res.flushHeaders = jest.fn(() => {
      res.headersSent = true;
    });
    return res;
  };

  const makeStream = () => ({ pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() });

  const buildHandler = (storage: Partial<IStorageAdapter>) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const cacheConfigService = {
      getCacheConfig: jest.fn().mockResolvedValue({ source: 'default' }),
      buildCacheControlHeader: jest.fn(),
    } as unknown as CacheConfigService;
    return new FileServeHandler(
      registry,
      storage as IStorageAdapter,
      cacheConfigService,
      new ExpressionEvaluator(),
    );
  };

  const streamingStorage = (size = 10000) => {
    const stream = makeStream();
    return {
      stream,
      storage: {
        downloadStream: jest.fn().mockResolvedValue({ stream, size, etag: 'abc' }),
        getMetadata: jest.fn().mockResolvedValue({ key: STORAGE_KEY, size, etag: 'abc' }),
      },
    };
  };

  const STORAGE_KEY = 'o/r/uploads/export/uuid-report.pdf';

  const buildContext = (
    res: any,
    overrides: {
      query?: Record<string, unknown>;
      headers?: Record<string, unknown>;
      steps?: Record<string, unknown>;
      path?: string;
    } = {},
  ): PipelineContext =>
    ({
      projectId: 'p1',
      deployment: { owner: 'o', repo: 'r', commitSha: 'sha' },
      metadata: {
        path: overrides.path ?? '/api/uploads/export/uuid-report.pdf',
        headers: overrides.headers ?? {},
        query: overrides.query ?? {},
      },
      stepOutputs: overrides.steps ?? {},
      request: { res },
    }) as unknown as PipelineContext;

  const stepWith = (config: Record<string, unknown>) =>
    ({
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { subDir: 'export', ...config },
    }) as unknown as PipelineStep;

  const dispositionOf = (res: any): string | undefined =>
    res.setHeader.mock.calls.find((c: unknown[]) => c[0] === 'Content-Disposition')?.[1];

  beforeEach(() => mockDb.__reset());

  it('sends no Content-Disposition and never queries the asset row when download is absent', async () => {
    const { storage } = streamingStorage();
    const res = makeRes();

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({}),
    );

    expect(dispositionOf(res)).toBeUndefined();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('serves as an attachment named after the upload record original_name when download resolves truthy', async () => {
    const { storage, stream } = streamingStorage();
    const res = makeRes();
    mockDb.__queue([{ originalPath: 'Q3 report.pdf' }]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(dispositionOf(res)).toBe('attachment; filename="Q3 report.pdf"');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(stream.pipe).toHaveBeenCalledWith(res);
    // Existing headers are unchanged.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
  });

  it('stays inline for the falsy query spellings a ?download= link can send', async () => {
    for (const value of ['0', 'false', '', 'no', 'off', undefined]) {
      const { storage } = streamingStorage();
      const res = makeRes();

      await buildHandler(storage).execute(
        buildContext(res, { query: value === undefined ? {} : { download: value } }),
        stepWith({ download: 'request.query.download' }),
      );

      expect(dispositionOf(res)).toBeUndefined();
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('falls back to the key basename when no upload record matches the served key', async () => {
    const { storage } = streamingStorage();
    const res = makeRes();
    mockDb.__queue([]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(dispositionOf(res)).toBe('attachment; filename="uuid-report.pdf"');
  });

  it('falls back to the key basename when the asset lookup itself fails', async () => {
    const { storage } = streamingStorage();
    const res = makeRes();
    mockDb.select.mockImplementationOnce(() => {
      throw new Error('db down');
    });

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(dispositionOf(res)).toBe('attachment; filename="uuid-report.pdf"');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('sanitises the filename: quotes, CR/LF and path separators cannot reach the header', async () => {
    const { storage } = streamingStorage();
    const res = makeRes();
    mockDb.__queue([{ originalPath: '../evil/"x".pdf\r\nSet-Cookie: a=b' }]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    const value = dispositionOf(res)!;
    expect(value).toBe('attachment; filename="x.pdfSet-Cookie: a=b"');
    expect(value).not.toMatch(/[\r\n\\/]/);
    // Exactly the one wrapping pair of quotes survives.
    expect(value.split('"')).toHaveLength(3);
  });

  it('emits the RFC 6266 dual form for a non-ASCII original name', async () => {
    const { storage } = streamingStorage();
    const res = makeRes();
    mockDb.__queue([{ originalPath: 'Zwischenbericht März.pdf' }]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(dispositionOf(res)).toBe(
      'attachment; filename="Zwischenbericht M_rz.pdf"; filename*=UTF-8\'\'Zwischenbericht%20M%C3%A4rz.pdf',
    );
  });

  it('keeps Range handling intact: a ranged download is still a 206 with the attachment header', async () => {
    const { storage, stream } = streamingStorage(10000);
    const res = makeRes();
    mockDb.__queue([{ originalPath: 'movie.mp4' }]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' }, headers: { range: 'bytes=0-1023' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(storage.downloadStream).toHaveBeenCalledWith(STORAGE_KEY, { start: 0, end: 1023 });
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/10000');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 1024);
    expect(dispositionOf(res)).toBe('attachment; filename="movie.mp4"');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('accepts a literal boolean and a {{template}} resolved from a prior step', async () => {
    {
      const { storage } = streamingStorage();
      const res = makeRes();
      mockDb.__queue([{ originalPath: 'a.bin' }]);
      await buildHandler(storage).execute(buildContext(res), stepWith({ download: true }));
      expect(dispositionOf(res)).toBe('attachment; filename="a.bin"');
    }
    {
      const { storage } = streamingStorage();
      const res = makeRes();
      mockDb.__queue([{ originalPath: 'b.bin' }]);
      await buildHandler(storage).execute(
        buildContext(res, { steps: { gate: { download: true } } }),
        stepWith({ download: '{{steps.gate.download}}' }),
      );
      expect(dispositionOf(res)).toBe('attachment; filename="b.bin"');
    }
    {
      const { storage } = streamingStorage();
      const res = makeRes();
      await buildHandler(storage).execute(
        buildContext(res, { steps: { gate: { download: false } } }),
        stepWith({ download: '{{steps.gate.download}}' }),
      );
      expect(dispositionOf(res)).toBeUndefined();
    }
  });

  it('works in explicit `key` mode: the lookup uses the resolved key, not the request path', async () => {
    const stream = makeStream();
    const storage = {
      downloadStream: jest.fn().mockResolvedValue({ stream, size: 5, etag: 'e' }),
      getMetadata: jest.fn(),
    };
    const res = makeRes();
    mockDb.__queue([{ originalPath: 'Site asset.css' }]);
    const keyStep = {
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: { key: '{{steps.resolve.serveKey}}', download: 'request.query.download' },
    } as unknown as PipelineStep;

    await buildHandler(storage).execute(
      buildContext(res, {
        path: '/api/sites/site-123/styles.css',
        query: { download: '1' },
        steps: { resolve: { serveKey: 'content/abc-styles.css' } },
      }),
      keyStep,
    );

    expect(storage.downloadStream).toHaveBeenCalledWith('o/r/uploads/content/abc-styles.css');
    expect(dispositionOf(res)).toBe('attachment; filename="Site asset.css"');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/css; charset=utf-8');
  });

  it('sets the header on the buffered (non-streaming) path too', async () => {
    const res = makeRes();
    const storage = {
      download: jest.fn().mockResolvedValue(Buffer.from('x')),
      getMetadata: jest.fn().mockResolvedValue({ size: 1, etag: 'e' }),
    };
    mockDb.__queue([{ originalPath: 'buffered.txt' }]);

    await buildHandler(storage).execute(
      buildContext(res, { query: { download: '1' } }),
      stepWith({ download: 'request.query.download' }),
    );

    expect(dispositionOf(res)).toBe('attachment; filename="buffered.txt"');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('isDownloadFlagTruthy', () => {
  it.each([
    [undefined, false],
    [null, false],
    [false, false],
    [true, true],
    [0, false],
    [1, true],
    ['', false],
    ['0', false],
    ['1', true],
    ['false', false],
    ['FALSE', false],
    ['true', true],
    ['no', false],
    ['off', false],
    ['yes', true],
    ['null', false],
    ['undefined', false],
    [['1'], true],
    [['0'], false],
    [[], false],
    [{}, true],
  ])('%p → %p', (input, expected) => {
    expect(isDownloadFlagTruthy(input)).toBe(expected);
  });
});
