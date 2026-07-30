import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Domain-separation label. Distinct from function-runner's 'pipeline-fn-sign'. */
export const PRESIGN_DOMAIN_LABEL = 'local-presign-v1';

/** Default per-upload size ceiling (100 MB), matching nginx's client_max_body_size. */
export const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600;

/** Expiry ceiling in seconds. Matches the 3600 default of the bucket adapters. */
export const MAX_EXPIRES_IN_SECONDS = 3600;

export interface LocalPresignParams {
  key: string;
  exp: number;
  max: number;
}

/**
 * Derive the presign key. Mirrors function-runner.service.ts:126-137 — a
 * dedicated env var when set, otherwise the required, stable ENCRYPTION_KEY, so
 * signatures survive restarts with no extra configuration.
 */
export function derivePresignKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const base =
    env.LOCAL_PRESIGN_SECRET || env.ENCRYPTION_KEY || 'bffless-local-presign-dev-secret';
  return createHash('sha256').update(`${base}|${PRESIGN_DOMAIN_LABEL}`).digest();
}

/**
 * Resolve the origin presigned URLs are minted against.
 *
 * Throws when it cannot be resolved. That is deliberate: silently defaulting to
 * localhost would mint unusable URLs that look like a broken client rather than
 * a misconfigured server (see the adapter's vestigial `baseUrl`).
 */
export function resolvePublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PUBLIC_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const domain = env.PRIMARY_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/\/+$/, '')}`;

  throw new Error(
    'Cannot resolve a public origin for presigned local uploads: set PUBLIC_ORIGIN or PRIMARY_DOMAIN.',
  );
}

/**
 * Origin resolution for construction sites that must not fail boot. Returns
 * undefined instead of throwing; the adapter then reports no presigned support.
 */
export function tryResolvePublicOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    return resolvePublicOrigin(env);
  } catch {
    return undefined;
  }
}

/**
 * Build the canonical string for signing.
 *
 * CRITICAL INVARIANT: This signature scheme is collision-free ONLY because `exp`
 * and `max` are numbers. A JavaScript number's template-literal stringification
 * can never contain the `|` delimiter. If either param were coerced from a string
 * without validation, an attacker could inject `|` into the `key` to shift where
 * `exp` and `max` are parsed and forge a single signature for multiple triples.
 *
 * Callers MUST:
 * - Coerce query-string `exp` and `max` to numbers via `Number()` or `parseInt()`
 * - Validate that both are finite (`Number.isFinite()`)
 * - Never pass raw string parameters directly
 *
 * Changing the delimiter scheme or accepting string params would break this
 * invariant and enable delimiter injection attacks.
 */
function canonicalString({ key, exp, max }: LocalPresignParams): string {
  return `${key}|${exp}|${max}`;
}

export function signLocalUpload(params: LocalPresignParams, presignKey: Buffer): string {
  // Enforce the canonicalization invariant: exp and max must be finite numbers.
  // See canonicalString() for why this is load-bearing.
  if (typeof params.exp !== 'number' || !Number.isFinite(params.exp)) {
    throw new TypeError(`exp must be a finite number, got ${typeof params.exp}`);
  }
  if (typeof params.max !== 'number' || !Number.isFinite(params.max)) {
    throw new TypeError(`max must be a finite number, got ${typeof params.max}`);
  }
  return createHmac('sha256', presignKey).update(canonicalString(params)).digest('hex');
}

export function verifyLocalUpload(
  params: LocalPresignParams,
  sig: string,
  presignKey: Buffer,
): boolean {
  // Enforce the canonicalization invariant: exp and max must be finite numbers.
  // See canonicalString() for why this is load-bearing.
  if (typeof params.exp !== 'number' || !Number.isFinite(params.exp)) {
    throw new TypeError(`exp must be a finite number, got ${typeof params.exp}`);
  }
  if (typeof params.max !== 'number' || !Number.isFinite(params.max)) {
    throw new TypeError(`max must be a finite number, got ${typeof params.max}`);
  }
  const expected = signLocalUpload(params, presignKey);
  // timingSafeEqual throws on length mismatch, so guard before comparing.
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
