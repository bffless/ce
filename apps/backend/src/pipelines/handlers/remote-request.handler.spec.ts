/**
 * remote_request — the pipeline door onto a named Remote connection.
 *
 * Style per http-request.handler.spec.ts: direct construction, a REAL
 * ExpressionEvaluator, literal collaborators. The connections port is faked at
 * its three methods (resolve/client/acquire) — this spec is about the handler's
 * flow (fuse acquire/release, timeout, error mapping), not the transport.
 */
import { Request } from 'express';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { RemoteTransportError } from '../../remote-connections/remote-client';
import {
  RemoteBusyError,
  RemoteResponseTooLargeError,
} from '../../remote-connections/remote-errors';
import type { ResolvedConnection } from '../../remote-connections/remote-connections.types';
import { RemoteRequestHandler } from './remote-request.handler';

const connection = (over: Partial<ResolvedConnection> = {}): ResolvedConnection =>
  ({
    id: 'c1',
    name: 'svc',
    url: 'https://svc.example.run.app',
    auth: 'google_id_token',
    credential: null,
    maxInflight: 1,
    healthPath: '/health',
    source: {
      url: 'db',
      auth: 'db',
      credential: null,
      maxInflight: 'db',
      healthPath: 'db',
      envOnly: false,
    },
    ...over,
  }) as ResolvedConnection;

function createHandler(
  overrides: {
    resolve?: jest.Mock;
    request?: jest.Mock;
    acquire?: jest.Mock;
  } = {},
) {
  const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
  const conn = connection();
  const request =
    overrides.request ??
    jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { id: 1 },
      attempts: 1,
    });
  const release = jest.fn();
  const connections = {
    resolve: overrides.resolve ?? jest.fn().mockReturnValue(conn),
    client: jest.fn().mockReturnValue({ request }),
    acquire: overrides.acquire ?? jest.fn().mockReturnValue(release),
  };
  const handler = new RemoteRequestHandler(registry, new ExpressionEvaluator(), connections);
  return { handler, registry, connections, request, release, conn };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { headers: {} } as unknown as Request,
    user: undefined,
    stepOutputs: {},
    projectId: 'p-1',
    pipelineId: 'pl-1',
    metadata: {
      path: '/',
      method: 'POST',
      headers: {},
      query: {},
      body: {},
    },
    ...overrides,
  };
}

const makeStep = (config: Record<string, unknown>): PipelineStep => ({
  id: 'step-1',
  pipelineId: 'pl-1',
  name: 'call',
  handlerType: 'remote_request',
  config: config as PipelineStep['config'],
  order: 0,
  isEnabled: true,
});

describe('RemoteRequestHandler registration & validateConfig', () => {
  it('self-registers with type remote_request', () => {
    const { handler, registry } = createHandler();
    expect(handler.type).toBe('remote_request');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('requires a connection name', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({} as never)).toThrow(ConfigurationError);
    expect(() => handler.validateConfig({ connection: '' } as never)).toThrow(/connection/);
    expect(() => handler.validateConfig({ connection: 42 } as never)).toThrow(/connection/);
  });

  it('rejects an unknown method', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({ connection: 'svc', method: 'HEAD' } as never)).toThrow(
      /method/,
    );
  });

  it('rejects a static path that cannot be a path', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({ connection: 'svc', path: 'jobs' } as never)).toThrow(
      /path/,
    );
    // Templates and expression paths are resolved at run time, so they pass here.
    expect(() =>
      handler.validateConfig({ connection: 'svc', path: '/jobs/{{request.query.id}}' } as never),
    ).not.toThrow();
    expect(() =>
      handler.validateConfig({ connection: 'svc', path: 'steps.prev.path' } as never),
    ).not.toThrow();
  });

  it('rejects a timeoutSeconds of 0 or over the instance max', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({ connection: 'svc', timeoutSeconds: 0 } as never)).toThrow(
      /timeoutSeconds/,
    );
    expect(() =>
      handler.validateConfig({ connection: 'svc', timeoutSeconds: 99_999 } as never),
    ).toThrow(/timeoutSeconds/);
    expect(() =>
      handler.validateConfig({ connection: 'svc', timeoutSeconds: 600 } as never),
    ).not.toThrow();
  });

  it('rejects an Authorization header in any casing (the connection supplies it)', () => {
    const { handler } = createHandler();
    for (const key of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      expect(() =>
        handler.validateConfig({ connection: 'svc', headers: { [key]: 'Bearer x' } } as never),
      ).toThrow(/[Aa]uthorization/);
    }
  });
});

describe('RemoteRequestHandler execute', () => {
  it('resolves the connection and POSTs the evaluated body', async () => {
    const { handler, connections, request } = createHandler();
    const context = makeContext({
      metadata: { ...makeContext().metadata, body: { job: 'encode' } },
    });

    const result = await handler.execute(
      context,
      makeStep({ connection: 'svc', path: '/jobs', body: 'request.body' }),
    );

    expect(connections.resolve).toHaveBeenCalledWith('svc');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/jobs',
        method: 'POST',
        body: JSON.stringify({ job: 'encode' }),
        signal: expect.any(AbortSignal),
        maxResponseBytes: 16 * 1024 * 1024,
      }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      ok: true,
      status: 200,
      body: { id: 1 },
      latencyMs: expect.any(Number),
      connection: 'svc',
      attempts: 1,
    });
  });

  it('interpolates a templated path', async () => {
    const { handler, request } = createHandler();
    const context = makeContext({
      metadata: { ...makeContext().metadata, query: { id: '7' } },
    });

    await handler.execute(
      context,
      makeStep({ connection: 'svc', path: '/jobs/{{request.query.id}}' }),
    );

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/jobs/7' }));
  });

  it('fails with REMOTE_INVALID_PATH when the evaluated path is not a path', async () => {
    const { handler, request, release } = createHandler();
    const context = makeContext({ stepOutputs: { prev: { path: 'jobs' } } });

    const result = await handler.execute(
      context,
      makeStep({ connection: 'svc', path: 'steps.prev.path' }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('REMOTE_INVALID_PATH');
    expect(request).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('resolves a field-map body and sends no body on GET', async () => {
    const { handler, request } = createHandler();
    const context = makeContext({ stepOutputs: { prev: { id: 'j1' } } });

    await handler.execute(
      context,
      makeStep({ connection: 'svc', body: { jobId: 'steps.prev.id', kind: "'encode'" } }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ body: JSON.stringify({ jobId: 'j1', kind: 'encode' }) }),
    );

    request.mockClear();
    await handler.execute(
      context,
      makeStep({ connection: 'svc', method: 'GET', body: { jobId: 'steps.prev.id' } }),
    );
    expect(request.mock.calls[0][0].body).toBeUndefined();
    expect(request.mock.calls[0][0].method).toBe('GET');
  });

  it('evaluates headers and lower-cases their names', async () => {
    const { handler, request } = createHandler();
    const context = makeContext({ stepOutputs: { prev: { id: 'j1' } } });

    await handler.execute(
      context,
      makeStep({ connection: 'svc', headers: { 'X-Job': 'steps.prev.id' } }),
    );

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'x-job': 'j1' } }));
  });

  it('fails with REMOTE_CONNECTION_UNKNOWN for an unconfigured connection', async () => {
    const { handler, connections } = createHandler({ resolve: jest.fn().mockReturnValue(null) });

    const result = await handler.execute(makeContext(), makeStep({ connection: 'nope' }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('REMOTE_CONNECTION_UNKNOWN');
    expect(connections.acquire).not.toHaveBeenCalled();
  });

  it('fails with REMOTE_BUSY when the fuse is full', async () => {
    const { handler, request } = createHandler({
      acquire: jest.fn(() => {
        throw new RemoteBusyError('svc is at capacity (1 in flight)');
      }),
    });

    const result = await handler.execute(makeContext(), makeStep({ connection: 'svc' }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('REMOTE_BUSY');
    expect(request).not.toHaveBeenCalled();
  });

  it('releases the fuse after success AND after failure', async () => {
    const ok = createHandler();
    await ok.handler.execute(makeContext(), makeStep({ connection: 'svc' }));
    expect(ok.release).toHaveBeenCalledTimes(1);

    const bad = createHandler({
      request: jest.fn().mockRejectedValue(new RemoteTransportError('boom', undefined, true)),
    });
    await bad.handler.execute(makeContext(), makeStep({ connection: 'svc' }));
    expect(bad.release).toHaveBeenCalledTimes(1);
  });

  it('maps a RemoteTransportError to REMOTE_UNAVAILABLE, carrying its status', async () => {
    const withStatus = createHandler({
      request: jest.fn().mockRejectedValue(new RemoteTransportError('503 twice', 503, true)),
    });
    const a = await withStatus.handler.execute(makeContext(), makeStep({ connection: 'svc' }));
    expect(a.success).toBe(false);
    expect(a.error?.code).toBe('REMOTE_UNAVAILABLE');
    expect(a.error?.details).toEqual({ status: 503 });

    const noStatus = createHandler({
      request: jest.fn().mockRejectedValue(new RemoteTransportError('ECONNREFUSED')),
    });
    const b = await noStatus.handler.execute(makeContext(), makeStep({ connection: 'svc' }));
    expect(b.error?.code).toBe('REMOTE_UNAVAILABLE');
    expect(b.error?.details).toBeUndefined();
  });

  it('fails with REMOTE_TIMEOUT when the step deadline aborts the request', async () => {
    jest.useFakeTimers();
    try {
      const request = jest.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );
      const { handler } = createHandler({ request });

      const pending = handler.execute(
        makeContext(),
        makeStep({ connection: 'svc', timeoutSeconds: 1 }),
      );
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      const result = await pending;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REMOTE_TIMEOUT');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails a non-2xx by default and reports it as output when failOnError is false', async () => {
    const notFound = {
      status: 404,
      ok: false,
      headers: new Headers(),
      body: { error: 'no such job' },
      attempts: 1,
    };

    const strict = createHandler({ request: jest.fn().mockResolvedValue(notFound) });
    const a = await strict.handler.execute(makeContext(), makeStep({ connection: 'svc' }));
    expect(a.success).toBe(false);
    expect(a.error?.code).toBe('REMOTE_REQUEST_ERROR');
    expect(a.error?.details).toEqual({ status: 404, body: { error: 'no such job' } });

    const lenient = createHandler({ request: jest.fn().mockResolvedValue(notFound) });
    const b = await lenient.handler.execute(
      makeContext(),
      makeStep({ connection: 'svc', failOnError: false }),
    );
    expect(b.success).toBe(true);
    expect(b.output).toEqual(
      expect.objectContaining({ ok: false, status: 404, body: { error: 'no such job' } }),
    );
  });

  it('lets a bad expression surface as itself, still releasing the fuse', async () => {
    const { handler, release, request } = createHandler();

    await expect(
      handler.execute(makeContext(), makeStep({ connection: 'svc', path: 'request.bogus' })),
    ).rejects.toThrow(/bogus/);
    expect(request).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('maps an oversized response to REMOTE_RESPONSE_TOO_LARGE', async () => {
    const { handler } = createHandler({
      request: jest
        .fn()
        .mockRejectedValue(new RemoteResponseTooLargeError('response is 20000000 bytes')),
    });

    const result = await handler.execute(makeContext(), makeStep({ connection: 'svc' }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('REMOTE_RESPONSE_TOO_LARGE');
  });
});
