import type { McpHandlerConfig } from '../execution/step-handler.interface';
import { answer, type ProtocolDeps } from './protocol';

const config: McpHandlerConfig = {
  serverInfo: { name: 'test-server', version: '1.2.3' },
  instructions: 'hello',
  tools: [
    {
      name: 'app.read',
      description: 'r',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      rule: { path: '/api/app/read', method: 'GET' },
    },
    {
      name: 'app.write',
      description: 'w',
      inputSchema: { type: 'object' },
      rule: { path: '/api/app/write' },
    },
    {
      name: 'app.hidden',
      description: 'h',
      inputSchema: { type: 'object' },
      visibility: ['app'],
      rule: { path: '/api/app/hidden' },
    },
  ],
  resources: {
    static: [{ uri: 'ui://app/view.html', name: 'View', rule: { path: '/view.html' } }],
    templates: [
      {
        uriTemplate: 'ui://app/{impl}/{path+}',
        name: 'island',
        rule: { path: '/w/{impl}/{path+}' },
      },
    ],
    list: { rule: { path: '/api/app/resources' } },
    csp: { connectDomains: ['$app', '$storage'], resourceDomains: ['$storage'] },
  },
};

type Call = { path: string; method: string; args: Record<string, unknown> };

function deps(
  answers: Record<
    string,
    | { status: number; body: unknown; headers?: Record<string, string> }
    | { failure: 'no_rule' | 'recursion' }
  >,
) {
  const calls: Call[] = [];
  const d: ProtocolDeps = {
    async invoke(path, method, args) {
      calls.push({ path, method, args });
      const a = answers[path];
      if (!a) return { ok: false, failure: { kind: 'no_rule' } };
      if ('failure' in a) return { ok: false, failure: { kind: a.failure } };
      return {
        ok: true,
        answer: {
          status: a.status,
          body: a.body,
          headers: a.headers ?? {},
          contentType: 'application/json',
        },
      };
    },
    async origins() {
      return { app: 'https://h.example', storage: 'https://storage.example' };
    },
  };
  return { d, calls };
}

const post = (body: unknown) => ({ method: 'POST', body });
const msg = (method: string, params: Record<string, unknown> = {}, id: number | null = 1) =>
  post({ jsonrpc: '2.0', id, method, params });
const parsed = (a: { body: string }) =>
  JSON.parse(a.body) as {
    id: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };

describe('protocol', () => {
  it('answers GET and DELETE with 405 Allow: POST', async () => {
    const { d } = deps({});
    const get = await answer(config, { method: 'GET', body: undefined }, d);
    expect(get.status).toBe(405);
    expect(get.headers.Allow).toBe('POST');
    expect(parsed(get).error?.code).toBe(-32600);
    expect((await answer(config, { method: 'DELETE', body: undefined }, d)).status).toBe(405);
  });
  it('answers a notification with 202 and an empty body, an invalid body with -32600, an unknown method with -32601', async () => {
    const { d } = deps({});
    expect(
      await answer(config, post({ jsonrpc: '2.0', method: 'notifications/initialized' }), d),
    ).toMatchObject({ status: 202, body: '' });
    expect(parsed(await answer(config, post([]), d)).error?.code).toBe(-32600);
    expect(parsed(await answer(config, msg('prompts/list'), d)).error?.code).toBe(-32601);
  });
  it('initialize negotiates the version and echoes serverInfo + instructions; ping is {}', async () => {
    const { d } = deps({});
    expect(
      parsed(await answer(config, msg('initialize', { protocolVersion: '2025-03-26' }), d)).result,
    ).toEqual({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'test-server', version: '1.2.3' },
      instructions: 'hello',
    });
    expect(
      parsed(await answer(config, msg('initialize', { protocolVersion: '1999' }), d)).result
        ?.protocolVersion,
    ).toBe('2025-06-18');
    expect(parsed(await answer(config, msg('ping'), d)).result).toEqual({});
    expect((await answer(config, msg('ping'), d)).headers['Cache-Control']).toBe('no-store');
  });
  it('tools/list projects the declarations', async () => {
    const { d } = deps({});
    const tools = parsed(await answer(config, msg('tools/list'), d)).result?.tools as Array<
      Record<string, unknown>
    >;
    expect(tools.map((t) => t.name)).toEqual(['app.read', 'app.write', 'app.hidden']);
    expect(tools[2]._meta).toEqual({ ui: { visibility: ['app'] } });
    expect(JSON.stringify(tools)).not.toContain('"rule"');
  });
  it('tools/call routes to the sibling: arguments as query for GET, body for POST; slash-tolerant names; verbatim CallToolResult bodies', async () => {
    const { d, calls } = deps({
      '/api/app/read': {
        status: 200,
        body: { content: [{ type: 'text', text: 'ok' }], structuredContent: { n: 1 } },
      },
      '/api/app/write': { status: 200, body: { wrote: true } },
    });
    const read = parsed(
      await answer(config, msg('tools/call', { name: 'app/read', arguments: { runId: 'r' } }), d),
    ).result;
    expect(read).toEqual({ content: [{ type: 'text', text: 'ok' }], structuredContent: { n: 1 } });
    expect(calls[0]).toEqual({ path: '/api/app/read', method: 'GET', args: { runId: 'r' } });
    const write = parsed(
      await answer(config, msg('tools/call', { name: 'app.write', arguments: { a: 1 } }), d),
    ).result;
    expect(write).toEqual({
      content: [{ type: 'text', text: '{"wrote":true}' }],
      structuredContent: { wrote: true },
    });
    expect(calls[1]).toEqual({ path: '/api/app/write', method: 'POST', args: { a: 1 } });
  });
  it('tools/call: an unknown tool, a missing rule, a refused scope are tool errors, never protocol errors', async () => {
    const { d } = deps({
      '/api/app/write': {
        status: 403,
        body: { success: false, error: { code: 'AUTHORIZATION_ERROR', message: 'x' } },
        headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="app:write"' },
      },
    });
    const unknown = parsed(await answer(config, msg('tools/call', { name: 'nope' }), d));
    expect(unknown.error).toBeUndefined();
    expect(unknown.result).toMatchObject({
      isError: true,
      structuredContent: { errors: { tool: 'No such tool' } },
    });
    const noRule = parsed(await answer(config, msg('tools/call', { name: 'app.read' }), d)).result;
    expect(noRule).toMatchObject({
      isError: true,
      structuredContent: { errors: { tool: 'no rule answers /api/app/read' } },
    });
    const scope = parsed(await answer(config, msg('tools/call', { name: 'app.write' }), d)).result;
    expect(scope).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'insufficient_scope: missing app:write' }],
    });
  });
  it('resources/list merges static and listed resources with the derived CSP', async () => {
    const { d } = deps({
      '/api/app/resources': {
        status: 200,
        body: [{ uri: 'ui://app/hello/islands/x.html', name: 'x' }, { nope: 1 }],
      },
    });
    const resources = parsed(await answer(config, msg('resources/list'), d)).result
      ?.resources as Array<Record<string, unknown>>;
    expect(resources.map((r) => r.uri)).toEqual([
      'ui://app/view.html',
      'ui://app/hello/islands/x.html',
    ]);
    expect(resources[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(resources[1]._meta).toEqual({
      ui: {
        csp: {
          connectDomains: ['https://h.example', 'https://storage.example'],
          resourceDomains: ['https://storage.example'],
        },
        prefersBorder: true,
      },
    });
  });
  it('resources/read serves a static and a templated resource, and -32002 otherwise', async () => {
    const { d, calls } = deps({
      '/view.html': { status: 200, body: '<html>view</html>' },
      '/w/hello/islands/x.html': { status: 200, body: '<html>island</html>' },
      '/w/hello/gone.html': { status: 404, body: 'no' },
    });
    const fixed = parsed(
      await answer(config, msg('resources/read', { uri: 'ui://app/view.html' }), d),
    ).result?.contents as Array<Record<string, unknown>>;
    expect(fixed[0]).toMatchObject({
      uri: 'ui://app/view.html',
      mimeType: 'text/html;profile=mcp-app',
      text: '<html>view</html>',
    });
    const island = parsed(
      await answer(config, msg('resources/read', { uri: 'ui://app/hello/islands/x.html' }), d),
    ).result?.contents as Array<Record<string, unknown>>;
    expect(island[0].text).toBe('<html>island</html>');
    expect(calls[1]).toMatchObject({ path: '/w/hello/islands/x.html', method: 'GET' });
    expect(
      parsed(await answer(config, msg('resources/read', { uri: 'ui://app/hello/gone.html' }), d))
        .error,
    ).toMatchObject({ code: -32002 });
    expect(
      parsed(await answer(config, msg('resources/read', { uri: 'ui://elsewhere/x' }), d)).error
        ?.code,
    ).toBe(-32002);
    expect(
      parsed(await answer(config, msg('resources/read', { uri: 'ui://app/hello/../x' }), d)).error
        ?.code,
    ).toBe(-32002);
  });
});
