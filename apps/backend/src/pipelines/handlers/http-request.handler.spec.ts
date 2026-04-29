import { Request } from 'express';
import { HttpRequestHandler } from './http-request.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeFetchResponse(opts: {
  status: number;
  statusText?: string;
  body: unknown;
  isJson?: boolean;
}): Response {
  const { status, statusText = '', body, isJson = true } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? isJson
            ? 'application/json'
            : 'text/html'
          : null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: {
      headers: {},
    } as unknown as Request,
    user: undefined,
    stepOutputs: {},
    projectId: 'p-1',
    pipelineId: 'pl-1',
    metadata: {
      path: '/',
      method: 'GET',
      headers: {},
      query: {},
      body: {},
    },
    ...overrides,
  };
}

function makeStep(config: Record<string, unknown>): PipelineStep {
  return {
    id: 'step-1',
    pipelineId: 'pl-1',
    name: 'check_url',
    handlerType: 'http_request',
    config: config as PipelineStep['config'],
    order: 0,
    isEnabled: true,
  };
}

describe('HttpRequestHandler', () => {
  let handler: HttpRequestHandler;

  beforeEach(() => {
    mockFetch.mockReset();
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const evaluator = new ExpressionEvaluator();
    handler = new HttpRequestHandler(registry, evaluator);
  });

  describe('validateConfig', () => {
    it('requires url', () => {
      expect(() =>
        handler.validateConfig({} as Parameters<typeof handler.validateConfig>[0]),
      ).toThrow(ConfigurationError);
    });

    it('rejects non-HTTP method values', () => {
      expect(() =>
        handler.validateConfig({
          url: 'https://example.com',
          method: 'OPTIONS' as unknown as 'GET',
        }),
      ).toThrow(/Invalid method/);
    });

    it('rejects out-of-range timeout', () => {
      expect(() => handler.validateConfig({ url: 'https://example.com', timeout: 500 })).toThrow(
        /timeout/,
      );
      expect(() =>
        handler.validateConfig({ url: 'https://example.com', timeout: 999_999 }),
      ).toThrow(/timeout/);
    });

    it('accepts a valid config', () => {
      expect(() =>
        handler.validateConfig({ url: 'https://example.com', method: 'GET', timeout: 5000 }),
      ).not.toThrow();
    });
  });

  describe('execute — backward-compat default (failOnError: true)', () => {
    it('returns flat body output on 2xx', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 200, body: { hello: 'world' } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/ok' }),
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ hello: 'world' });
      expect(result.error).toBeUndefined();
    });

    it('returns success: false with HTTP_REQUEST_ERROR on 404', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 404, statusText: 'Not Found', body: 'Preview not found' }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/missing' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_REQUEST_ERROR');
      expect(result.error?.message).toContain('404');
      expect((result.error?.details as { status: number }).status).toBe(404);
    });

    it('returns success: false on 500', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 500, statusText: 'Server Error', body: { err: 'oops' } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/blow-up' }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_REQUEST_ERROR');
    });
  });

  describe('execute — failOnError: false (probe mode)', () => {
    it('returns ok=true on 2xx with structured output', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 200, statusText: 'OK', body: { hello: 'world' } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/ok', failOnError: false }),
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { hello: 'world' },
      });
    });

    it('returns ok=false on 404 instead of failing the step', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          status: 404,
          statusText: 'Not Found',
          body: 'Preview not found',
          isJson: false,
        }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/not-yet', failOnError: false }),
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: 'Preview not found',
      });
    });

    it('returns ok=false on 500 instead of failing the step', async () => {
      mockFetch.mockResolvedValue(
        makeFetchResponse({ status: 500, statusText: 'Server Error', body: { err: 'oops' } }),
      );

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/blow-up', failOnError: false }),
      );

      expect(result.success).toBe(true);
      expect(
        (result.output as { status: number; ok: boolean }).status,
      ).toBe(500);
      expect((result.output as { ok: boolean }).ok).toBe(false);
    });

    it('still fails the step on a network error (not an HTTP response)', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/dead', failOnError: false }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_REQUEST_FAILED');
    });

    it('still fails the step on a timeout', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'https://example.com/slow', timeout: 1000, failOnError: false }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_REQUEST_TIMEOUT');
    });
  });

  describe('execute — invalid url', () => {
    it('returns INVALID_URL when not http(s)', async () => {
      const result = await handler.execute(
        makeContext(),
        makeStep({ url: 'file:///etc/passwd' }),
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_REQUEST_INVALID_URL');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
