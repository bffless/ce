import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeExport, stringifyExport, exportsEquivalent } from '../src/format/canonical.js';
import type { RuleSetExport } from '../src/format/types.js';

const realDir = path.resolve('test/fixtures/real');
const real = readdirSync(realDir).map((f) => JSON.parse(readFileSync(path.join(realDir, f), 'utf8')) as RuleSetExport);

const mini: RuleSetExport = {
  version: 2, exportedAt: '2026-07-11T00:00:00.000Z', kind: 'bffless-proxy-rule-set',
  ruleSet: { name: 'mini' },
  rules: [{ pathPattern: '/api/b', method: 'GET', targetUrl: 'pipeline', stripPrefix: true, order: 1,
            timeout: 30000, preserveHost: false, forwardCookies: false, proxyType: 'pipeline', isEnabled: true,
            pipelineConfig: { name: 'b', steps: [{ name: 's', handlerType: 'response_handler', config: { status: 200 } }] } },
          { pathPattern: '/api/a', method: 'POST', targetUrl: 'x', stripPrefix: true, order: 0,
            timeout: 30000, preserveHost: false, forwardCookies: false, proxyType: 'external_proxy', isEnabled: true }],
};

describe('canonicalizeExport / stringifyExport', () => {
  it('orders envelope keys version,exportedAt,kind,ruleSet,rules,schemas', () => {
    const keys = Object.keys(canonicalizeExport(structuredClone(mini)));
    expect(keys).toEqual(['version', 'exportedAt', 'kind', 'ruleSet', 'rules']);
  });
  it('sorts rules by (order, pathPattern, method) and rule keys by RULE_KEY_ORDER', () => {
    const c = canonicalizeExport(structuredClone(mini));
    expect(c.rules[0].pathPattern).toBe('/api/a');
    expect(Object.keys(c.rules[1])[0]).toBe('pathPattern');
  });
  it('omits schemas key when empty and never emits null values', () => {
    const c = canonicalizeExport({ ...structuredClone(mini), schemas: [] });
    expect('schemas' in c).toBe(false);
    expect(stringifyExport(c)).not.toContain('null');
  });
  it('stringify is deterministic and ends with newline', () => {
    expect(stringifyExport(structuredClone(mini))).toBe(stringifyExport(structuredClone(mini)));
    expect(stringifyExport(mini).endsWith('\n')).toBe(true);
  });
  it('round-trips every real fixture through canonicalize losslessly (deep-equal)', () => {
    for (const exp of real) {
      const r = exportsEquivalent(exp, canonicalizeExport(structuredClone(exp)));
      expect(r.diffs).toEqual([]);
    }
  });
});

describe('exportsEquivalent', () => {
  it('ignores exportedAt and key order', () => {
    const b = structuredClone(mini); b.exportedAt = '2030-01-01T00:00:00.000Z';
    expect(exportsEquivalent(mini, b).equal).toBe(true);
  });
  it('reports a dotted path for a changed nested value', () => {
    const b = structuredClone(mini);
    (b.rules.find(r => r.pathPattern === '/api/b')!.pipelineConfig!.steps[0].config as any).status = 500;
    const r = exportsEquivalent(mini, b);
    expect(r.equal).toBe(false);
    expect(r.diffs.some(d => d.includes('/api/b') && d.includes('status'))).toBe(true);
  });
});
