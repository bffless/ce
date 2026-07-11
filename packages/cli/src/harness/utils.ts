import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID as nodeRandomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Crypto helpers exposed to pipeline function handlers as the global `utils`
 * (also passed on the handler argument, so both `utils.sign(...)` and
 * `function handler({ utils }) { ... }` work).
 *
 * Mirrors `PipelineFunctionUtils` in the CE runtime
 * (apps/backend/src/pipelines/function-runner.service.ts, ~22-176). All helpers
 * are pure `string -> string | boolean`, coerce inputs with `String()`, and
 * never throw on bad input.
 */
export interface HandlerUtils {
  /** Lowercase hex SHA-256 of `message`. */
  sha256(message: string): string;
  /** Lowercase hex HMAC-SHA256 of `message` with the caller-supplied `key`. */
  hmacSha256(message: string, key: string): string;
  /** Hex HMAC-SHA256 of `message` using the harness signing key. */
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

/**
 * Default signing base for the harness. The runtime derives its key from
 * `PIPELINE_SIGNING_SECRET`/`ENCRYPTION_KEY`; those are server-held and are NOT
 * available offline, so the harness substitutes a fixed default. Signatures are
 * therefore self-consistent (sign/verify round-trip) but do NOT match a live
 * server unless the same `signingSecret` is supplied.
 */
const DEFAULT_HARNESS_SECRET = 'bffless-harness-secret';

/**
 * Derive the signing key exactly as the runtime does (`getSigningKey`, ~127-138):
 * sha256(`${base}|pipeline-fn-sign`). Never exposed to the sandbox.
 */
function deriveSigningKey(base: string): Buffer {
  return createHash('sha256').update(`${base}|pipeline-fn-sign`).digest();
}

/**
 * Build the `utils` crypto bag injected into every handler sandbox.
 *
 * @param signingSecret - Base secret keying `sign`/`verify`
 *   (defaults to {@link DEFAULT_HARNESS_SECRET}).
 */
export function createUtils(signingSecret?: string): HandlerUtils {
  const signingKey = deriveSigningKey(signingSecret ?? DEFAULT_HARNESS_SECRET);

  const hmacHex = (message: string, key: Buffer | string): string =>
    createHmac('sha256', key).update(String(message)).digest('hex');

  return {
    sha256: (message) =>
      createHash('sha256').update(String(message)).digest('hex'),
    hmacSha256: (message, key) => hmacHex(message, String(key)),
    sign: (message) => hmacHex(message, signingKey),
    verify: (message, signature) => {
      const expected = hmacHex(message, signingKey);
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(String(signature), 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    },
    randomToken: (bytes = 18) => {
      const n = Math.min(Math.max(Math.floor(Number(bytes) || 18), 1), 64);
      return randomBytes(n).toString('hex');
    },
    randomUUID: () => nodeRandomUUID(),
    base64urlEncode: (value) =>
      Buffer.from(String(value), 'utf8').toString('base64url'),
    base64urlDecode: (value) => {
      try {
        return Buffer.from(String(value), 'base64url').toString('utf8');
      } catch {
        return '';
      }
    },
  };
}
