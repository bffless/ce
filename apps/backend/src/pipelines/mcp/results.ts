import type { InvokeAnswer, InvokeFailure } from '../../proxy-rules/rule-invoker.service';

/**
 * A tool's answer, from what its sibling rule answered (Phase 3 plan, Decision
 * 15). Every result is an MCP `CallToolResult`: prose in `content[0].text`
 * (agent hosts are text-only to the model), data in `structuredContent`.
 */
export interface CallToolResultLike {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `structuredContent` must be an object: a string body becomes `{ text }`, any other non-object `{ value }`. */
export function structured(body: unknown): Record<string, unknown> {
  if (isPlainObject(body)) return body;
  return typeof body === 'string' ? { text: body } : { value: body };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
): CallToolResultLike {
  return { content: [{ type: 'text', text }], ...(structuredContent ? { structuredContent } : {}) };
}

export function errorResult(
  text: string,
  structuredContent?: Record<string, unknown>,
): CallToolResultLike {
  return { isError: true, ...textResult(text, structuredContent) };
}

export function noSuchTool(name: string): CallToolResultLike {
  return errorResult(`No such tool: ${name}`, { errors: { tool: 'No such tool' } });
}

/** A body that already IS a CallToolResult (a `content` array) is passed through verbatim. */
function isCallToolResult(body: unknown): body is CallToolResultLike {
  return isPlainObject(body) && Array.isArray(body.content);
}

/** The missing scopes a 403's `WWW-Authenticate: Bearer error="insufficient_scope", scope="a b"` names. */
function missingScopesOf(answer: InvokeAnswer): string[] {
  const header = answer.headers['www-authenticate'] ?? answer.headers['WWW-Authenticate'];
  const match = typeof header === 'string' ? header.match(/scope="([^"]*)"/) : null;
  if (match) return match[1].split(/\s+/).filter(Boolean);
  const body = answer.body as { error?: { details?: { missingScopes?: string[] } } } | undefined;
  return body?.error?.details?.missingScopes ?? [];
}

/**
 * Decision 15: 2xx `content[]` → verbatim; other 2xx → wrapped; 401 →
 * `errors.auth`; 403 insufficient_scope → `errors.scope` naming the scope;
 * any other non-2xx → `errors.pipeline: '<code>: <message>'` + `_meta.bffless.status`.
 */
export function toolResultFromAnswer(answer: InvokeAnswer, toolName: string): CallToolResultLike {
  const { status, body } = answer;
  if (status >= 200 && status < 300) {
    if (isCallToolResult(body)) return body;
    return textResult(typeof body === 'string' ? body : JSON.stringify(body), structured(body));
  }
  const b = structured(body);
  const error = isPlainObject(b.error) ? b.error : b;
  if (status === 401) {
    const text = `${toolName} needs a signed-in caller: ${str(error.message) ?? 'authentication required'}`;
    return {
      ...errorResult(text, { errors: { auth: text }, status }),
      _meta: { bffless: { status } },
    };
  }
  const missing = status === 403 ? missingScopesOf(answer) : [];
  if (missing.length > 0) {
    const text = `insufficient_scope: missing ${missing.join(', ')}`;
    return {
      ...errorResult(text, { errors: { scope: `missing ${missing.join(', ')}` }, status }),
      _meta: { bffless: { status } },
    };
  }
  const code = str(error.code) ?? str(b.code) ?? str(b.error as unknown) ?? `HTTP_${status}`;
  const message =
    str(error.message) ??
    str(b.message) ??
    str(typeof body === 'string' ? body : undefined) ??
    `${toolName} failed with status ${status}`;
  const text = `${code}: ${message}`;
  return {
    ...errorResult(text, { errors: { pipeline: text }, status }),
    _meta: { bffless: { status } },
  };
}

export function invokeFailureResult(
  failure: InvokeFailure,
  toolName: string,
  path: string,
): CallToolResultLike {
  switch (failure.kind) {
    case 'no_rule':
      return errorResult(`${toolName} is declared but no rule answers ${path}`, {
        errors: { tool: `no rule answers ${path}` },
      });
    case 'unsupported':
      return errorResult(
        `${toolName} maps to a ${failure.proxyType} rule, which a tool cannot invoke`,
        {
          errors: { tool: `unsupported rule type ${failure.proxyType}` },
        },
      );
    case 'recursion':
      return errorResult(`${toolName} would invoke another MCP server (MCP_RECURSION)`, {
        errors: { tool: 'MCP_RECURSION' },
      });
    default:
      return errorResult(`${toolName} failed: ${failure.message}`, {
        errors: { tool: failure.message },
      });
  }
}
