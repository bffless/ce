import type { McpHandlerConfig } from '../execution/step-handler.interface';
import type { InvokeAnswer, InvokeFailure } from '../../proxy-rules/rule-invoker.service';
import {
  ERR,
  PROTOCOL_VERSIONS,
  errorResponse,
  negotiateVersion,
  okResponse,
  parseMessage,
} from './jsonrpc';
import { DEFAULT_RESOURCE_MIME, expandPath, listedTools, matchTemplate, uiMeta } from './resources';
import { invokeFailureResult, noSuchTool, toolResultFromAnswer } from './results';

/** What the handler hands the protocol: how to run a sibling, and where the instance is. */
export interface ProtocolDeps {
  invoke(
    path: string,
    method: 'GET' | 'POST',
    args: Record<string, unknown>,
  ): Promise<{ ok: true; answer: InvokeAnswer } | { ok: false; failure: InvokeFailure }>;
  origins(): Promise<{ app: string; storage: string }>;
}

export interface ProtocolAnswer {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const JSON_HEADERS = { ...NO_STORE, 'Content-Type': 'application/json' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const json = (value: unknown, status = 200): ProtocolAnswer => ({
  status,
  body: JSON.stringify(value),
  headers: JSON_HEADERS,
});

/**
 * One HTTP request → one answer, the stateless Streamable-HTTP profile
 * (Phase 3 plan, Decisions 12/17): GET/DELETE → 405; a notification → 202
 * empty; everything else one JSON body. Method by method it is the shape the
 * Workflow prototype proved against claude.ai — kept check for check.
 */
export async function answer(
  config: McpHandlerConfig,
  request: { method: string; body: unknown },
  deps: ProtocolDeps,
): Promise<ProtocolAnswer> {
  if (request.method.toUpperCase() !== 'POST') {
    return {
      status: 405,
      body: JSON.stringify(
        errorResponse(
          null,
          ERR.INVALID_REQUEST,
          'Method Not Allowed: this MCP endpoint is stateless — POST one JSON-RPC message',
        ),
      ),
      headers: { ...JSON_HEADERS, Allow: 'POST' },
    };
  }

  const message = parseMessage(request.body);
  if (message.kind === 'invalid')
    return json(errorResponse(message.id, ERR.INVALID_REQUEST, message.message));
  if (message.kind === 'notification') return { status: 202, body: '', headers: NO_STORE };

  const { id, method, params } = message;
  const versions = config.protocolVersions?.length
    ? config.protocolVersions
    : [...PROTOCOL_VERSIONS];

  switch (method) {
    case 'initialize':
      return json(
        okResponse(id, {
          protocolVersion: negotiateVersion(params.protocolVersion, versions),
          capabilities: { tools: {}, resources: {} },
          serverInfo: config.serverInfo,
          ...(config.instructions ? { instructions: config.instructions } : {}),
        }),
      );
    case 'ping':
      return json(okResponse(id, {}));
    case 'tools/list':
      return json(okResponse(id, { tools: listedTools(config.tools) }));
    case 'tools/call':
      return json(okResponse(id, await callTool(config, params, deps)));
    case 'resources/list':
      return json(okResponse(id, { resources: await listResources(config, deps) }));
    case 'resources/read':
      return json(await readResource(config, id, params, deps));
    default:
      return json(errorResponse(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`));
  }
}

async function callTool(
  config: McpHandlerConfig,
  params: Record<string, unknown>,
  deps: ProtocolDeps,
) {
  const name = typeof params.name === 'string' ? params.name : '';
  const canonical = name.replace(/\//g, '.');
  const tool = config.tools.find((t) => t.name === canonical || t.name === name);
  if (!tool) return noSuchTool(name || '(none)');
  const args = isPlainObject(params.arguments) ? params.arguments : {};
  const method = tool.rule.method ?? 'POST';
  const result = await deps.invoke(tool.rule.path, method, args);
  if (!result.ok) return invokeFailureResult(result.failure, tool.name, tool.rule.path);
  return toolResultFromAnswer(result.answer, tool.name);
}

async function listResources(config: McpHandlerConfig, deps: ProtocolDeps) {
  const origins = await deps.origins();
  const meta = uiMeta(config.resources?.csp, origins);
  const out: Array<Record<string, unknown>> = [];
  for (const r of config.resources?.static ?? []) {
    out.push({
      uri: r.uri,
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      mimeType: r.mimeType ?? DEFAULT_RESOURCE_MIME,
      _meta: meta,
    });
  }
  const list = config.resources?.list;
  if (list) {
    const result = await deps.invoke(list.rule.path, list.rule.method ?? 'GET', {});
    if (result.ok && result.answer.status >= 200 && result.answer.status < 300) {
      const body = result.answer.body;
      const entries = Array.isArray(body)
        ? body
        : isPlainObject(body) && Array.isArray(body.resources)
          ? body.resources
          : [];
      for (const entry of entries) {
        if (!isPlainObject(entry) || typeof entry.uri !== 'string') continue;
        out.push({
          uri: entry.uri,
          name: typeof entry.name === 'string' ? entry.name : entry.uri,
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : DEFAULT_RESOURCE_MIME,
          _meta: meta,
        });
      }
    }
  }
  return out;
}

async function readResource(
  config: McpHandlerConfig,
  id: string | number | null,
  params: Record<string, unknown>,
  deps: ProtocolDeps,
) {
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const notFound = (why?: string) =>
    errorResponse(
      id,
      ERR.RESOURCE_NOT_FOUND,
      `Resource not found: ${uri}${why ? ` (${why})` : ''}`,
    );
  let target: { path: string; method: 'GET'; mimeType: string } | null = null;
  const fixed = config.resources?.static?.find((r) => r.uri === uri);
  if (fixed)
    target = {
      path: fixed.rule.path,
      method: 'GET',
      mimeType: fixed.mimeType ?? DEFAULT_RESOURCE_MIME,
    };
  if (!target) {
    for (const t of config.resources?.templates ?? []) {
      const vars = matchTemplate(t.uriTemplate, uri);
      if (vars) {
        target = {
          path: expandPath(t.rule.path, vars),
          method: 'GET',
          mimeType: t.mimeType ?? DEFAULT_RESOURCE_MIME,
        };
        break;
      }
    }
  }
  if (!target) return notFound();
  const result = await deps.invoke(target.path, 'GET', {});
  if (!result.ok)
    return notFound(result.failure.kind === 'error' ? result.failure.message : result.failure.kind);
  const { status, body } = result.answer;
  if (status < 200 || status >= 300) return notFound(`${status}`);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const origins = await deps.origins();
  return okResponse(id, {
    contents: [
      { uri, mimeType: target.mimeType, text, _meta: uiMeta(config.resources?.csp, origins) },
    ],
  });
}
