import {
  RuleInvokerService,
  buildTargetUrl,
  publicPrefixOf,
  MAX_INVOKE_DEPTH,
  structuredBody,
} from './rule-invoker.service';
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
  const executionLog = { log: jest.fn().mockResolvedValue('log-1') };
  const service = new RuleInvokerService(
    proxyRulesService as never,
    execution as never,
    executionLog as never,
  );
  return { service, proxyRulesService, execution, executionLog };
}

/** Let the fire-and-forget persistence chain settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const base = {
  projectId: 'proj-1',
  alias: 'workflow' as string | undefined,
  deployment: { owner: 'o', repo: 'r', commitSha: 'c', alias: 'workflow' },
  path: '/api/app/read',
  method: 'POST' as const,
  body: { a: 1 },
  user: { id: 'u', credential: 'app_token' as const, scopes: ['app:read'] },
  parent,
  parentRuleId: 'rule-mcp',
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

  describe("external_proxy siblings honour the rule's own header controls (ProxyService parity)", () => {
    const mockFetch = () =>
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"data":[]}',
      } as unknown as Response);
    const external = (over: Record<string, unknown> = {}) =>
      rule({
        proxyType: 'external_proxy',
        targetUrl: 'http://localhost:3000/api/aliases',
        pathPattern: '/api/app/aliases',
        stripPrefix: true,
        ...over,
      });
    const call = (service: RuleInvokerService) =>
      service.invoke({
        ...base,
        path: '/api/app/aliases',
        method: 'GET',
        body: undefined,
        query: { repository: 'o/r' },
      });
    const sent = (spy: jest.SpyInstance) =>
      (spy.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string> }])[1].headers;

    it('at the defaults (forwardCookies false, no authTransform) neither cookie nor authorization leaves', async () => {
      const { service } = make([external()]);
      const fetchSpy = mockFetch();
      const result = await call(service);
      expect(result).toEqual({
        ok: true,
        answer: { status: 200, body: { data: [] }, headers: {}, contentType: 'application/json' },
      });
      const [url] = fetchSpy.mock.calls[0] as [URL];
      expect(url.toString()).toBe('http://localhost:3000/api/aliases?repository=o%2Fr');
      const headers = sent(fetchSpy);
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers['content-type']).toBeUndefined();
      expect(headers['x-forwarded-host']).toBe('h.example');
      expect(headers['x-original-uri']).toBe('/api/app/aliases');
      expect(headers['user-agent']).toBe('ua');
      fetchSpy.mockRestore();
    });

    it('forwardCookies: true sends the cookie and still strips authorization', async () => {
      const { service } = make([external({ forwardCookies: true })]);
      const fetchSpy = mockFetch();
      await call(service);
      const headers = sent(fetchSpy);
      expect(headers.cookie).toBe('sAccessToken=abc');
      expect(headers.authorization).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it("headerConfig.forward/strip are the rule's to set — authorization goes only when listed", async () => {
      const { service } = make([
        external({ headerConfig: { forward: ['authorization', 'accept'], strip: ['host'] } }),
      ]);
      const fetchSpy = mockFetch();
      await call(service);
      const headers = sent(fetchSpy);
      expect(headers.authorization).toBe('Bearer bfat_x');
      expect(headers.cookie).toBeUndefined();
      fetchSpy.mockRestore();
    });

    it('authTransform cookie-to-bearer turns the named cookie into the bearer, as the edge does', async () => {
      const { service } = make([
        external({ authTransform: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' } }),
      ]);
      const fetchSpy = mockFetch();
      await call(service);
      const headers = sent(fetchSpy);
      expect(headers.authorization).toBe('Bearer abc');
      expect(headers.cookie).toBeUndefined();
      fetchSpy.mockRestore();
    });
  });

  it('refuses a sibling whose mcp_handler hides in postSteps', async () => {
    const { service, execution } = make([
      rule({
        pipelineConfig: {
          name: 'p',
          steps: [{ name: 'respond', handlerType: 'response_handler', config: { body: '{}' } }],
          postSteps: [{ name: 'again', handlerType: 'mcp_handler', config: {} }],
          validators: [],
        },
      }),
    ]);
    expect(await service.invoke(base)).toEqual({ ok: false, failure: { kind: 'recursion' } });
    expect(execution.executePipelineWithDebug).not.toHaveBeenCalled();
  });

  it("parses a pipeline sibling's JSON answer the response handler passed through as a string (large bodies, #418)", async () => {
    const { service, execution } = make([rule()]);
    const big = JSON.stringify({
      content: [{ type: 'text', text: 'x'.repeat(300 * 1024) }],
      structuredContent: { html: '<div>' },
    });
    execution.executePipelineWithDebug.mockResolvedValueOnce({
      success: true,
      response: { status: 200, body: big, headers: { 'Content-Type': 'application/json' } },
    });
    const result = await service.invoke(base);
    expect(result.ok).toBe(true);
    const body = (
      result as { answer: { body: { content: unknown[]; structuredContent: unknown } } }
    ).answer.body;
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.structuredContent).toEqual({ html: '<div>' });
    // not JSON, or not a JSON content type: the string stays a string
    expect(structuredBody('<html>', 'text/html')).toBe('<html>');
    expect(structuredBody('{not json', 'application/json')).toBe('{not json');
  });

  describe('execution logs (#738): a sibling is logged the way the edge logs the rule', () => {
    const debugInfo = {
      validators: [],
      steps: [{ name: 'respond', handlerType: 'response_handler', success: true }],
      totalDurationMs: 3,
      startTime: 's',
      endTime: 'e',
    };

    it('a debugEnabled sibling captures debug and persists one row tagged as an in-process invocation', async () => {
      const { service, execution, executionLog } = make([rule({ debugEnabled: true })]);
      execution.executePipelineWithDebug.mockResolvedValueOnce({
        success: true,
        response: { status: 200, body: { ok: true }, headers: {} },
        debug: debugInfo,
      });
      const result = await service.invoke(base);
      expect(result).toMatchObject({ ok: true, answer: { status: 200 } });
      expect(execution.executePipelineWithDebug.mock.calls[0][3]).toEqual({
        deployment: base.deployment,
        captureDebug: true,
      });
      await flush();
      expect(executionLog.log).toHaveBeenCalledTimes(1);
      const [ruleId, projectId, logged, meta, method, path] = executionLog.log.mock.calls[0];
      expect(ruleId).toBe('rule-1');
      expect(projectId).toBe('proj-1');
      expect(logged.debug).toBe(debugInfo);
      expect(meta).toEqual({
        ip: '1.2.3.4',
        userAgent: 'ua',
        userId: 'u',
        invocation: { source: 'in_process', parentRuleId: 'rule-mcp', depth: 1 },
      });
      expect(method).toBe('POST');
      expect(path).toBe('/api/app/read');
    });

    it('a sibling with debug off persists nothing on success or on a client-fault outcome', async () => {
      const { service, execution, executionLog } = make([rule({ debugEnabled: false })]);
      await service.invoke(base);
      expect(execution.executePipelineWithDebug.mock.calls[0][3]).toEqual({
        deployment: base.deployment,
        captureDebug: false,
      });
      for (const code of [
        'VALIDATION_ERROR',
        'AUTH_REQUIRED',
        'AUTHORIZATION_ERROR',
        'RATE_LIMIT_EXCEEDED',
      ]) {
        execution.executePipelineWithDebug.mockResolvedValueOnce({
          success: false,
          error: { code, message: 'no' },
        });
        mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
        await service.invoke(base);
      }
      await flush();
      expect(executionLog.log).not.toHaveBeenCalled();
    });

    it('an execution failure is always persisted, debug off (#724 parity), under its 500 status', async () => {
      const { service, execution, executionLog } = make([rule({ debugEnabled: false })]);
      execution.executePipelineWithDebug.mockResolvedValueOnce({
        success: false,
        error: { code: 'HANDLER_ERROR', message: 'boom', step: 'respond' },
      });
      expect(await service.invoke(base)).toMatchObject({ ok: true, answer: { status: 500 } });
      await flush();
      expect(executionLog.log).toHaveBeenCalledTimes(1);
      expect(executionLog.log.mock.calls[0][2]).toEqual({
        success: false,
        error: { code: 'HANDLER_ERROR', message: 'boom', step: 'respond' },
      });
      expect(executionLog.log.mock.calls[0][3].invocation).toEqual({
        source: 'in_process',
        parentRuleId: 'rule-mcp',
        depth: 1,
      });
    });

    it('a thrown execution is answered as an error failure and still persisted', async () => {
      const { service, execution, executionLog } = make([rule({ debugEnabled: false })]);
      execution.executePipelineWithDebug.mockRejectedValueOnce(new Error('kaboom'));
      expect(await service.invoke(base)).toEqual({
        ok: false,
        failure: { kind: 'error', message: 'kaboom' },
      });
      await flush();
      expect(executionLog.log).toHaveBeenCalledTimes(1);
      expect(executionLog.log.mock.calls[0][2]).toEqual({
        success: false,
        error: { code: 'PIPELINE_EXECUTION_ERROR', message: 'kaboom' },
      });
    });

    it('waits for post-steps so their debug info lands in the row, and omits parentRuleId when unknown', async () => {
      const { service, execution, executionLog } = make([rule({ debugEnabled: true })]);
      const postSteps = [{ name: 'after', handlerType: 'webhook', success: true }];
      const debug = { ...debugInfo };
      execution.executePipelineWithDebug.mockResolvedValueOnce({
        success: true,
        response: { status: 200, body: {}, headers: {} },
        debug,
        postStepsPromise: Promise.resolve(postSteps),
      });
      await service.invoke({ ...base, parentRuleId: undefined });
      await flush();
      expect(executionLog.log).toHaveBeenCalledTimes(1);
      expect(executionLog.log.mock.calls[0][2].debug.postSteps).toBe(postSteps);
      expect(executionLog.log.mock.calls[0][3].invocation).toEqual({
        source: 'in_process',
        depth: 1,
      });
    });

    it('a failing insert never reaches the caller', async () => {
      const { service, executionLog } = make([rule({ debugEnabled: true })]);
      executionLog.log.mockRejectedValueOnce(new Error('db down'));
      expect(await service.invoke(base)).toMatchObject({ ok: true, answer: { status: 200 } });
      await flush();
      expect(executionLog.log).toHaveBeenCalledTimes(1);
    });
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

describe('publicPrefixOf', () => {
  it("keeps the edge's rewrite shape for a sibling", () => {
    const p = (path: string, original?: string) =>
      ({ path, headers: original ? { 'x-original-uri': original } : {} }) as unknown as Request;
    expect(
      publicPrefixOf(
        p('/public/o/r/alias/workflow/dist/api/workflow/mcp', '/api/workflow/mcp?x=1'),
      ),
    ).toBe('/public/o/r/alias/workflow/dist');
    expect(publicPrefixOf(p('/api/workflow/mcp', '/api/workflow/mcp'))).toBe('');
    expect(publicPrefixOf(p('/public/o/r/alias/workflow/dist/api/workflow/mcp'))).toBe('');
  });
  it("gives the synthetic request the parent's prefix and the sibling path as x-original-uri", async () => {
    const proxyRulesService = {
      getEffectiveRulesForMultipleRuleSets: jest.fn().mockResolvedValue([rule()]),
    };
    const execution = {
      executePipelineWithDebug: jest
        .fn()
        .mockResolvedValue({ success: true, response: { status: 200, body: {} } }),
    };
    const service = new RuleInvokerService(
      proxyRulesService as never,
      execution as never,
      { log: jest.fn().mockResolvedValue('log-1') } as never,
    );
    mockDb.limit.mockReset();
    mockDb.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([aliasRow]);
    const parentEdge = {
      ...parent,
      path: '/public/o/r/alias/workflow/dist/api/workflow/mcp',
      headers: { ...parent.headers, 'x-original-uri': '/api/workflow/mcp' },
    } as unknown as Request;
    await service.invoke({
      ...base,
      parent: parentEdge,
      query: { a: '1' },
      method: 'GET',
      body: undefined,
    });
    const synthetic = execution.executePipelineWithDebug.mock.calls[0][1];
    expect(synthetic.path).toBe('/public/o/r/alias/workflow/dist/api/app/read');
    expect(synthetic.headers['x-original-uri']).toBe('/api/app/read?a=1');
  });
});
