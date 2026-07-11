import { describe, it, expect } from 'vitest';
import { patternToRelPath, relPathToPattern, sortRulesBySpecificity, deriveOrders } from '../src/format/routes.js';

/** Real pathPatterns pulled from packages/cli/test/fixtures/real/*.json (Task 4 brief). */
const REAL_EXPRESSIBLE_PATTERNS = [
  '/api/auth/*',
  '/api/feeds/remove',
  '/api/feeds',
  '/api/items',
  '/api/items/read-all',
  '/r/*',
  '/api/resolve/*',
  '/feed.xml',
  '/feed/*',
  '/api/uploads/content/*',
  '/api/share-links/validate',
];

describe('patternToRelPath', () => {
  it.each(REAL_EXPRESSIBLE_PATTERNS)('maps real pattern %s to non-null segments', (p) => {
    expect(patternToRelPath(p)).not.toBeNull();
  });

  it('maps /api/auth/* to [api, auth, [...path]]', () => {
    expect(patternToRelPath('/api/auth/*')).toEqual(['api', 'auth', '[...path]']);
  });

  it('maps /api/feeds/remove to [api, feeds, remove]', () => {
    expect(patternToRelPath('/api/feeds/remove')).toEqual(['api', 'feeds', 'remove']);
  });

  it('maps /api/feeds to [api, feeds]', () => {
    expect(patternToRelPath('/api/feeds')).toEqual(['api', 'feeds']);
  });

  it('maps /api/items to [api, items]', () => {
    expect(patternToRelPath('/api/items')).toEqual(['api', 'items']);
  });

  it('maps /api/items/read-all to [api, items, read-all]', () => {
    expect(patternToRelPath('/api/items/read-all')).toEqual(['api', 'items', 'read-all']);
  });

  it('maps /r/* to [r, [...path]]', () => {
    expect(patternToRelPath('/r/*')).toEqual(['r', '[...path]']);
  });

  it('maps /api/resolve/* to [api, resolve, [...path]]', () => {
    expect(patternToRelPath('/api/resolve/*')).toEqual(['api', 'resolve', '[...path]']);
  });

  it('maps /feed.xml to [feed.xml] (dotted literal)', () => {
    expect(patternToRelPath('/feed.xml')).toEqual(['feed.xml']);
  });

  it('maps /feed/* to [feed, [...path]]', () => {
    expect(patternToRelPath('/feed/*')).toEqual(['feed', '[...path]']);
  });

  it('maps /api/uploads/content/* to [api, uploads, content, [...path]]', () => {
    expect(patternToRelPath('/api/uploads/content/*')).toEqual(['api', 'uploads', 'content', '[...path]']);
  });

  it('maps /api/share-links/validate to [api, share-links, validate] (hyphenated literal)', () => {
    expect(patternToRelPath('/api/share-links/validate')).toEqual(['api', 'share-links', 'validate']);
  });

  it('maps root wildcard /* to [[...path]]', () => {
    expect(patternToRelPath('/*')).toEqual(['[...path]']);
  });

  it('maps a non-last full-segment wildcard to [p<i>]', () => {
    expect(patternToRelPath('/api/*/x')).toEqual(['api', '[p1]', 'x']);
  });

  describe('inexpressible patterns -> null', () => {
    it('bracket chars: /api/v[1]/x', () => {
      expect(patternToRelPath('/api/v[1]/x')).toBeNull();
    });

    it('partial-segment glob: /api/*x', () => {
      expect(patternToRelPath('/api/*x')).toBeNull();
    });

    it('bare * (no leading slash)', () => {
      expect(patternToRelPath('*')).toBeNull();
    });

    it('contains %', () => {
      expect(patternToRelPath('/api/100%off')).toBeNull();
    });

    it('contains a space', () => {
      expect(patternToRelPath('/api/hello world')).toBeNull();
    });

    it('empty segment (double slash)', () => {
      expect(patternToRelPath('/api//x')).toBeNull();
    });

    it('reserved literal segment "rules"', () => {
      expect(patternToRelPath('/api/rules')).toBeNull();
    });

    it('reserved literal segment matching a method stem ("get")', () => {
      expect(patternToRelPath('/api/get')).toBeNull();
    });

    it.each(['post', 'put', 'patch', 'delete', 'head', 'options', 'any'])(
      'reserved literal segment matching method stem "%s"',
      (stem) => {
        expect(patternToRelPath(`/api/${stem}`)).toBeNull();
      },
    );
  });
});

describe('relPathToPattern / exact inverse', () => {
  it.each(REAL_EXPRESSIBLE_PATTERNS)('round-trips real pattern %s exactly', (p) => {
    const segs = patternToRelPath(p);
    expect(segs).not.toBeNull();
    expect(relPathToPattern(segs as string[])).toBe(p);
  });

  it('round-trips root wildcard /*', () => {
    const segs = patternToRelPath('/*');
    expect(relPathToPattern(segs as string[])).toBe('/*');
  });

  it('round-trips a non-last full-segment wildcard /api/*/x', () => {
    const segs = patternToRelPath('/api/*/x');
    expect(relPathToPattern(segs as string[])).toBe('/api/*/x');
  });

  it('round-trips /a/*/b/* exactly', () => {
    const segs = patternToRelPath('/a/*/b/*');
    expect(segs).toEqual(['a', '[p1]', 'b', '[...path]']);
    expect(relPathToPattern(segs as string[])).toBe('/a/*/b/*');
  });

  it('round-trips /*/x/*/y/* exactly', () => {
    const segs = patternToRelPath('/*/x/*/y/*');
    expect(segs).toEqual(['[p0]', 'x', '[p2]', 'y', '[...path]']);
    expect(relPathToPattern(segs as string[])).toBe('/*/x/*/y/*');
  });

  it('round-trips /*/* exactly', () => {
    const segs = patternToRelPath('/*/*');
    expect(segs).toEqual(['[p0]', '[...path]']);
    expect(relPathToPattern(segs as string[])).toBe('/*/*');
  });

  it('round-trips /a/*/*/b exactly', () => {
    const segs = patternToRelPath('/a/*/*/b');
    expect(segs).toEqual(['a', '[p1]', '[p2]', 'b']);
    expect(relPathToPattern(segs as string[])).toBe('/a/*/*/b');
  });

  it('converts a spread segment [...path] to a trailing *', () => {
    expect(relPathToPattern(['api', 'auth', '[...path]'])).toBe('/api/auth/*');
  });

  it('converts a bracketed non-spread segment [p1] to *', () => {
    expect(relPathToPattern(['api', '[p1]', 'x'])).toBe('/api/*/x');
  });

  it('leaves literal segments untouched', () => {
    expect(relPathToPattern(['api', 'feeds', 'remove'])).toBe('/api/feeds/remove');
  });
});

describe('sortRulesBySpecificity', () => {
  type Rule = { pathPattern: string; method?: string };

  it('specificity table: /api/feeds/remove < /api/feeds < /api/* < /*', () => {
    const rules: Rule[] = [
      { pathPattern: '/*' },
      { pathPattern: '/api/*' },
      { pathPattern: '/api/feeds' },
      { pathPattern: '/api/feeds/remove' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.pathPattern)).toEqual(['/api/feeds/remove', '/api/feeds', '/api/*', '/*']);
  });

  it('fewer wildcards first when literal-segment counts tie', () => {
    // Both have literalCount=2 ('api','x'); one has 0 wildcards, the other 1.
    const rules: Rule[] = [
      { pathPattern: '/api/x/*' },
      { pathPattern: '/api/x' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.pathPattern)).toEqual(['/api/x', '/api/x/*']);
  });

  it('wildcard-later-in-path sorts first when literal/wildcard counts tie', () => {
    // Both: literalCount=2 ('api','y'), wildcardCount=1, 3 segments total.
    // /api/*/y has its wildcard at index 1 (later); /*/api/y has its wildcard at index 0 (earlier).
    const rules: Rule[] = [
      { pathPattern: '/*/api/y' },
      { pathPattern: '/api/*/y' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.pathPattern)).toEqual(['/api/*/y', '/*/api/y']);
  });

  it('multi-wildcard tiebreak: first-divergent wildcard position determines sort (deeper-first-wildcard sorts first)', () => {
    // Both: literalCount=3 ('a','b','c'), wildcardCount=2, 5 segments total.
    // /a/b/*/*/c has wildcards at [2,3]; /a/*/b/*/c has wildcards at [1,3].
    // First wildcard position differs (2 vs 1), so deeper position (2) sorts first.
    // This pins the pairwise front-to-back comparison rule: compareSpecificityKeys
    // iterates wildcard indices and returns bi - ai when they diverge (higher index = later = more specific).
    const rules: Rule[] = [
      { pathPattern: '/a/*/b/*/c' },
      { pathPattern: '/a/b/*/*/c' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.pathPattern)).toEqual(['/a/b/*/*/c', '/a/*/b/*/c']);
  });

  it('falls back to pathPattern lexicographic order when shape ties', () => {
    const rules: Rule[] = [
      { pathPattern: '/api/zzz' },
      { pathPattern: '/api/aaa' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.pathPattern)).toEqual(['/api/aaa', '/api/zzz']);
  });

  it('method tiebreak: methodless sorts last for equal pathPattern', () => {
    const rules: Rule[] = [
      { pathPattern: '/api/x' },
      { pathPattern: '/api/x', method: 'POST' },
      { pathPattern: '/api/x', method: 'DELETE' },
      { pathPattern: '/api/x', method: 'GET' },
    ];
    const sorted = sortRulesBySpecificity(rules);
    expect(sorted.map((r) => r.method)).toEqual(['DELETE', 'GET', 'POST', undefined]);
  });

  it('does not mutate the input array', () => {
    const rules: Rule[] = [{ pathPattern: '/b' }, { pathPattern: '/a' }];
    const copy = [...rules];
    sortRulesBySpecificity(rules);
    expect(rules).toEqual(copy);
  });

  it('is stable/deterministic: sorting the same input twice yields identical order', () => {
    const rules: Rule[] = [
      { pathPattern: '/api/auth/*' },
      { pathPattern: '/api/feeds/remove', method: 'POST' },
      { pathPattern: '/api/feeds', method: 'GET' },
      { pathPattern: '/api/feeds', method: 'POST' },
      { pathPattern: '/api/items', method: 'GET' },
      { pathPattern: '/api/items/read-all', method: 'POST' },
      { pathPattern: '/r/*' },
      { pathPattern: '/api/resolve/*', method: 'GET' },
      { pathPattern: '/feed.xml' },
      { pathPattern: '/feed/*' },
      { pathPattern: '/api/uploads/content/*', method: 'GET' },
      { pathPattern: '/api/share-links/validate', method: 'GET' },
    ];
    const first = sortRulesBySpecificity(rules).map((r) => `${r.pathPattern} ${r.method ?? ''}`);
    const second = sortRulesBySpecificity(rules).map((r) => `${r.pathPattern} ${r.method ?? ''}`);
    expect(second).toEqual(first);
  });

  it('preserves original relative order for exact duplicate keys (stable sort)', () => {
    const a = { pathPattern: '/api/x', method: 'GET', tag: 'first' };
    const b = { pathPattern: '/api/x', method: 'GET', tag: 'second' };
    const sorted = sortRulesBySpecificity([a, b]);
    expect(sorted.map((r) => r.tag)).toEqual(['first', 'second']);
  });
});

describe('deriveOrders', () => {
  type Rule = { pathPattern: string; method?: string };

  it('returns 0-based positions matching sortRulesBySpecificity order', () => {
    const rules: Rule[] = [
      { pathPattern: '/*' },
      { pathPattern: '/api/*' },
      { pathPattern: '/api/feeds' },
      { pathPattern: '/api/feeds/remove' },
    ];
    const orders = deriveOrders(rules);
    expect(orders.get(rules[3])).toBe(0); // /api/feeds/remove
    expect(orders.get(rules[2])).toBe(1); // /api/feeds
    expect(orders.get(rules[1])).toBe(2); // /api/*
    expect(orders.get(rules[0])).toBe(3); // /*
  });

  it('is deterministic across calls', () => {
    const rules: Rule[] = [
      { pathPattern: '/api/b' },
      { pathPattern: '/api/a' },
      { pathPattern: '/api/c', method: 'GET' },
    ];
    const first = [...deriveOrders(rules).entries()].map(([r, i]) => [r.pathPattern, i]);
    const second = [...deriveOrders(rules).entries()].map(([r, i]) => [r.pathPattern, i]);
    expect(second).toEqual(first);
  });

  it('covers every rule in the input', () => {
    const rules: Rule[] = [{ pathPattern: '/a' }, { pathPattern: '/b' }, { pathPattern: '/c' }];
    const orders = deriveOrders(rules);
    expect(orders.size).toBe(3);
    for (const r of rules) expect(orders.has(r)).toBe(true);
  });
});
