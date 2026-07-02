/**
 * The Blocklist compiler (issue #391, ADR-0002): the ONLY code that turns
 * admin-supplied blocklist patterns into matching rules.
 *
 * Patterns are stored structured as { matchType, value } — never as raw regex.
 * The compiler validates each value against a strict path charset, escapes
 * every regex metacharacter, and assembles anchored regex sources. Admin input
 * can therefore only widen the *blocked set*; it can never inject regex
 * syntax — and, when #392 feeds these same sources into generated nginx
 * `location ~*` rules, never emit an nginx directive.
 *
 * Everything in this file is a pure function (Seam 2 of the testing plan):
 * no I/O, no Nest, no database.
 */

export type BlocklistMatchType = 'prefix' | 'exact' | 'suffix' | 'extension' | 'contains';

export const BLOCKLIST_MATCH_TYPES: BlocklistMatchType[] = [
  'prefix',
  'exact',
  'suffix',
  'extension',
  'contains',
];

/** A structured blocklist pattern, as stored in blocklist_entries. */
export interface BlocklistPatternEntry {
  matchType: BlocklistMatchType;
  value: string;
}

export const BLOCKLIST_VALUE_MAX_LENGTH = 256;

/**
 * The strict charset admin-supplied values must stay inside. Deliberately a
 * whitelist: everything nginx or PCRE could treat as syntax (`{ } ; $ " \`,
 * whitespace, newlines, ...) is simply not representable. Metacharacters that
 * ARE allowed (`. ( ) * + ? [ ]` etc. appear in real paths) get escaped by the
 * compiler.
 */
const VALUE_CHARSET = /^[A-Za-z0-9/._~%+=:@!,()*&[\]-]+$/;

/**
 * Validate a pattern value. Returns an error message, or null if valid.
 */
export function validateBlocklistValue(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Pattern is empty';
  }
  if (value.length > BLOCKLIST_VALUE_MAX_LENGTH) {
    return `Pattern is longer than ${BLOCKLIST_VALUE_MAX_LENGTH} characters`;
  }
  if (!VALUE_CHARSET.test(value)) {
    return 'Pattern contains unsupported characters (allowed: letters, digits, and / . _ - ~ % + = : @ ! , ( ) * & [ ])';
  }
  return null;
}

/** Escape every regex metacharacter so the value matches only literally. */
export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile one structured entry into an (unanchored-on-the-outside) regex
 * source. Anchoring is what gives each matchType its meaning:
 *
 *   prefix    /wp-admin   -> ^/wp\-admin        (nginx `~*^/wp-admin`)
 *   exact     /~          -> ^/~$
 *   suffix    .sql.gz     -> \.sql\.gz$
 *   extension php         -> \.php$             (leading dot implied)
 *   contains  phpunit     -> phpunit
 *
 * Throws on an invalid value — callers must have validated already; an
 * exception here means a bug upstream, not bad user input.
 */
export function compileEntryPattern(entry: BlocklistPatternEntry): string {
  const error = validateBlocklistValue(entry.value);
  if (error) {
    throw new Error(`Invalid blocklist pattern "${entry.value}": ${error}`);
  }

  switch (entry.matchType) {
    case 'prefix':
      return `^${escapeRegexLiteral(entry.value)}`;
    case 'exact':
      return `^${escapeRegexLiteral(entry.value)}$`;
    case 'suffix':
      return `${escapeRegexLiteral(entry.value)}$`;
    case 'extension': {
      // Accept "php" and ".php" identically; the dot is part of the semantics.
      const bare = entry.value.startsWith('.') ? entry.value.slice(1) : entry.value;
      if (bare.length === 0) {
        throw new Error(`Invalid blocklist pattern "${entry.value}": extension is empty`);
      }
      return `\\.${escapeRegexLiteral(bare)}$`;
    }
    case 'contains':
      return escapeRegexLiteral(entry.value);
    default:
      throw new Error(`Unknown blocklist matchType "${String(entry.matchType)}"`);
  }
}

/**
 * Combine entries into a single alternation regex source, or null when there
 * are no entries. The source is valid both as a JS RegExp (app-side
 * enforcement, case-insensitive flag) and as a PCRE for nginx `location ~*`
 * (edge enforcement, #392).
 */
export function compileBlocklistRegexSource(entries: BlocklistPatternEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  return `(?:${entries.map(compileEntryPattern).join('|')})`;
}

/** A compiled, ready-to-enforce matcher over request paths. */
export interface CompiledBlocklistMatcher {
  /**
   * Decide whether a request path is blocked. `pathname` is the client-visible
   * path WITHOUT the query string. Matching is case-insensitive (nginx `~*`
   * parity) and also considers the percent-decoded form, so `/%2e%65nv`
   * cannot sneak past a `/.env` pattern. Allow entries always win.
   */
  isBlocked(pathname: string): boolean;
  /** Combined block regex source (null = nothing to block). */
  blockSource: string | null;
  /** Combined allow regex source (null = no exceptions). */
  allowSource: string | null;
}

/**
 * Build the effective matcher from block entries (Baseline + lists) and allow
 * entries (every list's exceptions). Allowlist entries take precedence over
 * ALL block entries — that is the false-positive rescue that lets an admin
 * exempt a path without forking the Baseline.
 */
export function buildBlocklistMatcher(
  blockEntries: BlocklistPatternEntry[],
  allowEntries: BlocklistPatternEntry[],
): CompiledBlocklistMatcher {
  const blockSource = compileBlocklistRegexSource(blockEntries);
  const allowSource = compileBlocklistRegexSource(allowEntries);
  const blockRegex = blockSource ? new RegExp(blockSource, 'i') : null;
  const allowRegex = allowSource ? new RegExp(allowSource, 'i') : null;

  return {
    blockSource,
    allowSource,
    isBlocked(pathname: string): boolean {
      if (!blockRegex) {
        return false;
      }
      const candidates = [pathname];
      try {
        const decoded = decodeURIComponent(pathname);
        if (decoded !== pathname) {
          candidates.push(decoded);
        }
      } catch {
        // Malformed percent-encoding: match on the raw path only.
      }
      // An allow match on ANY interpretation of the path rescues the request.
      if (allowRegex && candidates.some((c) => allowRegex.test(c))) {
        return false;
      }
      return candidates.some((c) => blockRegex.test(c));
    },
  };
}
