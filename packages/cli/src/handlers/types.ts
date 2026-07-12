/**
 * Author-facing types for `.fn.ts` handler files (published under the `bffless/handlers`
 * subpath export). These mirror the shapes the harness passes into a handler at runtime
 * (`src/harness/run-handler.ts` `HandlerData`, `src/harness/utils.ts` `HandlerUtils`) so
 * authors get type-checked `ctx` parameters without importing internal harness modules.
 *
 * `HandlerUtils` signatures are copied EXACTLY from `src/harness/utils.ts` — that file is
 * the source of truth; this is a author-facing re-declaration, not an independent contract.
 */

/** Crypto helpers exposed to a handler as `ctx.utils` (mirrors `harness/utils.ts` `HandlerUtils`). */
export interface HandlerUtils {
  /** Lowercase hex SHA-256 of `message`. */
  sha256(message: string): string;
  /** Lowercase hex HMAC-SHA256 of `message` with the caller-supplied `key`. */
  hmacSha256(message: string, key: string): string;
  /** Hex HMAC-SHA256 of `message` using the harness/runtime signing key. */
  sign(message: string): string;
  /** Timing-safe check that `signature` matches `sign(message)`. */
  verify(message: string, signature: string): boolean;
  /** Crypto-strong random hex token of `bytes` length (default 18 -> 36 hex chars). */
  randomToken(bytes?: number): string;
  /** RFC4122 v4 UUID. */
  randomUUID(): string;
  /** Base64url-encode a UTF-8 string (no padding). */
  base64urlEncode(value: string): string;
  /** Decode a base64url string back to a UTF-8 string ('' on malformed input). */
  base64urlDecode(value: string): string;
}

/** Inbound HTTP request data available to a handler. */
export interface HandlerRequest {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * The single argument passed to a `.fn.ts` handler. Mirrors `HandlerData` (harness) /
 * the `data` object the CE runtime spreads into a pipeline function step, plus `utils`.
 */
export interface HandlerContext {
  user?: Record<string, unknown>;
  request?: HandlerRequest;
  steps?: Record<string, unknown>;
  deployment?: Record<string, unknown>;
  utils: HandlerUtils;
}

/** A `.fn.ts` entry must export a function matching this shape, as `default` or `handler`. */
export type Handler = (ctx: HandlerContext) => unknown;
