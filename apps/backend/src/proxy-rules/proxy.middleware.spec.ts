import { ProxyMiddleware } from './proxy.middleware';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyService } from './proxy.service';
import { EmailFormHandlerService } from './email-form-handler.service';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

// Mock the database client
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

describe('ProxyMiddleware', () => {
  let middleware: ProxyMiddleware;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;
  let mockProxyService: jest.Mocked<ProxyService>;
  let mockEmailFormHandlerService: jest.Mocked<EmailFormHandlerService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockProxyRulesService = {
      getEffectiveRulesForRuleSet: jest.fn().mockResolvedValue([]),
    } as any;

    mockProxyService = {
      forward: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockEmailFormHandlerService = {
      handleSubmission: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockConfigService = {
      get: jest.fn().mockReturnValue('localhost'),
    } as any;

    middleware = new ProxyMiddleware(
      mockProxyRulesService,
      mockProxyService,
      mockEmailFormHandlerService,
      mockConfigService,
    );
    mockNext = jest.fn();
  });

  const createMockRequest = (path: string, headers: Record<string, string> = {}): Request =>
    ({
      path,
      method: 'GET',
      url: path,
      headers,
    }) as unknown as Request;

  const createMockResponse = (): Response =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    }) as unknown as Response;

  // Mock rule with new schema (ruleSetId instead of projectId/aliasId)
  const createMockRule = (overrides: Record<string, unknown> = {}) => ({
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
    internalRewrite: false,
    proxyType: 'external_proxy' as const,
    emailHandlerConfig: null,
    isEnabled: true,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('parsePublicPath', () => {
    it('should parse valid public path', () => {
      const result = (middleware as any).parsePublicPath('/public/owner/repo/sha123/api/users');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: 'sha123',
        subpath: '/api/users',
      });
    });

    it('should handle path without subpath', () => {
      const result = (middleware as any).parsePublicPath('/public/owner/repo/sha123');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: 'sha123',
        subpath: '/',
      });
    });

    it('should return null for invalid paths', () => {
      expect((middleware as any).parsePublicPath('/public/owner')).toBeNull();
      expect((middleware as any).parsePublicPath('/api/test')).toBeNull();
      expect((middleware as any).parsePublicPath('/')).toBeNull();
    });
  });

  describe('matchesPattern', () => {
    it('should match prefix wildcard patterns', () => {
      expect((middleware as any).matchesPattern('/api/*', '/api/users')).toBe(true);
      expect((middleware as any).matchesPattern('/api/*', '/api/users/123')).toBe(true);
      expect((middleware as any).matchesPattern('/api/*', '/api/')).toBe(true);
      expect((middleware as any).matchesPattern('/api/*', '/api')).toBe(true);
      expect((middleware as any).matchesPattern('/api/*', '/graphql')).toBe(false);
    });

    it('should match suffix wildcard patterns', () => {
      expect((middleware as any).matchesPattern('*.json', '/config.json')).toBe(true);
      expect((middleware as any).matchesPattern('*.json', '/data.json')).toBe(true);
      expect((middleware as any).matchesPattern('*.json', '/data.xml')).toBe(false);
    });

    it('should match exact patterns', () => {
      expect((middleware as any).matchesPattern('/graphql', '/graphql')).toBe(true);
      expect((middleware as any).matchesPattern('/graphql', '/graphql/')).toBe(false);
      expect((middleware as any).matchesPattern('/graphql', '/graphql/v1')).toBe(false);
    });
  });

  describe('use', () => {
    it('should call next for non-public paths', async () => {
      const req = createMockRequest('/api/test');
      const res = createMockResponse();

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockProxyService.forward).not.toHaveBeenCalled();
    });

    it('should call next for invalid public paths', async () => {
      const req = createMockRequest('/public/owner');
      const res = createMockResponse();

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next when project is not found', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/users');
      const res = createMockResponse();

      // Mock db.select to return empty array (no project found)
      const { db } = require('../db/client');
      db.limit.mockResolvedValueOnce([]);

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next when no rules match', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/static/file.css');
      const res = createMockResponse();

      // Mock db to return a project with defaultProxyRuleSetId
      const { db } = require('../db/client');
      db.limit.mockResolvedValueOnce([
        { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'rule-set-1' },
      ]);

      // Mock rules that don't match the path
      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([
        createMockRule({ pathPattern: '/api/*' }),
      ]);

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockProxyService.forward).not.toHaveBeenCalled();
    });

    it('should forward request when rule matches', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/users');
      const res = createMockResponse();

      // Mock db to return a project with defaultProxyRuleSetId
      const { db } = require('../db/client');
      db.limit.mockResolvedValueOnce([
        { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'rule-set-1' },
      ]);

      const mockRule = createMockRule();

      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([mockRule]);

      await middleware.use(req, res, mockNext);

      expect(mockProxyService.forward).toHaveBeenCalledWith(req, res, mockRule, '/api/users');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should skip disabled rules', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/users');
      const res = createMockResponse();

      // Mock db to return a project
      const { db } = require('../db/client');
      db.limit.mockResolvedValueOnce([
        { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'rule-set-1' },
      ]);

      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([
        createMockRule({ isEnabled: false }),
      ]);

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockProxyService.forward).not.toHaveBeenCalled();
    });

    it('should call next on error', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/users');
      const res = createMockResponse();

      // Mock db to throw an error
      const { db } = require('../db/client');
      db.limit.mockRejectedValueOnce(new Error('Database error'));

      await middleware.use(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should use alias proxyRuleSetId when available', async () => {
      const req = createMockRequest('/public/owner/repo/production/api/users');
      const res = createMockResponse();

      // Mock db: project has default rule set, alias has its own rule set
      const { db } = require('../db/client');
      db.limit
        .mockResolvedValueOnce([
          { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'default-set' },
        ])
        .mockResolvedValueOnce([
          { id: 'alias-1', projectId: 'proj-1', alias: 'production', proxyRuleSetId: 'alias-set' },
        ]);

      const mockRule = createMockRule({ ruleSetId: 'alias-set' });
      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([mockRule]);

      await middleware.use(req, res, mockNext);

      // Should use alias-set, not default-set
      expect(mockProxyRulesService.getEffectiveRulesForRuleSet).toHaveBeenCalledWith('alias-set');
      expect(mockProxyService.forward).toHaveBeenCalledWith(req, res, mockRule, '/api/users');
    });

    it('should fall back to project defaultProxyRuleSetId when alias has no rule set', async () => {
      const req = createMockRequest('/public/owner/repo/production/api/users');
      const res = createMockResponse();

      // Mock db: project has default rule set, alias has no rule set
      const { db } = require('../db/client');
      db.limit
        .mockResolvedValueOnce([
          { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'default-set' },
        ])
        .mockResolvedValueOnce([
          {
            id: 'alias-1',
            projectId: 'proj-1',
            alias: 'production',
            proxyRuleSetId: null,
          },
        ]);

      const mockRule = createMockRule({ ruleSetId: 'default-set' });
      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([mockRule]);

      await middleware.use(req, res, mockNext);

      // Should use default-set
      expect(mockProxyRulesService.getEffectiveRulesForRuleSet).toHaveBeenCalledWith('default-set');
    });

    it('should use X-Original-URI header for domain-mapped requests', async () => {
      const req = createMockRequest(
        '/public/owner/repo/production/apps/frontend/coverage/api/posts',
        { 'x-original-uri': '/api/posts' },
      );
      const res = createMockResponse();

      const { db } = require('../db/client');
      db.limit
        .mockResolvedValueOnce([
          { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'rule-set-1' },
        ])
        .mockResolvedValueOnce([
          {
            id: 'alias-1',
            projectId: 'proj-1',
            alias: 'production',
            proxyRuleSetId: 'rule-set-1',
          },
        ]);

      const mockRule = createMockRule();
      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([mockRule]);

      await middleware.use(req, res, mockNext);

      // Should use /api/posts from X-Original-URI, not the rewritten path
      expect(mockProxyService.forward).toHaveBeenCalledWith(req, res, mockRule, '/api/posts');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should strip query string from X-Original-URI', async () => {
      const req = createMockRequest(
        '/public/owner/repo/production/apps/frontend/coverage/api/posts',
        { 'x-original-uri': '/api/posts?page=1&limit=10' },
      );
      const res = createMockResponse();

      const { db } = require('../db/client');
      db.limit
        .mockResolvedValueOnce([
          { id: 'proj-1', owner: 'owner', name: 'repo', defaultProxyRuleSetId: 'rule-set-1' },
        ])
        .mockResolvedValueOnce([
          {
            id: 'alias-1',
            projectId: 'proj-1',
            alias: 'production',
            proxyRuleSetId: 'rule-set-1',
          },
        ]);

      const mockRule = createMockRule();
      mockProxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValueOnce([mockRule]);

      await middleware.use(req, res, mockNext);

      // Should match on /api/posts (without query string)
      expect(mockProxyService.forward).toHaveBeenCalledWith(req, res, mockRule, '/api/posts');
    });
  });

  describe('extractPathFromUri', () => {
    it('should return path as-is when no query string', () => {
      expect((middleware as any).extractPathFromUri('/api/posts')).toBe('/api/posts');
    });

    it('should strip query string from URI', () => {
      expect((middleware as any).extractPathFromUri('/api/posts?page=1')).toBe('/api/posts');
      expect((middleware as any).extractPathFromUri('/api/posts?page=1&limit=10')).toBe(
        '/api/posts',
      );
    });

    it('should handle empty path with query string', () => {
      expect((middleware as any).extractPathFromUri('/?foo=bar')).toBe('/');
    });
  });
});
