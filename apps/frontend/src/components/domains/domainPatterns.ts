/**
 * Shared domain-format patterns for the domain mapping form.
 *
 * Keep in sync with the backend copy at
 * `apps/backend/src/domains/dto/domain-patterns.ts` — the two apps have no shared
 * package, so a change here needs the same change there or the form will accept
 * values the API rejects (or block ones it would allow).
 */

/** A plain hostname: `example.com`, `docs.example.com`, `localhost`. */
export const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * A hostname that may carry a leading `*.` wildcard label: `*.example.com`.
 *
 * Valid for a *source* domain, which becomes an nginx `server_name` and so can
 * legitimately match every subdomain. Deliberately NOT used for redirect targets —
 * a wildcard has no meaning in a `Location:` header.
 */
export const SOURCE_DOMAIN_PATTERN =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** A single subdomain label, no dots: `docs`. */
export const SUBDOMAIN_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
