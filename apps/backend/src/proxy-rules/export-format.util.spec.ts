import {
  ENVELOPE_KEY_ORDER,
  RULE_KEY_ORDER,
  buildExportEnvelope,
  sanitizeHeaderConfigForExport,
  serializeRuleForExport,
} from './export-format.util';
import type { ProxyRule } from '../db/schema/proxy-rules.schema';

/** Builds a fully-populated DB-shaped rule row, overridable per test. */
function makeRuleRow(overrides: Partial<ProxyRule> = {}): Partial<ProxyRule> {
  return {
    id: 'rule-uuid-1',
    ruleSetId: 'set-uuid-1',
    pathPattern: '/api/*',
    method: 'GET',
    methods: ['GET', 'HEAD'],
    targetUrl: 'https://api.example.com',
    stripPrefix: true,
    order: 0,
    timeout: 30000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: {
      forward: ['accept'],
      strip: ['cookie'],
      add: { 'X-API-Key': 'sk_live_secret' },
    },
    authTransform: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' },
    internalRewrite: false,
    proxyType: 'external_proxy',
    emailHandlerConfig: { destinationEmail: 'a@b.c' },
    pipelineConfig: { name: 'p', steps: [{ name: 's', handlerType: 'data_query', config: {} }] },
    isEnabled: true,
    debugEnabled: false,
    bypassVisibility: true,
    description: 'a rule',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('export-format.util', () => {
  describe('key-order constants (ground truth: packages/cli/src/format/types.ts)', () => {
    it('RULE_KEY_ORDER is the 19-key CLI order, including methods and bypassVisibility', () => {
      expect([...RULE_KEY_ORDER]).toEqual([
        'pathPattern',
        'method',
        'methods',
        'targetUrl',
        'stripPrefix',
        'order',
        'timeout',
        'preserveHost',
        'forwardCookies',
        'headerConfig',
        'authTransform',
        'internalRewrite',
        'proxyType',
        'emailHandlerConfig',
        'pipelineConfig',
        'isEnabled',
        'debugEnabled',
        'bypassVisibility',
        'description',
      ]);
    });

    it('ENVELOPE_KEY_ORDER matches the CLI envelope order', () => {
      expect([...ENVELOPE_KEY_ORDER]).toEqual([
        'version',
        'exportedAt',
        'kind',
        'ruleSet',
        'rules',
        'schemas',
      ]);
    });
  });

  describe('sanitizeHeaderConfigForExport', () => {
    it('returns undefined for null and undefined input', () => {
      expect(sanitizeHeaderConfigForExport(null)).toBeUndefined();
      expect(sanitizeHeaderConfigForExport(undefined)).toBeUndefined();
    });

    it('blanks every add value to the empty string', () => {
      const out = sanitizeHeaderConfigForExport({
        add: { 'X-API-Key': 'sk_live_abc123', Authorization: 'Bearer tok' },
      });
      expect(out).toEqual({ add: { 'X-API-Key': '', Authorization: '' } });
    });

    it('passes forward/strip arrays through untouched (same references)', () => {
      const forward = ['accept', 'content-type'];
      const strip = ['cookie'];
      const out = sanitizeHeaderConfigForExport({ forward, strip, add: { 'X-K': 'v' } });
      expect(out!.forward).toBe(forward);
      expect(out!.strip).toBe(strip);
      expect(out!.add).toEqual({ 'X-K': '' });
    });

    it('returns a config without add as-is', () => {
      const cfg = { forward: ['accept'] };
      expect(sanitizeHeaderConfigForExport(cfg)).toBe(cfg);
    });

    it('does not mutate the input', () => {
      const cfg = { add: { 'X-K': 'secret' } };
      sanitizeHeaderConfigForExport(cfg);
      expect(cfg.add['X-K']).toBe('secret');
    });

    it('preserves an empty add map and passes a nested null add through verbatim', () => {
      expect(sanitizeHeaderConfigForExport({ forward: ['accept'], add: {} })).toEqual({
        forward: ['accept'],
        add: {},
      });
      const withNullAdd = { forward: ['accept'], add: null } as unknown as {
        forward: string[];
        add: Record<string, string>;
      };
      expect(sanitizeHeaderConfigForExport(withNullAdd)).toBe(withNullAdd);
    });
  });

  describe('serializeRuleForExport', () => {
    it('emits exactly the RULE_KEY_ORDER keys, in order, for a fully-populated row', () => {
      const out = serializeRuleForExport(makeRuleRow());
      expect(Object.keys(out)).toEqual([...RULE_KEY_ORDER]);
    });

    it('includes methods when set (#448 regression test)', () => {
      const out = serializeRuleForExport(makeRuleRow({ method: null, methods: ['GET', 'HEAD'] }));
      expect(out.methods).toEqual(['GET', 'HEAD']);
      expect(out).not.toHaveProperty('method');
    });

    it('includes method and omits methods when only method is set', () => {
      const out = serializeRuleForExport(makeRuleRow({ method: 'POST', methods: null }));
      expect(out.method).toBe('POST');
      expect(out).not.toHaveProperty('methods');
    });

    it('never emits server-managed fields (id, ruleSetId, createdAt, updatedAt)', () => {
      const out = serializeRuleForExport(makeRuleRow()) as unknown as Record<string, unknown>;
      expect(out).not.toHaveProperty('id');
      expect(out).not.toHaveProperty('ruleSetId');
      expect(out).not.toHaveProperty('createdAt');
      expect(out).not.toHaveProperty('updatedAt');
    });

    it('drops null/undefined at the rule top level only', () => {
      const out = serializeRuleForExport(
        makeRuleRow({
          method: null,
          methods: null,
          headerConfig: null,
          authTransform: null,
          emailHandlerConfig: null,
          pipelineConfig: null,
          description: null,
        }),
      );
      expect(Object.keys(out)).toEqual([
        'pathPattern',
        'targetUrl',
        'stripPrefix',
        'order',
        'timeout',
        'preserveHost',
        'forwardCookies',
        'internalRewrite',
        'proxyType',
        'isEnabled',
        'debugEnabled',
        'bypassVisibility',
      ]);
    });

    it('omits bypassVisibility when false (absent-means-default; older CLIs refuse unknown keys) and emits it when true', () => {
      const off = serializeRuleForExport(makeRuleRow({ bypassVisibility: false }));
      expect(off).not.toHaveProperty('bypassVisibility');
      const on = serializeRuleForExport(makeRuleRow({ bypassVisibility: true }));
      expect(on.bypassVisibility).toBe(true);
      expect(Object.keys(on).indexOf('bypassVisibility')).toBe(
        Object.keys(on).indexOf('debugEnabled') + 1,
      );
    });

    it('passes nested objects through verbatim — a null inside a pipeline step config survives', () => {
      const pipelineConfig = {
        name: 'p',
        description: undefined,
        steps: [{ name: 's', handlerType: 'ai', config: { systemPrompt: null, temperature: 0.2 } }],
      };
      const out = serializeRuleForExport(makeRuleRow({ pipelineConfig }));
      expect(out.pipelineConfig).toBe(pipelineConfig);
      expect(
        (out.pipelineConfig!.steps[0].config as Record<string, unknown>).systemPrompt,
      ).toBeNull();
    });

    it('passes authTransform and emailHandlerConfig through verbatim', () => {
      const authTransform = { type: 'cookie-to-bearer' as const, cookieName: 'sAccessToken' };
      const emailHandlerConfig = { destinationEmail: 'a@b.c', subject: 'Hi' };
      const out = serializeRuleForExport(makeRuleRow({ authTransform, emailHandlerConfig }));
      expect(out.authTransform).toBe(authTransform);
      expect(out.emailHandlerConfig).toBe(emailHandlerConfig);
    });

    it('blanks headerConfig.add secret values via the sanitizer', () => {
      const out = serializeRuleForExport(
        makeRuleRow({
          headerConfig: { forward: ['accept'], add: { 'X-API-Key': 'sk_live_abc', Auth: 'tok' } },
        }),
      );
      expect(out.headerConfig).toEqual({ forward: ['accept'], add: { 'X-API-Key': '', Auth: '' } });
    });

    it('omits description when null and keeps it when present', () => {
      expect(serializeRuleForExport(makeRuleRow({ description: null }))).not.toHaveProperty(
        'description',
      );
      expect(serializeRuleForExport(makeRuleRow({ description: 'hi' })).description).toBe('hi');
    });

    it('keeps falsy-but-real values (empty-string description) but drops an empty methods array', () => {
      const out = serializeRuleForExport(makeRuleRow({ description: '', methods: [] }));
      expect(out.description).toBe('');
      // methods [] ≡ absent (fall back to method); sync normalizes [] to null,
      // so exporting [] would be permanent diff drift a push can never fix.
      expect(out).not.toHaveProperty('methods');
    });
  });

  describe('buildExportEnvelope', () => {
    const rules = [serializeRuleForExport(makeRuleRow())];
    const schemas = [
      {
        id: 'sch-1',
        name: 'comments',
        fields: [{ name: 'body', type: 'string' as const, required: true }],
      },
    ];
    const exportedAt = '2026-07-11T00:00:00.000Z';

    it('emits envelope keys in ENVELOPE_KEY_ORDER when schemas are present', () => {
      const out = buildExportEnvelope({ ruleSet: { name: 'api' }, rules, schemas, exportedAt });
      expect(Object.keys(out)).toEqual([...ENVELOPE_KEY_ORDER]);
    });

    it('sets version 2, the kind constant, and the given exportedAt', () => {
      const out = buildExportEnvelope({ ruleSet: { name: 'api' }, rules, exportedAt });
      expect(out.version).toBe(2);
      expect(out.kind).toBe('bffless-proxy-rule-set');
      expect(out.exportedAt).toBe(exportedAt);
    });

    it('omits the schemas key entirely when the list is empty or undefined', () => {
      expect(
        buildExportEnvelope({ ruleSet: { name: 'api' }, rules, schemas: [], exportedAt }),
      ).not.toHaveProperty('schemas');
      expect(
        buildExportEnvelope({ ruleSet: { name: 'api' }, rules, exportedAt }),
      ).not.toHaveProperty('schemas');
    });

    it('strips null/undefined ruleSet description/environment and keeps present values', () => {
      const stripped = buildExportEnvelope({
        ruleSet: { name: 'api', description: null, environment: undefined },
        rules,
        exportedAt,
      });
      expect(stripped.ruleSet).toEqual({ name: 'api' });
      expect(Object.keys(stripped.ruleSet)).toEqual(['name']);

      const kept = buildExportEnvelope({
        ruleSet: { name: 'api', description: 'd', environment: 'prod' },
        rules,
        exportedAt,
      });
      expect(kept.ruleSet).toEqual({ name: 'api', description: 'd', environment: 'prod' });
      expect(Object.keys(kept.ruleSet)).toEqual(['name', 'description', 'environment']);
    });

    it('passes already-serialized rules through content-verbatim (individual rules unmodified)', () => {
      const out = buildExportEnvelope({ ruleSet: { name: 'api' }, rules, exportedAt });
      expect(out.rules).toEqual(rules);
      expect(out.rules[0]).toBe(rules[0]); // rules themselves are not cloned, only re-ordered
    });

    it('sorts rules canonically by (order, pathPattern, method) — CLI sortRules parity', () => {
      const mk = (pathPattern: string, order: number, method?: string) =>
        serializeRuleForExport(
          makeRuleRow({ pathPattern, order, method: method ?? null, methods: null }),
        );
      const unsorted = [mk('/b', 1), mk('/a', 1, 'POST'), mk('/a', 1, 'GET'), mk('/z', 0)];
      const out = buildExportEnvelope({ ruleSet: { name: 'api' }, rules: unsorted, exportedAt });
      expect(out.rules.map((r) => [r.pathPattern, r.order, r.method ?? null])).toEqual([
        ['/z', 0, null],
        ['/a', 1, 'GET'],
        ['/a', 1, 'POST'],
        ['/b', 1, null],
      ]);
      // Input array order untouched (non-mutating sort).
      expect(unsorted.map((r) => r.pathPattern)).toEqual(['/b', '/a', '/a', '/z']);
    });

    it('sorts bundled schemas by name — CLI sortSchemas parity', () => {
      const out = buildExportEnvelope({
        ruleSet: { name: 'api' },
        rules,
        schemas: [
          { id: 's2', name: 'zebra', fields: [] },
          { id: 's1', name: 'alpha', fields: [] },
        ],
        exportedAt,
      });
      expect(out.schemas!.map((s) => s.name)).toEqual(['alpha', 'zebra']);
    });
  });
});
