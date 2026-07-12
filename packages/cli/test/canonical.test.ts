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

describe('canonicalizeExport strictness and scoped null-stripping', () => {
  it('throws on an unknown rule key even when its value is null', () => {
    const bad = {
      ...structuredClone(mini),
      rules: [{ pathPattern: '/a', targetUrl: 't', bogusKey: null }],
    };
    expect(() => canonicalizeExport(bad as unknown as RuleSetExport)).toThrow('Unknown rule key: "bogusKey"');
  });
  it('throws on an unknown envelope key', () => {
    const bad = { ...structuredClone(mini), bogusEnvelopeKey: 'x' };
    expect(() => canonicalizeExport(bad as unknown as RuleSetExport)).toThrow('Unknown export key: "bogusEnvelopeKey"');
  });
  it('throws on an unknown step key', () => {
    const bad = {
      ...structuredClone(mini),
      rules: [
        {
          pathPattern: '/a',
          targetUrl: 'pipeline',
          proxyType: 'pipeline',
          pipelineConfig: { name: 'p', steps: [{ name: 's', handlerType: 'response_handler', config: {}, bogusStepKey: 1 }] },
        },
      ],
    };
    expect(() => canonicalizeExport(bad as unknown as RuleSetExport)).toThrow('Unknown step key: "bogusStepKey"');
  });
  it('preserves a null nested deep inside a step config', () => {
    const withNestedNull: RuleSetExport = {
      ...structuredClone(mini),
      rules: [
        {
          pathPattern: '/a',
          targetUrl: 'pipeline',
          proxyType: 'pipeline',
          pipelineConfig: {
            name: 'p',
            steps: [{ name: 's', handlerType: 'response_handler', config: { filter: { deletedAt: null } } }],
          },
        },
      ],
    };
    const c = canonicalizeExport(withNestedNull);
    expect((c.rules[0].pipelineConfig!.steps[0].config as any).filter).toEqual({ deletedAt: null });
  });
  it('still drops a rule-level null (e.g. headerConfig: null)', () => {
    const withRuleNull: RuleSetExport = {
      ...structuredClone(mini),
      rules: [{ pathPattern: '/a', targetUrl: 't', headerConfig: null as any }],
    };
    const c = canonicalizeExport(withRuleNull);
    expect('headerConfig' in c.rules[0]).toBe(false);
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
  it('(f) treats absent internalRewrite/debugEnabled as equal to explicit false, but not to true', () => {
    // mini's rules omit internalRewrite/debugEnabled entirely (older-exporter shape).
    const withExplicitFalse = structuredClone(mini);
    withExplicitFalse.rules = withExplicitFalse.rules.map((r) => ({ ...r, internalRewrite: false, debugEnabled: false }));
    expect(exportsEquivalent(mini, withExplicitFalse).equal).toBe(true);

    const withDebugTrue = structuredClone(mini);
    withDebugTrue.rules = withDebugTrue.rules.map((r) => ({ ...r, debugEnabled: true }));
    const r = exportsEquivalent(mini, withDebugTrue);
    expect(r.equal).toBe(false);
    expect(r.diffs.some((d) => d.includes('debugEnabled'))).toBe(true);
  });
  it('treats an absent targetUrl on a non-pipeline rule as equal to the DB default "" (server stores/export "")', () => {
    // e.g. an email_form_handler authored without targetUrl: the sync import stores '' (DB
    // column default — apps/backend sync-plan.util.ts normalizeRule) and the export returns ''.
    const emailNoTarget: RuleSetExport = {
      ...structuredClone(mini),
      rules: [{ pathPattern: '/contact', method: 'POST', emailHandlerConfig: { to: 't@e.com' } } as any],
    };
    const emailEmptyTarget = structuredClone(emailNoTarget);
    (emailEmptyTarget.rules[0] as any).targetUrl = '';
    expect(exportsEquivalent(emailNoTarget, emailEmptyTarget).equal).toBe(true);

    // A REAL targetUrl difference is still drift.
    const emailRealTarget = structuredClone(emailNoTarget);
    (emailRealTarget.rules[0] as any).targetUrl = 'https://mailer.example.com';
    const r = exportsEquivalent(emailNoTarget, emailRealTarget);
    expect(r.equal).toBe(false);
    expect(r.diffs.some((d) => d.includes('targetUrl'))).toBe(true);
  });
});
