import { FileServeHandler } from './file-serve.handler';
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
