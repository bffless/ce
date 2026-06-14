import { FileServeHandler } from './file-serve.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { IStorageAdapter } from '../../storage/storage.interface';
import { CacheConfigService } from '../../cache-rules/cache-config.service';
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
    return res;
  };

  const makeStream = () => ({ pipe: jest.fn(), on: jest.fn(), destroy: jest.fn() });

  const buildHandler = (storage: Partial<IStorageAdapter>) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const cacheConfigService = {
      getCacheConfig: jest.fn().mockResolvedValue({ source: 'default' }),
      buildCacheControlHeader: jest.fn(),
    } as unknown as CacheConfigService;
    return new FileServeHandler(registry, storage as IStorageAdapter, cacheConfigService);
  };

  const step = {
    id: 'serve',
    name: 'serve',
    handlerType: 'file_serve_handler',
    config: { subDir: 'export' },
  } as unknown as PipelineStep;

  const buildContext = (res: any, headers: Record<string, unknown>): PipelineContext =>
    ({
      projectId: 'p1',
      deployment: { owner: 'o', repo: 'r', commitSha: 'sha' },
      metadata: { path: '/api/uploads/export/video.mp4', headers },
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
});
