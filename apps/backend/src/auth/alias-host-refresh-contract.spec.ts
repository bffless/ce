/**
 * AuthMiddleware → ProxyMiddleware contract for an expired session on a private
 * alias / subdomain host (issue #811).
 *
 * nginx rewrites `POST /api/auth/session/refresh` on such a host to
 * `/public/subdomain-alias/<alias>/api/auth/session/refresh` (wildcard block) or
 * `/public/<owner>/<repo>/alias/<alias>/api/auth/session/refresh` (domain block),
 * with `X-Original-URI` carrying the path the client asked for. `AuthMiddleware`
 * runs first on every route and used to answer `401 "try refresh token"` itself
 * once `sAccessToken` had expired, so the refresh never reached the auth proxy
 * rule and the session could never recover.
 *
 * The verdict belongs to `ProxyMiddleware.checkVisibilityAndAuth`, which has the
 * matched rule: an auth proxy rule (`isAuthProxyRule`) is let through, anything
 * else gets the same 401 from `req.tokenExpired`. Middleware-level unit tests
 * see one half each; these run both on the *same* request object, in
 * production order, and assert the outcome a client observes.
 */
import { Request, Response } from 'express';

jest.mock('supertokens-node/framework/express', () => ({
  middleware: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
}));
jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  // What SuperTokens does with an expired access token: TRY_REFRESH_TOKEN.
  getSession: jest.fn().mockRejectedValue(new Error('TRY_REFRESH_TOKEN')),
}));
jest.mock('./app-token.util', () => ({
  ...jest.requireActual('./app-token.util'),
  resolveAppToken: jest.fn().mockResolvedValue(null),
}));
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

import { middleware as supertokensMiddleware } from 'supertokens-node/framework/express';
import * as jwt from 'jsonwebtoken';
import { AuthMiddleware } from './auth.middleware';
import { ProxyMiddleware } from '../proxy-rules/proxy.middleware';
import { VisibilityService } from '../domains/visibility.service';

const mockSupertokensMiddleware = supertokensMiddleware as jest.Mock;
const mockDecode = jwt.decode as jest.Mock;
const mockDb = jest.requireMock('../db/client').db;

describe('expired session on a private alias host: AuthMiddleware → ProxyMiddleware (#811)', () => {
  let authMiddleware: AuthMiddleware;
  let proxyMiddleware: ProxyMiddleware;
  let supertokensHandler: jest.Mock;
  let visibilityService: {
    resolveAccessControlByDomain: jest.Mock;
    resolveAccessControlForAlias: jest.Mock;
  };
  let proxyRulesService: { getEffectiveRulesForRuleSet: jest.Mock };
  let proxyService: { forward: jest.Mock };
  let pipelineExecutionService: { executePipelineWithDebug: jest.Mock };

  const privateAccess = {
    isPublic: false,
    unauthorizedBehavior: 'redirect_login',
    requiredRole: 'authenticated',
    source: 'alias',
  };

  const project = {
    id: 'proj-1',
    owner: 'owner',
    name: 'repo',
    defaultProxyRuleSetId: null,
    isPublic: false,
  };
  const alias = {
    id: 'alias-1',
    projectId: 'proj-1',
    alias: 'studio',
    commitSha: 'abc123',
    proxyRuleSetId: 'set-1',
    isAutoPreview: false,
  };

  const rule = (overrides: Record<string, unknown> = {}) => ({
    id: 'rule-1',
    ruleSetId: 'set-1',
    pathPattern: '/api/auth/*',
    method: null,
    methods: null,
    targetUrl: 'http://backend:3000/api/auth',
    stripPrefix: false,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: true,
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

  // The SuperTokens web SDK's refresh call: fetch() with `rid: session`, no Accept,
  // carrying the expired access-token cookie. `X-Original-URI` / `X-Forwarded-Host`
  // are nginx's.
  const refreshRequest = (rewrittenPath: string, originalUri = '/api/auth/session/refresh') =>
    ({
      originalUrl: rewrittenPath,
      path: rewrittenPath,
      url: rewrittenPath,
      method: 'POST',
      headers: {
        rid: 'session',
        'x-forwarded-host': 'studio.example.com',
        'x-original-uri': originalUri,
      },
      cookies: { sAccessToken: 'expired.jwt' },
      query: {},
      get: () => undefined,
    }) as unknown as Request;

  const response = (): Response =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
      redirect: jest.fn(),
      cookie: jest.fn(),
    }) as unknown as Response;

  /** AuthMiddleware, then (if it lets the request through) ProxyMiddleware, as Nest chains them. */
  const runChain = async (req: Request, res: Response) => {
    const afterProxy = jest.fn();
    let proxyRun: Promise<void> | undefined;
    const afterAuth = jest.fn(() => {
      proxyRun = proxyMiddleware.use(req, res, afterProxy);
    });
    await authMiddleware.use(req, res, afterAuth);
    await proxyRun;
    return { afterAuth, afterProxy };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    supertokensHandler = jest.fn((_req, _res, nextFn) => nextFn());
    mockSupertokensMiddleware.mockReturnValue(supertokensHandler);
    mockDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 3600 });
    mockDb.orderBy.mockResolvedValue([]);
    mockDb.limit.mockResolvedValue([]);

    visibilityService = {
      resolveAccessControlByDomain: jest.fn().mockResolvedValue(privateAccess),
      resolveAccessControlForAlias: jest.fn().mockResolvedValue(privateAccess),
    };
    proxyRulesService = {
      getEffectiveRulesForRuleSet: jest.fn().mockResolvedValue([]),
    };
    proxyService = { forward: jest.fn().mockResolvedValue(undefined) };
    pipelineExecutionService = {
      executePipelineWithDebug: jest
        .fn()
        .mockResolvedValue({ success: true, response: { status: 200, body: {} } }),
    };

    authMiddleware = new AuthMiddleware(visibilityService as unknown as VisibilityService);
    proxyMiddleware = new ProxyMiddleware(
      proxyRulesService as never,
      proxyService as never,
      { handleSubmission: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('example.com') } as never,
      pipelineExecutionService as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      visibilityService as unknown as VisibilityService,
      {
        getUserProjectRole: jest.fn().mockResolvedValue(null),
        meetsRoleRequirement: jest.fn().mockReturnValue(true),
      } as never,
      { selectVariant: jest.fn().mockResolvedValue(null) } as never,
      { getGroupIdsForUser: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  describe('wildcard subdomain host (/public/subdomain-alias/<alias>/…)', () => {
    const rewritten = '/public/subdomain-alias/studio/api/auth/session/refresh';
    const arrangeAlias = () => {
      // ProxyMiddleware.handleSubdomainAlias: alias by name, then its project.
      mockDb.limit.mockResolvedValueOnce([alias]).mockResolvedValueOnce([project]);
    };

    it('reaches the SuperTokens middleware and is forwarded by the auth proxy rule (the bug)', async () => {
      arrangeAlias();
      const authRule = rule();
      proxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValue([authRule]);
      const req = refreshRequest(rewritten);
      const res = response();

      const { afterAuth } = await runChain(req, res);

      // AuthMiddleware did not answer; the request went through SuperTokens' own
      // middleware and on down the chain with the expiry recorded on it.
      expect(res.status).not.toHaveBeenCalled();
      expect(supertokensHandler).toHaveBeenCalledTimes(1);
      expect(afterAuth).toHaveBeenCalledTimes(1);
      expect((req as any).tokenExpired).toBe(true);
      // ProxyMiddleware let the auth proxy rule through and forwarded the refresh.
      expect(proxyRulesService.getEffectiveRulesForRuleSet).toHaveBeenCalledWith('set-1');
      expect(proxyService.forward).toHaveBeenCalledWith(
        req,
        res,
        authRule,
        '/api/auth/session/refresh',
      );
    });

    it('still answers 401 "try refresh token" for a pipeline mounted on the auth path, and never runs it', async () => {
      arrangeAlias();
      proxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValue([
        rule({ proxyType: 'pipeline', targetUrl: '', pipelineConfig: { steps: [] } }),
      ]);
      const req = refreshRequest(rewritten);
      const res = response();

      const { afterProxy } = await runChain(req, res);

      // Same wire contract as before: the SPA's baseQueryWithReauth reads this
      // body as "refresh and retry".
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
      expect(pipelineExecutionService.executePipelineWithDebug).not.toHaveBeenCalled();
      expect(proxyService.forward).not.toHaveBeenCalled();
      expect(afterProxy).not.toHaveBeenCalled();
    });

    it('still answers 401 for an external_proxy whose pattern is wider than the auth path (/api/*)', async () => {
      arrangeAlias();
      proxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValue([
        rule({ pathPattern: '/api/*', targetUrl: 'https://api.example.com' }),
      ]);
      const req = refreshRequest(rewritten);
      const res = response();

      await runChain(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
      expect(proxyService.forward).not.toHaveBeenCalled();
    });

    it('is not reached for any other API path: AuthMiddleware answers as before', async () => {
      const req = refreshRequest('/public/subdomain-alias/studio/api/works', '/api/works');
      const res = response();

      const { afterAuth } = await runChain(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
      expect(afterAuth).not.toHaveBeenCalled();
      expect(proxyRulesService.getEffectiveRulesForRuleSet).not.toHaveBeenCalled();
    });
  });

  describe('domain-mapped host (/public/<owner>/<repo>/alias/<alias>/…)', () => {
    const rewritten = '/public/owner/repo/alias/studio/api/auth/session/refresh';

    it('reaches the SuperTokens middleware and is forwarded by the auth proxy rule', async () => {
      // ProxyMiddleware.use: project by owner/name, then the alias by name.
      mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([alias]);
      const authRule = rule();
      proxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValue([authRule]);
      const req = refreshRequest(rewritten);
      const res = response();

      await runChain(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(supertokensHandler).toHaveBeenCalledTimes(1);
      expect(proxyService.forward).toHaveBeenCalledWith(
        req,
        res,
        authRule,
        '/api/auth/session/refresh',
      );
    });

    it('still answers 401 for a pipeline on the auth path', async () => {
      mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([alias]);
      proxyRulesService.getEffectiveRulesForRuleSet.mockResolvedValue([
        rule({ proxyType: 'pipeline', targetUrl: '', pipelineConfig: { steps: [] } }),
      ]);
      const req = refreshRequest(rewritten);
      const res = response();

      await runChain(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'try refresh token' });
      expect(pipelineExecutionService.executePipelineWithDebug).not.toHaveBeenCalled();
    });
  });
});
