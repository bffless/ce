/**
 * Shared domain-format patterns for domain mapping DTOs.
 *
 * Keep in sync with the frontend copy at
 * `apps/frontend/src/components/domains/domainPatterns.ts` — the two apps have no
 * shared package, so a change here needs the same change there or the form and the
 * API will disagree about what a valid domain looks like.
 */

/** A plain hostname: `example.com`, `docs.example.com`, `localhost`. */
export const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * A hostname that may carry a leading `*.` wildcard label: `*.example.com`.
 *
 * Valid for a *source* domain, which becomes an nginx `server_name` and so can
 * legitimately match every subdomain (e.g. redirecting all of `*.old-brand.com`).
 * Deliberately NOT used for redirect targets — a wildcard has no meaning in a
 * `Location:` header, so targets keep HOSTNAME_PATTERN.
 *
 * Only a single leading `*.` is accepted; nginx does not support wildcards in the
 * middle of a name (`foo.*.example.com`) or a bare `*`.
 */
export const SOURCE_DOMAIN_PATTERN =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export const INVALID_DOMAIN_MESSAGE =
  'Invalid domain format. Use a hostname like example.com, optionally with a leading *. wildcard (e.g. *.example.com)';

export const INVALID_REDIRECT_TARGET_MESSAGE =
  'Invalid redirect target domain format. Use a hostname like example.com (wildcards are not allowed in a redirect target)';
