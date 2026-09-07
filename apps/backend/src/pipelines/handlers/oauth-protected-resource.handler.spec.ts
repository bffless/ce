import { OAuthProtectedResourceHandler } from './oauth-protected-resource.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { OAuthProtectedResourceConfig } from '../execution/step-handler.interface';
import { ProxyRule } from '../../db/schema/proxy-rules.schema';

const rule = (over: Partial<ProxyRule>): ProxyRule =>
  ({
    id: 'r',
    ruleSetId: 'set-1',
    pathPattern: '/api/x',
    method: null,
    methods: null,
    targetUrl: 'pipeline',
    stripPrefix: false,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'pipeline',
    emailHandlerConfig: null,
    pipelineConfig: null,
    isEnabled: true,
    description: null,
    debugEnabled: false,
    bypassVisibility: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as ProxyRule;

const authRequired = (requiredScopes: string[]) => ({
  type: 'auth_required' as const,
  config: { requiredScopes },
});

/** The workflow-shaped alias: an mcp_handler at /api/mcp whose tools map to scoped siblings. */
const siblings: ProxyRule[] = [
  rule({
    id: 'mcp',
    pathPattern: '/api/mcp',
    methods: ['GET', 'POST', 'DELETE'],
    pipelineConfig: {
      name: 'mcp',
      steps: [
        {
          name: 'server',
          handlerType: 'mcp_handler',
          config: {
            serverInfo: { name: 'BFFless Workflow', version: '1' },
            tools: [
              { name: 'list', rule: { path: '/api/tools/list', method: 'POST' } },
              { name: 'start', rule: { path: '/api/tools/start' } },
              { name: 'sign', rule: { path: '/api/tools/sign', method: 'GET' } },
              { name: 'orphan', rule: { path: '/api/tools/nowhere' } },
            ],
          },
        },
      ],
    },
  }),
  rule({
    id: 'list',
    pathPattern: '/api/tools/list',
    method: 'POST',
    pipelineConfig: { name: 'l', validators: [authRequired(['workflow:read'])], steps: [] },
  }),
  rule({
    id: 'start',
    pathPattern: '/api/tools/start',
    method: 'POST',
    pipelineConfig: {
      name: 's',
      validators: [authRequired(['workflow:run', 'workflow:read'])],
      steps: [],
    },
  }),
  rule({
    id: 'sign',
    pathPattern: '/api/tools/*',
    method: 'GET',
    pipelineConfig: { name: 'g', validators: [authRequired(['workflow:files'])], steps: [] },
  }),
  rule({
    id: 'admin',
    pathPattern: '/api/admin',
    pipelineConfig: { name: 'a', validators: [authRequired(['workflow:admin'])], steps: [] },
  }),
];

function make(rules: ProxyRule[] = siblings, issuer = 'https://admin.j5s.dev') {
  const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
  const invoker = { effectiveRules: jest.fn().mockResolvedValue(rules) };
  const oauth = { issuer: jest.fn().mockReturnValue(issuer) };
  const handler = new OAuthProtectedResourceHandler(registry, invoker as never, oauth as never);
  return { handler, invoker, oauth, registry };
}

function ctx(
  headers: Record<string, string | string[] | undefined>,
  over: Partial<PipelineContext['metadata']> = {},
): PipelineContext {
  return {
    request: { headers, cookies: {} } as never,
    user: undefined,
    stepOutputs: {},
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    deployment: { owner: 'o', repo: 'r', commitSha: 'c', alias: 'workflow' },
    metadata: {
      path: '/public/o/r/alias/workflow/.well-known/oauth-protected-resource',
      method: 'GET',
      headers,
      query: {},
      body: {},
      ...over,
    },
  };
}

const step = (config: OAuthProtectedResourceConfig): PipelineStep =>
  ({ id: 'prm', name: 'prm', handlerType: 'oauth_protected_resource', config }) as PipelineStep;

const out = (result: { output?: unknown }) => {
  const o = result.output as { status: number; body: string; headers: Record<string, string> };
  return { status: o.status, headers: o.headers, body: JSON.parse(o.body) };
};

describe('OAuthProtectedResourceHandler', () => {
  it('registers as oauth_protected_resource', () => {
    const { registry, handler } = make();
    expect(handler.type).toBe('oauth_protected_resource');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('validateConfig', () => {
    it('needs a literal path on this host; scopes are namespace:verb; documentation is a URL', () => {
      const { handler } = make();
      expect(() => handler.validateConfig({ resource: '/api/mcp' })).not.toThrow();
      expect(() =>
        handler.validateConfig({
          resource: '/api/mcp',
          scopes: ['workflow:read'],
          resourceName: 'x',
          resourceDocumentation: 'https://docs.example/mcp',
        }),
      ).not.toThrow();
      expect(() => handler.validateConfig({} as never)).toThrow(ConfigurationError);
      expect(() => handler.validateConfig({ resource: 'api/mcp' })).toThrow(/starting with \//);
      expect(() => handler.validateConfig({ resource: '/api/*' })).toThrow(/literal path/);
      expect(() => handler.validateConfig({ resource: '/api/mcp?x=1' })).toThrow(/literal path/);
      expect(() =>
        handler.validateConfig({ resource: '/api/mcp', scopes: 'workflow:read' as never }),
      ).toThrow(/array/);
      expect(() =>
        handler.validateConfig({ resource: '/api/mcp', scopes: ['Workflow Read'] }),
      ).toThrow(/namespace:verb/);
      expect(() =>
        handler.validateConfig({ resource: '/api/mcp', resourceDocumentation: 'not a url' }),
      ).toThrow(/URL/);
    });
  });

  describe('execute', () => {
    it('emits the RFC 9728 document with explicit scopes verbatim, the issuer from OAuthService and a 5-minute public cache', async () => {
      const { handler, invoker, oauth } = make();
      const result = await handler.execute(
        ctx({ 'x-forwarded-host': 'workflow.j5s.dev, 10.0.0.1', host: 'localhost:3000' }),
        step({
          resource: '/api/mcp',
          scopes: ['workflow:read', 'workflow:run'],
          resourceName: 'Workflow',
          resourceDocumentation: 'https://docs.example/mcp',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.terminates).toBe(true);
      const { status, headers, body } = out(result);
      expect(status).toBe(200);
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      expect(body).toEqual({
        resource: 'https://workflow.j5s.dev/api/mcp',
        authorization_servers: ['https://admin.j5s.dev'],
        scopes_supported: ['workflow:read', 'workflow:run'],
        bearer_methods_supported: ['header'],
        resource_name: 'Workflow',
        resource_documentation: 'https://docs.example/mcp',
      });
      expect(oauth.issuer).toHaveBeenCalled();
      // Everything was declared: the siblings were not consulted.
      expect(invoker.effectiveRules).not.toHaveBeenCalled();
    });

    it('derives scopes_supported from the siblings the mcp_handler at `resource` maps its tools to, and resource_name from serverInfo.name', async () => {
      const { handler, invoker } = make();
      const result = await handler.execute(
        ctx({ 'x-forwarded-host': 'workflow.j5s.dev' }),
        step({ resource: '/api/mcp' }),
      );
      const { body } = out(result);
      expect(invoker.effectiveRules).toHaveBeenCalledWith('proj-1', 'workflow');
      // Union in first-appearance order; the GET sibling resolves with the tool's method;
      // a tool with no sibling contributes nothing; an unrelated scoped rule is not offered.
      expect(body.scopes_supported).toEqual(['workflow:read', 'workflow:run', 'workflow:files']);
      expect(body.resource_name).toBe('BFFless Workflow');
      expect(body.resource).toBe('https://workflow.j5s.dev/api/mcp');
      expect(body).not.toHaveProperty('resource_documentation');
    });

    it('answers an empty scopes_supported and no resource_name when no mcp_handler answers `resource`', async () => {
      const { handler } = make([]);
      const result = await handler.execute(
        ctx({ host: 'h.example' }),
        step({ resource: '/api/elsewhere' }),
      );
      const { body } = out(result);
      expect(body.scopes_supported).toEqual([]);
      expect(body).not.toHaveProperty('resource_name');
      expect(body.resource).toBe('https://h.example/api/elsewhere');
    });

    it('serves the same document at the path-suffixed form when the suffix is `resource`, and 404s another suffix', async () => {
      const { handler } = make();
      const headers = {
        'x-forwarded-host': 'workflow.j5s.dev',
        'x-original-uri': '/.well-known/oauth-protected-resource/api/mcp?x=1',
      };
      const same = out(
        await handler.execute(
          ctx(headers, {
            path: '/public/o/r/alias/workflow/.well-known/oauth-protected-resource/api/mcp',
          }),
          step({ resource: '/api/mcp', scopes: [] }),
        ),
      );
      expect(same.status).toBe(200);
      expect(same.body.resource).toBe('https://workflow.j5s.dev/api/mcp');

      const other = out(
        await handler.execute(
          ctx({
            'x-forwarded-host': 'workflow.j5s.dev',
            'x-original-uri': '/.well-known/oauth-protected-resource/api/other',
          }),
          step({ resource: '/api/mcp', scopes: [] }),
        ),
      );
      expect(other.status).toBe(404);
      expect(other.body.error).toBe('not_found');
      expect(other.headers['Content-Type']).toBe('application/json');
    });

    it('falls back to the request path for the suffix when x-original-uri is absent', async () => {
      const { handler } = make();
      const result = out(
        await handler.execute(
          ctx(
            { 'x-forwarded-host': 'workflow.j5s.dev' },
            { path: '/public/o/r/alias/workflow/.well-known/oauth-protected-resource/api/nope' },
          ),
          step({ resource: '/api/mcp', scopes: [] }),
        ),
      );
      expect(result.status).toBe(404);
    });

    it('uses `host` when x-forwarded-host is absent and refuses a request that names no host', async () => {
      const { handler } = make();
      const viaHost = out(
        await handler.execute(
          ctx({ host: 'h.example' }),
          step({ resource: '/api/mcp', scopes: [] }),
        ),
      );
      expect(viaHost.body.resource).toBe('https://h.example/api/mcp');

      const none = out(await handler.execute(ctx({}), step({ resource: '/api/mcp', scopes: [] })));
      expect(none.status).toBe(400);
      expect(none.body.error).toBe('no_host');
    });
  });
});
