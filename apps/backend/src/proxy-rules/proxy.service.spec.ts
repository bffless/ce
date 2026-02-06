import { ProxyService } from './proxy.service';
import { Request, Response } from 'express';
import { ProxyRule } from '../db/schema/proxy-rules.schema';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('ProxyService', () => {
  let service: ProxyService;

  beforeEach(() => {
    service = new ProxyService();
    mockFetch.mockReset();
  });

  const createMockRule = (overrides: Partial<ProxyRule> = {}): ProxyRule => ({
    id: 'rule-1',
    ruleSetId: 'rule-set-1',
    pathPattern: '/api/*',
    targetUrl: 'https://api.example.com',
    stripPrefix: true,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    isEnabled: true,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      method: 'GET',
      url: '/api/users?page=1',
      headers: {
        host: 'localhost:3000',
        accept: 'application/json',
        'user-agent': 'test',
      },
      ip: '127.0.0.1',
      protocol: 'http',
      hostname: 'localhost',
      socket: { remoteAddress: '127.0.0.1' },
      body: undefined,
      ...overrides,
    }) as unknown as Request;

  const createMockResponse = (): Response => {
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      json: jest.fn(),
      headersSent: false,
      writableEnded: false,
    };
    return res as unknown as Response;
  };

  describe('stripMatchedPrefix', () => {
    it('should strip prefix for wildcard patterns', () => {
      const rule = createMockRule({ pathPattern: '/api/*' });
      // Access private method via any
      const result = (service as any).stripMatchedPrefix('/api/*', '/api/users');
      expect(result).toBe('/users');
    });

    it('should return / when path exactly matches prefix', () => {
      const result = (service as any).stripMatchedPrefix('/api/*', '/api');
      expect(result).toBe('/');
    });

    it('should not strip for non-wildcard patterns', () => {
      const result = (service as any).stripMatchedPrefix('/graphql', '/graphql');
      expect(result).toBe('/graphql');
    });
  });

  describe('buildHeaders', () => {
    it('should forward safe headers by default', () => {
      const req = createMockRequest({
        headers: {
          host: 'localhost:3000',
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'test-agent',
          cookie: 'session=abc123', // Should be stripped by default
        },
      });
      const rule = createMockRule();

      const headers = (service as any).buildHeaders(req, rule);

      expect(headers['accept']).toBe('application/json');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['user-agent']).toBe('test-agent');
      expect(headers['cookie']).toBeUndefined(); // Stripped by default
    });

    it('should add custom headers from config', () => {
      const req = createMockRequest();
      const rule = createMockRule({
        headerConfig: {
          add: {
            'X-API-Key': 'secret-key',
            Authorization: 'Bearer token',
          },
        },
      });

      const headers = (service as any).buildHeaders(req, rule);

      expect(headers['X-API-Key']).toBe('secret-key');
      expect(headers['Authorization']).toBe('Bearer token');
    });

    it('should set host from target URL when preserveHost is false', () => {
      const req = createMockRequest();
      const rule = createMockRule({
        targetUrl: 'https://api.example.com',
        preserveHost: false,
      });

      const headers = (service as any).buildHeaders(req, rule);

      expect(headers['host']).toBe('api.example.com');
    });

    it('should add x-forwarded headers', () => {
      const req = createMockRequest({
        ip: '192.168.1.1',
        protocol: 'https',
        hostname: 'myapp.example.com',
      });
      const rule = createMockRule();

      const headers = (service as any).buildHeaders(req, rule);

      expect(headers['x-forwarded-for']).toBe('192.168.1.1');
      expect(headers['x-forwarded-proto']).toBe('https');
      expect(headers['x-forwarded-host']).toBe('myapp.example.com');
    });
  });

  describe('getRequestBody', () => {
    it('should return null for GET requests', () => {
      const req = createMockRequest({ method: 'GET', body: { data: 'test' } });

      const body = (service as any).getRequestBody(req);

      expect(body).toBeNull();
    });

    it('should return null for HEAD requests', () => {
      const req = createMockRequest({ method: 'HEAD', body: { data: 'test' } });

      const body = (service as any).getRequestBody(req);

      expect(body).toBeNull();
    });

    it('should serialize object body as JSON for POST requests', () => {
      const req = createMockRequest({ method: 'POST', body: { data: 'test' } });

      const body = (service as any).getRequestBody(req);

      expect(body).toBe('{"data":"test"}');
    });

    it('should return string body as-is', () => {
      const req = createMockRequest({ method: 'POST', body: 'plain text body' });

      const body = (service as any).getRequestBody(req);

      expect(body).toBe('plain text body');
    });

    it('should convert Buffer to Uint8Array', () => {
      const buffer = Buffer.from('buffer data');
      const req = createMockRequest({ method: 'POST', body: buffer });

      const body = (service as any).getRequestBody(req);

      expect(body).toBeInstanceOf(Uint8Array);
    });
  });

  describe('forward', () => {
    it('should forward GET request and stream response', async () => {
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([72, 105]) }) // 'Hi'
          .mockResolvedValueOnce({ done: true }),
      };

      const mockResponseBody = {
        getReader: () => mockReader,
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Map([['content-type', 'text/plain']]),
        body: mockResponseBody,
      });

      const req = createMockRequest();
      const res = createMockResponse();
      const rule = createMockRule();

      await service.forward(req, res, rule, '/api/users');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?page=1',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.write).toHaveBeenCalled();
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle timeout errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const req = createMockRequest();
      const res = createMockResponse();
      const rule = createMockRule({ timeout: 100 });

      await service.forward(req, res, rule, '/api/users');

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({ error: 'Gateway Timeout' });
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const req = createMockRequest();
      const res = createMockResponse();
      const rule = createMockRule();

      await service.forward(req, res, rule, '/api/users');

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ error: 'Bad Gateway' });
    });

    it('should not strip prefix when stripPrefix is false', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Map(),
        body: null,
      });

      const req = createMockRequest({ url: '/api/users' });
      const res = createMockResponse();
      const rule = createMockRule({ stripPrefix: false });

      await service.forward(req, res, rule, '/api/users');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/users',
        expect.any(Object),
      );
    });
  });
});
