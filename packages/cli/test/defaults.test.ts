import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { applyRuleDefaults, elideRuleDefaults, RULE_DEFAULTS, PIPELINE_TARGET_URL_DEFAULT } from '../src/format/defaults.js';
import { canonicalizeExport } from '../src/format/canonical.js';
import type { ExportedRule, RuleSetExport } from '../src/format/types.js';

const realDir = path.resolve('test/fixtures/real');
const real = readdirSync(realDir).map((f) => JSON.parse(readFileSync(path.join(realDir, f), 'utf8')) as RuleSetExport);

describe('applyRuleDefaults', () => {
  it('(a) minimal pipeline manifest gains all defaults + inferred proxyType + default targetUrl', () => {
    const out = applyRuleDefaults({
      pathPattern: '/api/x',
      pipelineConfig: { name: 'x', steps: [{ name: 's', handlerType: 'response_handler', config: {} }] },
    });
    expect(out).toEqual({
      pathPattern: '/api/x',
      pipelineConfig: { name: 'x', steps: [{ name: 's', handlerType: 'response_handler', config: {} }] },
      stripPrefix: true,
      timeout: 30000,
      preserveHost: false,
      forwardCookies: false,
      internalRewrite: false,
      isEnabled: true,
      debugEnabled: false,
      proxyType: 'pipeline',
      targetUrl: PIPELINE_TARGET_URL_DEFAULT,
    });
  });

  it('(b) explicit proxyType:"external_proxy" beats inference from pipelineConfig', () => {
    const out = applyRuleDefaults({
      pathPattern: '/api/y',
      proxyType: 'external_proxy',
      targetUrl: 'http://example.com/y',
      pipelineConfig: { name: 'y', steps: [] },
    });
    expect(out.proxyType).toBe('external_proxy');
    expect(out.targetUrl).toBe('http://example.com/y');
  });
});

describe('elideRuleDefaults', () => {
  it('(d) targetUrl:"pipeline" (non-default literal) is preserved by elision', () => {
    const rule: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/z',
      targetUrl: 'pipeline',
      proxyType: 'pipeline',
      pipelineConfig: { name: 'z', steps: [] },
    });
    const elided = elideRuleDefaults(rule);
    expect(elided.targetUrl).toBe('pipeline');
  });

  it('(e) timeout:30000 (default) is dropped, timeout:15000 (non-default) is kept', () => {
    const withDefault: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/a',
      targetUrl: 'http://example.com/a',
      timeout: RULE_DEFAULTS.timeout,
    });
    const withOverride: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/b',
      targetUrl: 'http://example.com/b',
      timeout: 15000,
    });
    expect('timeout' in elideRuleDefaults(withDefault)).toBe(false);
    expect(elideRuleDefaults(withOverride).timeout).toBe(15000);
  });

  it('drops proxyType only when it equals what inference would re-derive', () => {
    const pipelineRule: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/p',
      proxyType: 'pipeline',
      pipelineConfig: { name: 'p', steps: [] },
    });
    expect('proxyType' in elideRuleDefaults(pipelineRule)).toBe(false);

    const externalRule: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/e',
      proxyType: 'external_proxy',
      targetUrl: 'http://example.com/e',
    });
    expect('proxyType' in elideRuleDefaults(externalRule)).toBe(false);

    const mismatchedRule: ExportedRule = applyRuleDefaults({
      pathPattern: '/api/m',
      proxyType: 'external_proxy',
      targetUrl: 'http://example.com/m',
      pipelineConfig: { name: 'm', steps: [] },
    });
    expect(elideRuleDefaults(mismatchedRule).proxyType).toBe('external_proxy');
  });
});

describe('applyRuleDefaults(elideRuleDefaults(...)) fixture identity sweep', () => {
  // (c) Absent-means-default is the correct semantics (it is what CE's DB import does). Older
  // exports (reader/handoff) omit default-valued keys like internalRewrite/debugEnabled entirely,
  // while the current exporter (studio-blog) emits them explicitly as false. Raw key-presence
  // identity is therefore unsatisfiable across exporter eras; identity is judged on each rule's
  // defaults-complete form instead: applyRuleDefaults(elideRuleDefaults(applyRuleDefaults(r))) must
  // deep-equal applyRuleDefaults(r).
  it('(c) is identity on the defaults-complete form for every rule of every real fixture', () => {
    for (const exp of real) {
      const canonical = canonicalizeExport(structuredClone(exp));
      for (const r of canonical.rules) {
        const complete = applyRuleDefaults(r);
        expect(applyRuleDefaults(elideRuleDefaults(complete))).toEqual(complete);
      }
    }
  });
});
