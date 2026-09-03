/**
 * The JSON-RPC 2.0 envelope of a stateless Streamable-HTTP MCP server: one
 * message per POST, one body per answer — no batches (the profile answers one
 * message), no SSE, no session id. Owned by CE's `mcp_handler`; the shape the
 * Workflow harness's prototype endpoint proved against claude.ai (apps#554).
 */

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const LATEST_PROTOCOL_VERSION: string = PROTOCOL_VERSIONS[0];

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  /** `resources/read` of a URI the server does not serve (MCP's own code). */
  RESOURCE_NOT_FOUND: -32002,
} as const;

export type Id = string | number | null;

export type Message =
  | { kind: 'request'; id: Id; method: string; params: Record<string, unknown> }
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  | { kind: 'invalid'; id: Id; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function idOf(value: unknown): Id {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

/**
 * One JSON-RPC 2.0 message from a request body. A batch (an array) is
 * `invalid`, as is anything without `jsonrpc: "2.0"` and a string `method`.
 * A message without an `id` is a notification (answered 202, nothing else).
 */
export function parseMessage(body: unknown): Message {
  if (Array.isArray(body)) {
    return {
      kind: 'invalid',
      id: null,
      message: 'Batches are not accepted: POST one JSON-RPC message',
    };
  }
  if (!isPlainObject(body)) {
    return { kind: 'invalid', id: null, message: 'The body must be one JSON-RPC 2.0 object' };
  }
  const id = idOf(body.id);
  if (body.jsonrpc !== '2.0') return { kind: 'invalid', id, message: 'jsonrpc must be "2.0"' };
  if (typeof body.method !== 'string' || body.method === '') {
    return { kind: 'invalid', id, message: 'method must be a string' };
  }
  const params = isPlainObject(body.params) ? body.params : {};
  if (!Object.prototype.hasOwnProperty.call(body, 'id') || body.id === undefined) {
    return { kind: 'notification', method: body.method, params };
  }
  return { kind: 'request', id, method: body.method, params };
}

export function okResponse(id: Id, result: unknown): { jsonrpc: '2.0'; id: Id; result: unknown } {
  return { jsonrpc: '2.0', id, result };
}

export function errorResponse(
  id: Id,
  code: number,
  message: string,
  data?: unknown,
): { jsonrpc: '2.0'; id: Id; error: { code: number; message: string; data?: unknown } } {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** The version to answer `initialize` with: the client's when we speak it, else our newest. */
export function negotiateVersion(requested: unknown, supported: readonly string[]): string {
  return typeof requested === 'string' && supported.includes(requested) ? requested : supported[0];
}
