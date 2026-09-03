import { McpHandler } from './mcp.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { McpHandlerConfig } from '../execution/step-handler.interface';

const config: McpHandlerConfig = {
  serverInfo: { name: 's', version: '1' },
  tools: [
    {
      name: 'app.read',
      description: 'r',
      inputSchema: { type: 'object' },
      rule: { path: '/api/app/read' },
    },
  ],
  resources: { csp: { connectDomains: ['$app', '$storage'] } },
};

function make() {
  const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
  const invoker = { invoke: jest.fn() };
  const storage = { getUrl: jest.fn().mockResolvedValue('https://storage.example/bucket/x?sig=1') };
  const handler = new McpHandler(registry, invoker as never, storage as never);
  return { handler, invoker, storage, registry };
}

function ctx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { headers: {}, cookies: {} } as never,
    user: { id: 'u', credential: 'app_token', scopes: ['app:read'] },
    stepOutputs: {},
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    deployment: { owner: 'o', repo: 'r', commitSha: 'c', alias: 'workflow' },
    metadata: {
      path: '/api/app/mcp',
      method: 'POST',
      headers: { 'x-forwarded-host': 'h.example' },
      query: {},
      body: {},
    },
    ...over,
  };
}
const step = (c: McpHandlerConfig = config): PipelineStep =>
  ({ id: 'mcp', name: 'mcp', handlerType: 'mcp_handler', config: c }) as PipelineStep;

describe('McpHandler', () => {
  it('registers as mcp_handler', () => {
    const { registry, handler } = make();
    expect(handler.type).toBe('mcp_handler');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('validateConfig', () => {
    it('accepts the sample and refuses duplicates, a bad path, a bad method, a bad visibility', () => {
      const { handler } = make();
      expect(() => handler.validateConfig(config)).not.toThrow();
      expect(() =>
        handler.validateConfig({ ...config, tools: [config.tools[0], config.tools[0]] }),
      ).toThrow(ConfigurationError);
      expect(() =>
        handler.validateConfig({
          ...config,
          tools: [{ ...config.tools[0], rule: { path: 'api/x' } }],
        }),
      ).toThrow(/rule.path/);
      expect(() =>
        handler.validateConfig({
          ...config,
          tools: [{ ...config.tools[0], rule: { path: '/x', method: 'PUT' as never } }],
        }),
      ).toThrow(/method/);
      expect(() =>
        handler.validateConfig({
          ...config,
          tools: [{ ...config.tools[0], visibility: ['host' as never] }],
        }),
      ).toThrow(/visibility/);
      expect(() =>
        handler.validateConfig({ ...config, serverInfo: { name: 's' } as never }),
      ).toThrow(/serverInfo/);
      expect(() =>
        handler.validateConfig({
          ...config,
          resources: {
            templates: [{ uriTemplate: 'ui://x/static', name: 'n', rule: { path: '/p' } }],
          },
        }),
      ).toThrow(/variable/);
    });
  });

  describe('execute', () => {
    it('answers tools/list with terminates: true and the JSON body', async () => {
      const { handler } = make();
      const result = await handler.execute(
        ctx({
          metadata: { ...ctx().metadata, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
        }),
        step(),
      );
      expect(result.success).toBe(true);
      expect(result.terminates).toBe(true);
      const output = result.output as {
        status: number;
        body: string;
        headers: Record<string, string>;
      };
      expect(output.status).toBe(200);
      expect(JSON.parse(output.body).result.tools[0].name).toBe('app.read');
      expect(output.headers['Content-Type']).toBe('application/json');
    });

    it('routes tools/call to the invoker with the caller, the alias, the parent request and depth 1', async () => {
      const { handler, invoker } = make();
      invoker.invoke.mockResolvedValue({
        ok: true,
        answer: {
          status: 200,
          body: { content: [{ type: 'text', text: 'ok' }] },
          headers: {},
          contentType: 'application/json',
        },
      });
      const c = ctx({
        metadata: {
          ...ctx().metadata,
          body: {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'app.read', arguments: { a: 1 } },
          },
        },
      });
      const result = await handler.execute(c, step());
      expect(invoker.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          alias: 'workflow',
          path: '/api/app/read',
          method: 'POST',
          body: { a: 1 },
          user: c.user,
          parent: c.request,
          depth: 1,
        }),
      );
      expect(JSON.parse((result.output as { body: string }).body).result).toEqual({
        content: [{ type: 'text', text: 'ok' }],
      });
    });

    it('increments the depth from the parent request marker', async () => {
      const { handler, invoker } = make();
      invoker.invoke.mockResolvedValue({ ok: false, failure: { kind: 'recursion' } });
      const c = ctx({
        request: { headers: {}, __invokeDepth: 1 } as never,
        metadata: {
          ...ctx().metadata,
          body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'app.read' } },
        },
      });
      await handler.execute(c, step());
      expect(invoker.invoke).toHaveBeenCalledWith(expect.objectContaining({ depth: 2 }));
    });

    it('answers GET with 405', async () => {
      const { handler } = make();
      const result = await handler.execute(
        ctx({ metadata: { ...ctx().metadata, method: 'GET' } }),
        step(),
      );
      expect((result.output as { status: number; headers: Record<string, string> }).status).toBe(
        405,
      );
      expect((result.output as { headers: Record<string, string> }).headers.Allow).toBe('POST');
    });

    it('derives the CSP origins from the host and a storage probe, cached per project', async () => {
      const { handler, storage } = make();
      const body = { jsonrpc: '2.0', id: 3, method: 'resources/list' };
      const cfg: McpHandlerConfig = {
        ...config,
        resources: {
          static: [{ uri: 'ui://s/v.html', name: 'v', rule: { path: '/v.html' } }],
          csp: { connectDomains: ['$app', '$storage'] },
        },
      };
      const first = await handler.execute(
        ctx({ metadata: { ...ctx().metadata, body } }),
        step(cfg),
      );
      await handler.execute(ctx({ metadata: { ...ctx().metadata, body } }), step(cfg));
      const resources = JSON.parse((first.output as { body: string }).body).result.resources;
      expect(resources[0]._meta.ui.csp.connectDomains).toEqual([
        'https://h.example',
        'https://storage.example',
      ]);
      expect(storage.getUrl).toHaveBeenCalledTimes(1);
    });
  });
});
