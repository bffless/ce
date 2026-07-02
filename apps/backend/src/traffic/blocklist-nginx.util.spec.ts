import {
  assertNginxSafeRegexSource,
  renderEdgeBlocklistRules,
  renderEdgeBlocklistSandboxConfig,
} from './blocklist-nginx.util';
import { compileBlocklistRegexSource } from './blocklist-compiler';
import { BASELINE_BLOCKLIST_ENTRIES } from './blocklist-baseline';

describe('assertNginxSafeRegexSource', () => {
  it('accepts compiled sources, including anchors and escapes', () => {
    expect(() =>
      assertNginxSafeRegexSource('(?:^/wp\\-admin|\\.php$|^/\\.env$|phpunit)'),
    ).not.toThrow();
  });

  it('accepts the full compiled Baseline', () => {
    const source = compileBlocklistRegexSource(BASELINE_BLOCKLIST_ENTRIES);
    expect(source).not.toBeNull();
    expect(() => assertNginxSafeRegexSource(source!)).not.toThrow();
  });

  it.each(['a b', 'a"b', "a'b", 'a{b', 'a}b', 'a;b', 'a#b', 'a`b', 'a\nb'])(
    'rejects nginx config syntax characters (%j)',
    (source) => {
      expect(() => assertNginxSafeRegexSource(source)).toThrow(/config syntax/);
    },
  );

  it('rejects nginx variable interpolation but allows regex anchors', () => {
    expect(() => assertNginxSafeRegexSource('$host')).toThrow(/variable/);
    expect(() => assertNginxSafeRegexSource('a${b}')).toThrow();
    expect(() => assertNginxSafeRegexSource('(?:\\.php$|^/x$)')).not.toThrow();
  });
});

describe('renderEdgeBlocklistRules', () => {
  it('returns empty string when there is nothing to block', () => {
    expect(
      renderEdgeBlocklistRules({ blockSource: null, allowSource: null, returnCode: '444' }),
    ).toBe('');
    expect(
      renderEdgeBlocklistRules({ blockSource: null, allowSource: '(?:^/ok)', returnCode: '444' }),
    ).toBe('');
  });

  it('renders block-only rules with the requested return code', () => {
    const rules = renderEdgeBlocklistRules({
      blockSource: '(?:^/wp\\-admin)',
      allowSource: null,
      returnCode: '444',
    });
    expect(rules).toContain('set $blocklist_hit 0;');
    expect(rules).toContain('if ($uri ~* "(?:^/wp\\-admin)") {');
    expect(rules).toContain('return 444;');
    expect(rules).not.toContain('403');
    // Allow branch absent: the hit variable is only ever set once to 1.
    expect(rules.match(/set \$blocklist_hit 0;/g)).toHaveLength(1);
  });

  it('renders the allow rescue AFTER the block match so it always wins', () => {
    const rules = renderEdgeBlocklistRules({
      blockSource: '(?:^/wp\\-admin)',
      allowSource: '(?:^/wp\\-admin/allowed)',
      returnCode: '403',
    });
    const blockIdx = rules.indexOf('set $blocklist_hit 1;');
    const allowIdx = rules.lastIndexOf('set $blocklist_hit 0;');
    const returnIdx = rules.indexOf('return 403;');
    expect(blockIdx).toBeGreaterThan(-1);
    expect(allowIdx).toBeGreaterThan(blockIdx);
    expect(returnIdx).toBeGreaterThan(allowIdx);
  });

  it('propagates safety violations as errors (never emits a suspect config)', () => {
    expect(() =>
      renderEdgeBlocklistRules({ blockSource: 'a;b', allowSource: null, returnCode: '444' }),
    ).toThrow();
    expect(() =>
      renderEdgeBlocklistRules({
        blockSource: '(?:^/x)',
        allowSource: 'a b',
        returnCode: '444',
      }),
    ).toThrow();
  });

  it('renders the full Baseline into rules without syntax-breaking characters', () => {
    const source = compileBlocklistRegexSource(BASELINE_BLOCKLIST_ENTRIES);
    const rules = renderEdgeBlocklistRules({
      blockSource: source,
      allowSource: null,
      returnCode: '444',
    });
    // Every non-comment line must terminate a directive or open/close a block.
    for (const line of rules.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;
      expect(trimmed).toMatch(/[;{}]$/);
    }
  });
});

describe('renderEdgeBlocklistSandboxConfig', () => {
  it('wraps rules in a self-contained config with no external file references', () => {
    const rules = renderEdgeBlocklistRules({
      blockSource: '(?:^/wp\\-admin)',
      allowSource: null,
      returnCode: '444',
    });
    const conf = renderEdgeBlocklistSandboxConfig(rules);
    expect(conf).toContain('events {');
    expect(conf).toContain(rules);
    // No absolute paths: everything resolves inside the -p prefix.
    expect(conf).not.toMatch(/^\s*(ssl_certificate|include|root)\b/m);
    expect(conf).not.toContain('/etc/');
  });
});
