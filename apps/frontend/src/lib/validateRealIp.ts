/**
 * Client-side mirror of the backend's proxy-path realIp validation
 * (apps/backend/src/setup/bootstrap-setup.service.ts `validateApplyConfig` /
 * `isValidCidr`, and the shared `SHELL_SAFE_HEADER_RE` from
 * apps/backend/src/bootstrap/instance-config.ts).
 *
 * Runs in the bootstrap wizard's PasteCertificateForm so a bad CIDR or an
 * unsafe header is caught inline, before the wizard's later Apply step
 * (which enforces the same rules server-side and has no Back button on
 * failure — a 400 there is a dead end recoverable only by reloading).
 *
 * Kept intentionally in lockstep with the backend rules: any change to
 * isValidCidr/SHELL_SAFE_HEADER_RE there should be mirrored here too.
 */

// Same character set as backend SHELL_SAFE_HEADER_RE — narrower than RFC
// 9110's tchar grammar, excluding shell-dangerous characters ($, `, &, |).
export const SHELL_SAFE_HEADER_RE = /^[A-Za-z0-9!#*+.^_~-]+$/;

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isValidIPv4(addr: string): boolean {
  return IPV4_RE.test(addr);
}

const HEXTET_RE = /^[0-9a-fA-F]{1,4}$/;

function isValidIPv6(addr: string): boolean {
  // Keep this focused on plain IPv6 literals — IPv4-mapped forms
  // (::ffff:1.2.3.4) aren't a realistic CDN egress-range input here.
  if (addr === '' || addr.includes('.')) return false;

  const doubleColonCount = (addr.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  if (doubleColonCount === 1) {
    const [head, tail] = addr.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    const tailGroups = tail === '' ? [] : tail.split(':');
    const groups = [...headGroups, ...tailGroups];
    // "::" must compress at least one group, so the explicit groups must
    // leave room for it (max 7 of the 8 total groups explicit).
    if (groups.length > 7) return false;
    return groups.every((g) => HEXTET_RE.test(g));
  }

  const groups = addr.split(':');
  return groups.length === 8 && groups.every((g) => HEXTET_RE.test(g));
}

function ipFamily(addr: string): 4 | 6 | 0 {
  if (isValidIPv4(addr)) return 4;
  if (isValidIPv6(addr)) return 6;
  return 0;
}

/** Mirrors bootstrap-setup.service.ts's private isValidCidr. */
export function isValidCidr(range: string): boolean {
  const parts = range.split('/');
  if (parts.length !== 2) return false;
  const [addr, prefixStr] = parts;
  const family = ipFamily(addr);
  if (family === 0) return false;
  if (!/^\d{1,3}$/.test(prefixStr)) return false;
  const prefix = parseInt(prefixStr, 10);
  return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
}

export interface RealIpValidationResult {
  ranges: string[];
  header: string;
  rangesError: string | null;
  headerError: string | null;
}

/**
 * Validates the raw ranges textarea + header input the same way the backend
 * will at Apply time. `rangesText` empty means "no custom trust list" — the
 * caller should treat that as valid and skip both fields (mirrors the
 * existing setBootstrapRealIp(null) behavior), so this function is only
 * meant to be called when rangesText is non-empty.
 */
export function validateRealIp(rangesText: string, headerText: string): RealIpValidationResult {
  const ranges = rangesText
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  const header = headerText.trim() || 'X-Forwarded-For';

  const badRange = ranges.find((r) => !isValidCidr(r));
  const rangesError = badRange ? `Invalid CIDR range: ${badRange}` : null;
  const headerError = SHELL_SAFE_HEADER_RE.test(header)
    ? null
    : 'Real-IP header must be a valid HTTP header name';

  return { ranges, header, rangesError, headerError };
}
