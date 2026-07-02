import type { BlocklistMatchType, BlocklistPatternEntry } from '@/services/trafficApi';

/**
 * The textarea sugar over the structured Blocklist pattern model (issue #391).
 *
 * One pattern per line. A bare line is a prefix match (the common case for
 * scanner paths); the other match types are written as an explicit
 * `matchType:value` tag:
 *
 *   /wp-login              -> { matchType: 'prefix',    value: '/wp-login' }
 *   exact:/status          -> { matchType: 'exact',     value: '/status' }
 *   suffix:.sql.gz         -> { matchType: 'suffix',    value: '.sql.gz' }
 *   extension:php          -> { matchType: 'extension', value: 'php' }
 *   contains:phpunit       -> { matchType: 'contains',  value: 'phpunit' }
 *
 * Blank lines and `#` comments are ignored. Parsing is intentionally lax —
 * the backend re-validates every value against the strict charset and
 * returns per-pattern errors.
 */

const MATCH_TYPES: BlocklistMatchType[] = ['prefix', 'exact', 'suffix', 'extension', 'contains'];

const TAGGED_LINE = new RegExp(`^(${MATCH_TYPES.join('|')}):(.*)$`, 'i');

export function parsePatternLines(text: string): BlocklistPatternEntry[] {
  const entries: BlocklistPatternEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const tagged = TAGGED_LINE.exec(line);
    if (tagged) {
      entries.push({
        matchType: tagged[1].toLowerCase() as BlocklistMatchType,
        value: tagged[2].trim(),
      });
    } else {
      entries.push({ matchType: 'prefix', value: line });
    }
  }
  return entries;
}

export function formatPatternEntries(entries: BlocklistPatternEntry[]): string {
  return entries
    .map((entry) => (entry.matchType === 'prefix' ? entry.value : `${entry.matchType}:${entry.value}`))
    .join('\n');
}
