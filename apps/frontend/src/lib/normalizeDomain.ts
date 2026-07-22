// The bootstrap wizard wants a bare apex hostname (e.g. `example.com`): the
// backend interpolates it into cert filenames and derives `admin.`/`www.` from
// it. Users routinely paste `https://www.example.com/`, `Example.com.`, or
// `example.com:443`, which the backend's stricter hostname check would reject
// with an opaque 400. We clean the common mistakes client-side and validate
// what's left, so the guidance is inline on the domain field instead.

// Mirrors the backend HOSTNAME_RE (bootstrap-setup.service.ts), lowercase-only
// since normalizeDomain lowercases first: 2+ labels, RFC-1035 label/length rules.
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Strip scheme, path/query/fragment, port, trailing dot, and a leading `www.`. */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme (https://, http://)
    .replace(/[/?#].*$/, '') // path / query / fragment
    .replace(/:\d+$/, '') // :port
    .replace(/\.$/, '') // trailing FQDN dot
    .replace(/^www\./, ''); // leading www.
}

/**
 * Validation message for an already-normalized domain, or null when it's a
 * plausible apex. Empty input returns null (it's "not entered yet", not an
 * error) — callers gate the Next button on non-empty separately.
 */
export function domainError(normalized: string): string | null {
  if (!normalized) return null;
  if (!HOSTNAME_RE.test(normalized)) {
    return 'Enter a root domain like example.com — no https://, no path, no www.';
  }
  return null;
}
