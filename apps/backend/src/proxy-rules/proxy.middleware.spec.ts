import { ProxyMiddleware } from './proxy.middleware';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyService } from './proxy.service';
import { EmailFormHandlerService } from './email-form-handler.service';
import { ConfigService } from '@nestjs/config';
import { PipelineExecutionService } from '../pipelines/execution';
import { PipelineExecutionLogService } from '../pipelines/pipeline-execution-log.service';
import { VisibilityService } from '../domains/visibility.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';
import { UserGroupsService } from '../user-groups/user-groups.service';
import { Request, Response, NextFunction } from 'express';

jest.mock('../auth/app-token.util', () => ({
  ...jest.requireActual('../auth/app-token.util'),
  resolveAppToken: jest.fn().mockResolvedValue(null),
}));
const { resolveAppToken: mockResolveAppToken } = jest.requireMock('../auth/app-token.util');

// Mock the database client
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

describe('ProxyMiddleware', () => {
  let middleware: ProxyMiddleware;
  let mockProxyRulesService: jest.Mocked<ProxyRulesService>;
  let mockProxyService: jest.Mocked<ProxyService>;
  let mockEmailFormHandlerService: jest.Mocked<EmailFormHandlerService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockPipelineExecutionService: jest.Mocked<PipelineExecutionService>;
  let mockExecutionLogService: { log: jest.Mock };
  let mockVisibilityService: jest.Mocked<VisibilityService>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;
  let mockTrafficRoutingService: jest.Mocked<TrafficRoutingService>;
  let mockUserGroupsService: jest.Mocked<UserGroupsService>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockProxyRulesService = {
      getEffectiveRulesForRuleSet: jest.fn().mockResolvedValue([]),
      getEffectiveRulesForMultipleRuleSets: jest.fn().mockResolvedValue([]),
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

    mockPipelineExecutionService = {
      executePipelineWithDebug: jest.fn().mockResolvedValue({
        success: true,
        response: { status: 200, body: { success: true } },
      }),
    } as any;

    mockExecutionLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockVisibilityService = {
      resolveAccessControlForAlias: jest.fn().mockResolvedValue({
        isPublic: true,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'project',
      }),
    } as any;

    mockPermissionsService = {
      getUserProjectRole: jest.fn().mockResolvedValue(null),
      meetsRoleRequirement: jest.fn().mockReturnValue(true),
    } as any;

    mockTrafficRoutingService = {
      selectVariant: jest.fn().mockResolvedValue(null),
    } as any;

    mockUserGroupsService = {
      getGroupIdsForUser: jest.fn().mockResolvedValue([]),
    } as any;

    middleware = new ProxyMiddleware(
      mockProxyRulesService,
      mockProxyService,
      mockEmailFormHandlerService,
      mockConfigService,
      mockPipelineExecutionService,
      mockExecutionLogService as any,
      mockVisibilityService,
      mockPermissionsService,
      mockTrafficRoutingService,
      mockUserGroupsService,
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
    method: null,
    methods: null,
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
    pipelineConfig: null,
    isEnabled: true,
    description: null,
    debugEnabled: false,
    bypassVisibility: false,
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
      // The wildcard requires a path separator: '/prefix/*' must NOT match the
      // bare '/prefix', so a same-named SPA route (e.g. '/auth') falls through
      // to the SPA fallback instead of being proxied.
      expect((middleware as any).matchesPattern('/api/*', '/api')).toBe(false);
      expect((middleware as any).matchesPattern('/auth/*', '/auth')).toBe(false);
      expect((middleware as any).matchesPattern('/auth/*', '/auth/signin')).toBe(true);
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

    it('should match middle wildcard patterns', () => {
      expect(
        (middleware as any).matchesPattern(
          '/api/uploads/feedback-*',
          '/api/uploads/feedback-screenshots',
        ),
      ).toBe(true);
      expect(
        (middleware as any).matchesPattern(
          '/api/uploads/feedback-*',
          '/api/uploads/feedback-audio/foo.mp3',
        ),
      ).toBe(true);
      expect(
        (middleware as any).matchesPattern('/api/uploads/feedback-*', '/api/uploads/feedback-'),
      ).toBe(true);
      expect(
        (middleware as any).matchesPattern('/api/uploads/feedback-*', '/api/uploads/other'),
      ).toBe(false);
      expect((middleware as any).matchesPattern('/api/uploads/feedback-*', '/api/uploads')).toBe(
        false,
      );
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

  describe('checkVisibilityAndAuth', () => {
    const project = { id: 'proj-1', owner: 'owner', name: 'repo' } as any;

    const makePrivate = () => {
      mockVisibilityService.resolveAccessControlForAlias.mockResolvedValue({
        isPublic: false,
        unauthorizedBehavior: 'redirect_login',
        requiredRole: 'authenticated',
        source: 'alias',
      });
    };

    // An API request whose access token has expired, but whose refresh token is
    // still good - the state a long-running build lands in.
    const expiredTokenRequest = (path: string): Request => {
      const req = createMockRequest(path, { accept: 'application/json' });
      (req as any).tokenExpired = true;
      return req;
    };

    const authRule = createMockRule({
      pathPattern: '/api/auth/*',
      targetUrl: 'http://localhost:3000/api/auth',
      proxyType: 'external_proxy',
    });

    it('allows a matched auth-proxy rule through on a private deployment', async () => {
      makePrivate();
      const req = expiredTokenRequest('/api/auth/session/refresh');
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        authRule,
      );

      expect(result).toBe('allowed');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('still blocks a normal API rule on a private deployment when the token expired', async () => {
      makePrivate();
      const req = expiredTokenRequest('/api/works');
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({ pathPattern: '/api/*' }),
      );

      expect(result).toBe('blocked');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
    });

    it('lets a bypassVisibility rule through anonymously on a private deployment', async () => {
      makePrivate();
      const req = createMockRequest('/.well-known/oauth-protected-resource', {
        accept: 'application/json',
      });
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({
          pathPattern: '/.well-known/*',
          proxyType: 'pipeline',
          bypassVisibility: true,
        }),
      );

      expect(result).toBe('allowed');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('admits a Bearer app token on a private deployment as the member', async () => {
      makePrivate();
      mockResolveAppToken.mockResolvedValueOnce({
        user: { id: 'user-9', email: 'm@example.com', role: 'user' },
        token: {
          id: 'tok-1',
          projectId: project.id,
          scopes: ['workflow:read'],
          kind: 'personal',
          clientId: null,
        },
      });
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce('viewer');
      const req = createMockRequest('/api/works', { authorization: 'Bearer bfat_x' });
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({ pathPattern: '/api/*', proxyType: 'pipeline' }),
      );

      expect(result).toBe('allowed');
      expect(mockPermissionsService.getUserProjectRole).toHaveBeenCalledWith('user-9', project.id);
    });

    it('refuses a token bound to another project with 403 TOKEN_PROJECT_MISMATCH', async () => {
      makePrivate();
      mockResolveAppToken.mockResolvedValueOnce({
        user: { id: 'user-9', email: 'm@example.com', role: 'user' },
        token: {
          id: 'tok-1',
          projectId: 'other-project',
          scopes: ['workflow:read'],
          kind: 'personal',
          clientId: null,
        },
      });
      const req = createMockRequest('/api/works', { authorization: 'Bearer bfat_x' });
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({ pathPattern: '/api/*', proxyType: 'pipeline' }),
      );

      expect(result).toBe('blocked');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_PROJECT_MISMATCH' }),
      );
      expect(mockPermissionsService.getUserProjectRole).not.toHaveBeenCalled();
    });

    it('answers an anonymous bearer caller with 401 JSON, never a redirect', async () => {
      makePrivate();
      const req = createMockRequest('/api/works', { authorization: 'Bearer bfat_unknown' });
      const res = createMockResponse();
      (res as any).redirect = jest.fn();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({ pathPattern: '/api/*', proxyType: 'pipeline' }),
      );

      expect(result).toBe('blocked');
      expect(res.status).toHaveBeenCalledWith(401);
      expect((res as any).redirect).not.toHaveBeenCalled();
    });

    it('does not exempt a non-proxy rule served from an auth path', async () => {
      makePrivate();
      const req = expiredTokenRequest('/api/auth/session/refresh');
      const res = createMockResponse();

      const result = await (middleware as any).checkVisibilityAndAuth(
        req,
        res,
        project,
        'studio',
        createMockRule({ pathPattern: '/api/auth/*', proxyType: 'pipeline' }),
      );

      expect(result).toBe('blocked');
    });
  });

  describe('handlePipelineExecution — X-Pipeline-Log-Id (#716)', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const pipelineRule = (overrides: Record<string, unknown> = {}) =>
      createMockRule({
        proxyType: 'pipeline',
        targetUrl: 'pipeline',
        pipelineConfig: {
          name: 'test',
          steps: [{ name: 'respond', handlerType: 'response_handler', config: {} }],
        },
        debugEnabled: true,
        ...overrides,
      });

    const createPipelineResponse = (): Response & { headersSent: boolean } =>
      ({
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
        setHeader: jest.fn(),
        end: jest.fn(),
      }) as unknown as Response & { headersSent: boolean };

    /** Let the fire-and-forget persistLog() chain run to completion. */
    const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

    const logIdHeaderValue = (res: Response): string | undefined => {
      const call = (res.setHeader as jest.Mock).mock.calls.find(
        ([name]) => name === 'X-Pipeline-Log-Id',
      );
      return call?.[1];
    };

    beforeEach(() => {
      // Avoid SuperTokens / DB lookups: treat every request as anonymous.
      jest.spyOn(middleware as any, 'getOptionalUser').mockResolvedValue(undefined);
    });

    it('returns the execution-log id as X-Pipeline-Log-Id on a successful response and persists the log under that id', async () => {
      mockPipelineExecutionService.executePipelineWithDebug.mockResolvedValue({
        success: true,
        response: { status: 200, headers: { 'X-Custom': 'yes' }, body: { ok: true } },
      } as any);
      const req = createMockRequest('/public/owner/repo/sha123/api/items');
      const res = createPipelineResponse();

      await (middleware as any).handlePipelineExecution(req, res, pipelineRule(), 'project-1');
      await flushAsync();

      const logId = logIdHeaderValue(res);
      expect(logId).toMatch(UUID_RE);
      // Pipeline-authored headers are still applied.
      expect(res.setHeader).toHaveBeenCalledWith('X-Custom', 'yes');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({ ok: true });

      expect(mockExecutionLogService.log).toHaveBeenCalledTimes(1);
      const logArgs = mockExecutionLogService.log.mock.calls[0];
      expect(logArgs[0]).toBe('rule-1');
      expect(logArgs[1]).toBe('project-1');
      expect(logArgs[6]).toBe(logId);
    });

    it('returns the same header on a failed pipeline response so the caller can find the failing run', async () => {
      mockPipelineExecutionService.executePipelineWithDebug.mockResolvedValue({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad input', step: 'validate' },
      } as any);
      const req = createMockRequest('/public/owner/repo/sha123/api/items');
      const res = createPipelineResponse();

      await (middleware as any).handlePipelineExecution(req, res, pipelineRule(), 'project-1');
      await flushAsync();

      const logId = logIdHeaderValue(res);
      expect(logId).toMatch(UUID_RE);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad input', step: 'validate' },
      });
      expect(mockExecutionLogService.log).toHaveBeenCalledTimes(1);
      expect(mockExecutionLogService.log.mock.calls[0][6]).toBe(logId);
    });

    it('issues a fresh id per request', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const res = createPipelineResponse();
        await (middleware as any).handlePipelineExecution(
          createMockRequest('/public/owner/repo/sha123/api/items'),
          res,
          pipelineRule(),
          'project-1',
        );
        ids.add(logIdHeaderValue(res) as string);
      }
      await flushAsync();
      expect(ids.size).toBe(3);
    });

    it('does not emit the header (and writes no log) when debugEnabled is false', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/items');
      const res = createPipelineResponse();

      await (middleware as any).handlePipelineExecution(
        req,
        res,
        pipelineRule({ debugEnabled: false }),
        'project-1',
      );
      await flushAsync();

      expect(logIdHeaderValue(res)).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockExecutionLogService.log).not.toHaveBeenCalled();
    });

    it('does not emit the header when a handler already streamed the response (nothing is logged for it)', async () => {
      const req = createMockRequest('/public/owner/repo/sha123/api/stream');
      const res = createPipelineResponse();
      mockPipelineExecutionService.executePipelineWithDebug.mockImplementation(async () => {
        res.headersSent = true;
        return { success: true } as any;
      });

      await (middleware as any).handlePipelineExecution(req, res, pipelineRule(), 'project-1');
      await flushAsync();

      expect(logIdHeaderValue(res)).toBeUndefined();
      expect(res.send).not.toHaveBeenCalled();
      expect(mockExecutionLogService.log).not.toHaveBeenCalled();
    });

    describe('execution failures (500-class) are always logged, even with debug off (#724)', () => {
      it('persists exactly one row with the error fields when a pipeline hits an execution failure with debugEnabled false', async () => {
        mockPipelineExecutionService.executePipelineWithDebug.mockResolvedValue({
          success: false,
          error: { code: 'STEP_EXECUTION_ERROR', message: 'boom', step: 'register' },
        } as any);
        const req = createMockRequest('/public/owner/repo/sha123/api/items');
        const res = createPipelineResponse();

        await (middleware as any).handlePipelineExecution(
          req,
          res,
          pipelineRule({ debugEnabled: false }),
          'project-1',
        );
        await flushAsync();

        // The failed answer still carries the row id.
        const logId = logIdHeaderValue(res);
        expect(logId).toMatch(UUID_RE);
        expect(res.status).toHaveBeenCalledWith(500);

        expect(mockExecutionLogService.log).toHaveBeenCalledTimes(1);
        const [ruleId, projectId, result, , method, path, persistedId] =
          mockExecutionLogService.log.mock.calls[0];
        expect(ruleId).toBe('rule-1');
        expect(projectId).toBe('project-1');
        expect(result.success).toBe(false);
        expect(result.error).toEqual({
          code: 'STEP_EXECUTION_ERROR',
          message: 'boom',
          step: 'register',
        });
        expect(method).toBe('GET');
        expect(path).toBe('/public/owner/repo/sha123/api/items');
        expect(persistedId).toBe(logId);
      });

      it('writes no row for a client-fault validator failure with debugEnabled false (4xx stays debug-gated)', async () => {
        mockPipelineExecutionService.executePipelineWithDebug.mockResolvedValue({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'too many requests' },
        } as any);
        const req = createMockRequest('/public/owner/repo/sha123/api/items');
        const res = createPipelineResponse();

        await (middleware as any).handlePipelineExecution(
          req,
          res,
          pipelineRule({ debugEnabled: false }),
          'project-1',
        );
        await flushAsync();

        // Rate limiting keeps shedding traffic cheaply: no header, no DB write.
        expect(logIdHeaderValue(res)).toBeUndefined();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(mockExecutionLogService.log).not.toHaveBeenCalled();
      });

      it('writes no row for a successful run with debugEnabled false (volume unchanged for healthy rules)', async () => {
        const req = createMockRequest('/public/owner/repo/sha123/api/items');
        const res = createPipelineResponse();

        await (middleware as any).handlePipelineExecution(
          req,
          res,
          pipelineRule({ debugEnabled: false }),
          'project-1',
        );
        await flushAsync();

        expect(logIdHeaderValue(res)).toBeUndefined();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockExecutionLogService.log).not.toHaveBeenCalled();
      });

      it('logs a thrown execution error under PIPELINE_EXECUTION_ERROR with debug off', async () => {
        mockPipelineExecutionService.executePipelineWithDebug.mockRejectedValue(
          new Error('connection reset'),
        );
        const req = createMockRequest('/public/owner/repo/sha123/api/items');
        const res = createPipelineResponse();

        await (middleware as any).handlePipelineExecution(
          req,
          res,
          pipelineRule({ debugEnabled: false }),
          'project-1',
        );
        await flushAsync();

        const logId = logIdHeaderValue(res);
        expect(logId).toMatch(UUID_RE);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Pipeline execution failed',
          code: 'PIPELINE_EXECUTION_ERROR',
          message: 'connection reset',
        });

        expect(mockExecutionLogService.log).toHaveBeenCalledTimes(1);
        const [ruleId, projectId, result, , , , persistedId] =
          mockExecutionLogService.log.mock.calls[0];
        expect(ruleId).toBe('rule-1');
        expect(projectId).toBe('project-1');
        expect(result).toEqual({
          success: false,
          error: { code: 'PIPELINE_EXECUTION_ERROR', message: 'connection reset' },
        });
        expect(persistedId).toBe(logId);
      });

      it('still logs a thrown error when the response already streamed (no header, one row)', async () => {
        const req = createMockRequest('/public/owner/repo/sha123/api/stream');
        const res = createPipelineResponse();
        mockPipelineExecutionService.executePipelineWithDebug.mockImplementation(async () => {
          res.headersSent = true;
          throw new Error('stream died');
        });

        await (middleware as any).handlePipelineExecution(
          req,
          res,
          pipelineRule({ debugEnabled: false }),
          'project-1',
        );
        await flushAsync();

        expect(logIdHeaderValue(res)).toBeUndefined();
        expect(res.json).not.toHaveBeenCalled();
        expect(mockExecutionLogService.log).toHaveBeenCalledTimes(1);
        const [, , result] = mockExecutionLogService.log.mock.calls[0];
        expect(result.error).toEqual({
          code: 'PIPELINE_EXECUTION_ERROR',
          message: 'stream died',
        });
      });
    });
  });
});
