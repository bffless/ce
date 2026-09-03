import { RuleInvokerService, buildTargetUrl, MAX_INVOKE_DEPTH } from './rule-invoker.service';
import { Request } from 'express';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    limit: jest.fn(),
  },
}));
const mockDb = jest.requireMock('../db/client').db;

const project = { id: 'proj-1', owner: 'o', name: 'r', defaultProxyRuleSetId: 'set-default' };
const aliasRow = { id: 'alias-1', alias: 'workflow', proxyRuleSetId: 'set-1' };

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  ruleSetId: 'set-1',
  pathPattern: '/api/app/*',
  method: null,
  methods: null,
  targetUrl: 'http://internal/pipeline',
  stripPrefix: true,
  order: 0,
  timeout: 30000,
  preserveHost: false,
  forwardCookies: false,
  headerConfig: null,
  authTransform: null,
  internalRewrite: false,
  proxyType: 'pipeline',
  emailHandlerConfig: null,
  pipelineConfig: {
    name: 'p',
    steps: [{ name: 'respond', handlerType: 'response_handler', config: { body: '{}' } }],
    validators: [],
  },
  isEnabled: true,
  debugEnabled: false,
  bypassVisibility: false,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const parent = {
  headers: {
    cookie: 'sAccessToken=abc',
    authorization: 'Bearer bfat_x',
    host: 'localhost:3000',
    'x-forwarded-host': 'h.example',
    'content-length': '12',
    'user-agent': 'ua',
  },
  cookies: { a: 'b' },
  ip: '1.2.3.4',
  socket: {},
  protocol: 'https',
  secure: true,
} as unknown as Request;

function make(rules: unknown[]) {
  const proxyRulesService = {
    getEffectiveRulesForMultipleRuleSets: jest.fn().mockResolvedValue(rules),
  };
  const execution = {
    executePipelineWithDebug: jest.fn().mockResolvedValue({
      success: true,
      response: {
        status: 200,
        body: { ok: true },
        headers: { 'Content-Type': 'application/json' },
      },
    }),
  };
  const service = new RuleInvokerService(proxyRulesService as never, execution as never);
  return { service, proxyRulesService, execution };
}

const base = {
  projectId: 'proj-1',
  alias: 'workflow' as string | undefined,
  deployment: { owner: 'o', repo: 'r', commitSha: 'c', alias: 'workflow' },
  path: '/api/app/read',
  method: 'POST' as const,
  body: { a: 1 },
  user: { id: 'u', credential: 'app_token' as const, scopes: ['app:read'] },
  parent,
  depth: 1,
};

describe('RuleInvokerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.limit.mockReset();
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    mockDb.orderBy.mockResolvedValue([{ proxyRuleSetId: 'set-1' }]);
  });

  it('runs a pipeline sibling as the caller on a synthetic request without a res, and answers its response', async () => {
    const { service, execution } = make([rule()]);
    const result = await service.invoke(base);
    expect(result).toEqual({
      ok: true,
      answer: {
        status: 200,
        body: { ok: true },
        headers: { 'Content-Type': 'application/json' },
        contentType: 'application/json',
      },
    });
    const [pipeline, synthetic, user, options] = execution.executePipelineWithDebug.mock.calls[0];
    expect(pipeline).toMatchObject({
      id: 'rule-1',
      projectId: 'proj-1',
      steps: [{ handlerType: 'response_handler' }],
    });
    expect(user).toBe(base.user);
    expect(options).toEqual({ deployment: base.deployment, captureDebug: false });
    expect(synthetic.path).toBe('/api/app/read');
    expect(synthetic.method).toBe('POST');
    expect(synthetic.body).toEqual({ a: 1 });
    expect(synthetic.headers.cookie).toBe('sAccessToken=abc');
    expect(synthetic.headers.authorization).toBe('Bearer bfat_x');
    expect(synthetic.headers['content-length']).toBeUndefined();
    expect(synthetic.res).toBeUndefined();
    expect(synthetic.get('User-Agent')).toBe('ua');
    expect(synthetic.__invokeDepth).toBe(1);
  });

  it('maps a failed pipeline to the edge status table and carries the scope header', async () => {
    const { service, execution } = make([rule()]);
    execution.executePipelineWithDebug.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'AUTHORIZATION_ERROR',
        message: 'insufficient_scope: missing app:write',
        details: { code: 'insufficient_scope', missingScopes: ['app:write'] },
      },
    });
    const result = await service.invoke(base);
    expect(result).toMatchObject({
      ok: true,
      answer: {
        status: 403,
        headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="app:write"' },
      },
    });
    execution.executePipelineWithDebug.mockResolvedValueOnce({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'x' },
    });
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    expect(await service.invoke(base)).toMatchObject({ ok: true, answer: { status: 401 } });
  });

  it('answers no_rule when nothing matches, unsupported for an internal rewrite, recursion for depth and for an mcp_handler sibling', async () => {
    const { service } = make([rule({ pathPattern: '/other/*' })]);
    expect(await service.invoke(base)).toEqual({ ok: false, failure: { kind: 'no_rule' } });

    const rewrite = make([rule({ proxyType: 'internal_rewrite' })]);
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    expect(await rewrite.service.invoke(base)).toEqual({
      ok: false,
      failure: { kind: 'unsupported', proxyType: 'internal_rewrite' },
    });

    const nested = make([
      rule({
        pipelineConfig: {
          name: 'p',
          steps: [{ name: 'mcp', handlerType: 'mcp_handler', config: {} }],
        },
      }),
    ]);
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    expect(await nested.service.invoke(base)).toEqual({
      ok: false,
      failure: { kind: 'recursion' },
    });

    const deep = make([rule()]);
    expect(await deep.service.invoke({ ...base, depth: MAX_INVOKE_DEPTH + 1 })).toEqual({
      ok: false,
      failure: { kind: 'recursion' },
    });
  });

  it("fetches an external_proxy sibling in-process with the caller's cookie and authorization", async () => {
    const { service } = make([
      rule({
        proxyType: 'external_proxy',
        targetUrl: 'http://localhost:3000/api/aliases',
        pathPattern: '/api/app/aliases',
        stripPrefix: true,
      }),
    ]);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":[]}',
    } as unknown as Response);
    const result = await service.invoke({
      ...base,
      path: '/api/app/aliases',
      method: 'GET',
      body: undefined,
      query: { repository: 'o/r' },
    });
    expect(result).toEqual({
      ok: true,
      answer: { status: 200, body: { data: [] }, headers: {}, contentType: 'application/json' },
    });
    const [url, init] = fetchSpy.mock.calls[0] as [
      URL,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url.toString()).toBe('http://localhost:3000/api/aliases?repository=o%2Fr');
    expect(init.headers.cookie).toBe('sAccessToken=abc');
    expect(init.headers.authorization).toBe('Bearer bfat_x');
    expect(init.headers['x-forwarded-host']).toBe('h.example');
    expect(init.headers['x-original-uri']).toBe('/api/app/aliases');
    fetchSpy.mockRestore();
  });

  it("caches the alias's rules for a short window", async () => {
    const { service, proxyRulesService } = make([rule()]);
    await service.invoke(base);
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    await service.invoke(base);
    expect(proxyRulesService.getEffectiveRulesForMultipleRuleSets).toHaveBeenCalledTimes(1);
  });
});

describe('buildTargetUrl (ProxyService parity)', () => {
  const r = (over: Record<string, unknown>) =>
    rule({ proxyType: 'external_proxy', ...over }) as never;
  it('strips the matched prefix onto the target path', () => {
    expect(
      buildTargetUrl(
        r({ pathPattern: '/api/platform/*', targetUrl: 'http://host/api' }),
        '/api/platform/organizations',
      ).toString(),
    ).toBe('http://host/api/organizations');
    expect(
      buildTargetUrl(
        r({
          pathPattern: '/w/hello/*',
          targetUrl: 'http://localhost:3000/public/o/r/alias/hello/dist',
        }),
        '/w/hello/islands/x.html',
      ).toString(),
    ).toBe('http://localhost:3000/public/o/r/alias/hello/dist/islands/x.html');
    expect(
      buildTargetUrl(
        r({ pathPattern: '/env.json', targetUrl: 'http://host/cfg/env.json' }),
        '/env.json',
      ).toString(),
    ).toBe('http://host/cfg/env.json');
    expect(
      buildTargetUrl(
        r({ pathPattern: '/api/*', targetUrl: 'http://host', stripPrefix: false }),
        '/api/x',
      ).toString(),
    ).toBe('http://host/api/x');
  });
});
