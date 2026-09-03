import { createHash, timingSafeEqual } from 'crypto';

/** RFC 7636 §4.1: 43–128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidVerifier(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && VERIFIER.test(verifier);
}

/** base64url(sha256(verifier)) — the only method OAuth 2.1 allows. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Timing-safe `challengeOf(verifier) === challenge`. */
export function verifyS256(verifier: string, challenge: string): boolean {
  const expected = Buffer.from(challengeOf(verifier), 'utf8');
  const given = Buffer.from(String(challenge), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
