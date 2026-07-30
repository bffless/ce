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

function canonicalString({ key, exp, max }: LocalPresignParams): string {
  return `${key}|${exp}|${max}`;
}

export function signLocalUpload(params: LocalPresignParams, presignKey: Buffer): string {
  return createHmac('sha256', presignKey).update(canonicalString(params)).digest('hex');
}

export function verifyLocalUpload(
  params: LocalPresignParams,
  sig: string,
  presignKey: Buffer,
): boolean {
  const expected = signLocalUpload(params, presignKey);
  // timingSafeEqual throws on length mismatch, so guard before comparing.
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
