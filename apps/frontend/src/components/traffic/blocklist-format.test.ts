import { describe, it, expect } from 'vitest';
import { parsePatternLines, formatPatternEntries } from './blocklist-format';

describe('blocklist textarea format', () => {
  it('parses bare lines as prefix patterns', () => {
    expect(parsePatternLines('/wp-login\n/hidden-probe')).toEqual([
      { matchType: 'prefix', value: '/wp-login' },
      { matchType: 'prefix', value: '/hidden-probe' },
    ]);
  });

  it('parses matchType tags case-insensitively', () => {
    expect(
      parsePatternLines('exact:/status\nSUFFIX:.tar.bz2\nextension:php\ncontains:phpunit'),
    ).toEqual([
      { matchType: 'exact', value: '/status' },
      { matchType: 'suffix', value: '.tar.bz2' },
      { matchType: 'extension', value: 'php' },
      { matchType: 'contains', value: 'phpunit' },
    ]);
  });

  it('skips blank lines and # comments', () => {
    expect(parsePatternLines('# scanners\n\n/probe\n   \n# done')).toEqual([
      { matchType: 'prefix', value: '/probe' },
    ]);
  });

  it('keeps a path containing a colon as a prefix pattern (only known tags parse)', () => {
    expect(parsePatternLines('/weird:path')).toEqual([
      { matchType: 'prefix', value: '/weird:path' },
    ]);
  });

  it('round-trips through formatPatternEntries', () => {
    const text = '/wp-login\nexact:/status\nextension:php';
    expect(formatPatternEntries(parsePatternLines(text))).toBe(text);
  });
});
