import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Domain-separation label. Distinct from function-runner's 'pipeline-fn-sign'. */
export const PRESIGN_DOMAIN_LABEL = 'local-presign-v1';

/**
 * Domain-separation label for the signed DOWNLOAD (GET) direction.
 *
 * Deliberately distinct from {@link PRESIGN_DOMAIN_LABEL}: it is mixed into a
 * separate HMAC key (see {@link deriveDownloadKey}) rather than into the signed
 * message, so an upload signature and a download signature can never satisfy
 * each other's verifier no matter how the signed fields line up.
 */
export const DOWNLOAD_PRESIGN_DOMAIN_LABEL = 'local-presign-dl-v1';

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
 * True when a real, install-specific presign secret is configured — either
 * `LOCAL_PRESIGN_SECRET` or the (normally mandatory) `ENCRYPTION_KEY`.
 *
 * `derivePresignKey` above deliberately never throws when neither is set: it
 * degrades to a hardcoded dev-fallback string so unit tests and other callers
 * that construct a key unconditionally never crash. But that fallback is a
 * PUBLIC CONSTANT baked into the source — if it's the only signing material
 * available, anyone can forge a valid upload signature for any key under
 * basePath. Callers that decide whether to ADVERTISE presigned-upload
 * support (i.e. `LocalStorageAdapter.supportsPresignedUrls`) must check this
 * and fail closed rather than silently offering forgeable auth.
 */
export function hasRealPresignSecret(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LOCAL_PRESIGN_SECRET?.trim() || env.ENCRYPTION_KEY?.trim());
}

/**
 * Read an EXPLICITLY configured public origin, if any. Consults ONLY
 * `PUBLIC_ORIGIN` -- never `PRIMARY_DOMAIN`.
 *
 * This function used to also fall back to `https://${PRIMARY_DOMAIN}` when
 * `PUBLIC_ORIGIN` was unset. That fallback was a bug: `PRIMARY_DOMAIN` is set
 * on every real CE install, so the "fallback" was never actually a fallback
 * -- it fired unconditionally in production, forcing every
 * `LocalStorageAdapter` construction site onto an absolute URL at the apex
 * domain. The apex has no dedicated nginx vhost that proxies `/api`
 * unrewritten (see `docs/superpowers/specs/2026-07-30-local-fs-presigned-uploads-design.md`,
 * section "Correction: upload URL routing"), so that URL was unreachable and
 * `getPresignedUploadUrl`'s relative-URL default (below) never actually ran.
 *
 * `publicOrigin` is an EXPLICIT override for callers that need an absolute
 * URL (e.g. a non-browser consumer with no page origin to resolve a relative
 * URL against) -- never an automatic guess derived from unrelated config
 * that happens to be set on every install.
 */
export function explicitPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.PUBLIC_ORIGIN?.trim();
  return explicit ? explicit.replace(/\/+$/, '') : undefined;
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

/**
 * Derive the DOWNLOAD signing key from the upload presign key.
 *
 * Domain separation is done at the KEY, not in the message. Prefixing the
 * signed string with a label would leave the two schemes sharing one HMAC key,
 * and both schemes contain attacker-influenceable variable-length fields (the
 * storage key is derived from pipeline config / request input) — so a crafted
 * key could make an upload canonical string byte-identical to a download one
 * and cross-authorize. A one-way, labelled re-hash makes that structurally
 * impossible instead of relying on the two canonical formats never colliding.
 *
 * Taking the upload key (rather than the environment) as input keeps this
 * working for the `presignKey`-injected construction sites too, which have no
 * `LOCAL_PRESIGN_SECRET`/`ENCRYPTION_KEY` of their own to derive from.
 */
export function deriveDownloadKey(presignKey: Buffer): Buffer {
  return createHash('sha256').update(presignKey).update(DOWNLOAD_PRESIGN_DOMAIN_LABEL).digest();
}

export interface LocalDownloadParams {
  key: string;
  exp: number;
  /** Optional filename to force `Content-Disposition: attachment` under. */
  dl?: string;
}

/**
 * Canonical string for the download direction.
 *
 * Both variable-length fields are base64url-encoded before joining. base64url's
 * alphabet excludes `|`, so no value of `key` or `dl` can shift where a field
 * boundary is read — the delimiter-injection hazard documented on
 * {@link canonicalString} above cannot occur here at all, rather than being
 * held off by validating the numeric field.
 */
function canonicalDownloadString({ key, exp, dl }: LocalDownloadParams): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64(key)}|${exp}|${b64(dl ?? '')}`;
}

export function signLocalDownload(params: LocalDownloadParams, downloadKey: Buffer): string {
  if (typeof params.exp !== 'number' || !Number.isFinite(params.exp)) {
    throw new TypeError(`exp must be a finite number, got ${typeof params.exp}`);
  }
  return createHmac('sha256', downloadKey).update(canonicalDownloadString(params)).digest('hex');
}

export function verifyLocalDownload(
  params: LocalDownloadParams,
  sig: string,
  downloadKey: Buffer,
): boolean {
  if (typeof params.exp !== 'number' || !Number.isFinite(params.exp)) {
    throw new TypeError(`exp must be a finite number, got ${typeof params.exp}`);
  }
  const expected = signLocalDownload(params, downloadKey);
  // timingSafeEqual throws on length mismatch, so guard before comparing.
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
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
