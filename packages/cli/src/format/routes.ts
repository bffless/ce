/**
 * Bidirectional mapping between proxy-rule pathPatterns (e.g. `/api/auth/*`) and authoring-layout
 * filesystem segments (e.g. `['api', 'auth', '[...path]']`), plus deterministic specificity
 * ordering used by the compiler (Task 6) and decompiler (Task 7).
 */

/** Authoring-layout method stems (filenames `<stem>.rule.yaml` / directories `<stem>/rule.yaml`).
 *  Shared with the compiler (Task 6) so the stem list has exactly one definition. */
export const METHOD_STEMS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'any']);
const LITERAL_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SPREAD_SEGMENT_RE = /^\[\.\.\..*\]$/;
const BRACKET_SEGMENT_RE = /^\[.*\]$/;

/** A literal segment reserved for filesystem/route-authoring conventions; cannot map to a same-named directory. */
function isReservedSegment(segment: string): boolean {
  if (segment === 'rules') return true;
  if (METHOD_STEMS.has(segment)) return true;
  if (segment.startsWith('[') || segment.startsWith('_')) return true;
  return false;
}

/**
 * Filesystem segments for a pathPattern, or `null` when the pattern is inexpressible as a
 * directory layout (partial-segment globs, unsafe/bracket chars, reserved literal segments,
 * a pattern that doesn't start with `/`, etc).
 */
export function patternToRelPath(pattern: string): string[] | null {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return null;

  const rawSegments = pattern.split('/').slice(1);
  if (rawSegments.length === 0) return null;

  const out: string[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const isLast = i === rawSegments.length - 1;

    if (seg === '*') {
      out.push(isLast ? '[...path]' : `[p${i}]`);
      continue;
    }

    if (LITERAL_SEGMENT_RE.test(seg) && !isReservedSegment(seg)) {
      out.push(seg);
      continue;
    }

    return null;
  }

  return out;
}

/**
 * Exact inverse of `patternToRelPath`: `[...anything]` and `[anything]` both become `*` in their
 * position; literal segments pass through unchanged. `relPathToPattern(patternToRelPath(p)!) === p`
 * holds for every expressible `p`.
 */
export function relPathToPattern(segments: string[]): string {
  const parts = segments.map((seg) => {
    if (SPREAD_SEGMENT_RE.test(seg)) return '*';
    if (BRACKET_SEGMENT_RE.test(seg)) return '*';
    return seg;
  });
  return '/' + parts.join('/');
}

interface SpecificityKey {
  literalCount: number;
  wildcardCount: number;
  wildcardIndices: number[];
  pathPattern: string;
  methodKey: string;
}

/** Segments of a raw pathPattern for specificity purposes: leading '/' dropped, no expressibility check. */
function rawSegmentsOf(pattern: string): string[] {
  if (pattern.startsWith('/')) return pattern.split('/').slice(1);
  return pattern.split('/');
}

function specificityKeyOf<T extends { pathPattern: string; method?: string }>(rule: T): SpecificityKey {
  const segs = rawSegmentsOf(rule.pathPattern);
  let literalCount = 0;
  const wildcardIndices: number[] = [];
  segs.forEach((seg, i) => {
    if (seg === '*') wildcardIndices.push(i);
    else literalCount++;
  });
  return {
    literalCount,
    wildcardCount: wildcardIndices.length,
    wildcardIndices,
    pathPattern: rule.pathPattern,
    methodKey: rule.method ?? '~',
  };
}

function compareSpecificityKeys(a: SpecificityKey, b: SpecificityKey): number {
  // More literal segments first.
  if (a.literalCount !== b.literalCount) return b.literalCount - a.literalCount;
  // Among equal literal-segment counts, fewer wildcards first.
  if (a.wildcardCount !== b.wildcardCount) return a.wildcardCount - b.wildcardCount;
  // Among equal literal/wildcard counts, a wildcard occurring later in the path is more specific.
  const len = Math.max(a.wildcardIndices.length, b.wildcardIndices.length);
  for (let i = 0; i < len; i++) {
    const ai = a.wildcardIndices[i] ?? -1;
    const bi = b.wildcardIndices[i] ?? -1;
    if (ai !== bi) return bi - ai;
  }
  if (a.pathPattern !== b.pathPattern) return a.pathPattern < b.pathPattern ? -1 : 1;
  if (a.methodKey !== b.methodKey) return a.methodKey < b.methodKey ? -1 : 1;
  return 0;
}

/**
 * Stable, deterministic specificity ordering: more literal segments first; among ties, fewer
 * wildcards first; among ties, a later wildcard position first; then pathPattern lexicographic;
 * then method (methodless sorts last). Does not mutate the input array.
 */
export function sortRulesBySpecificity<T extends { pathPattern: string; method?: string }>(rules: T[]): T[] {
  return [...rules]
    .map((rule, index) => ({ rule, index, key: specificityKeyOf(rule) }))
    .sort((a, b) => compareSpecificityKeys(a.key, b.key) || a.index - b.index)
    .map((entry) => entry.rule);
}

/**
 * 0-based position of each rule in the specificity sort. The compiler uses this when a manifest
 * has no explicit `order:`; the decompiler elides `order:` exactly when the stored value equals
 * the derived one.
 */
export function deriveOrders<T extends { pathPattern: string; method?: string }>(rules: T[]): Map<T, number> {
  const sorted = sortRulesBySpecificity(rules);
  const map = new Map<T, number>();
  sorted.forEach((rule, position) => map.set(rule, position));
  return map;
}
