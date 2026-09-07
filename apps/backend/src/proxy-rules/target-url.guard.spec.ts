import { BadRequestException } from '@nestjs/common';
import type { HostLookup } from '../common/outbound-url.guard';
import {
  guardRuleTargets,
  isExternalTargetRule,
  ruleTargetLabel,
  vetTargetUrl,
  vetTargetUrls,
} from './target-url.guard';

const PUBLIC = [{ address: '104.18.1.1', family: 4 as const }];
const PRIVATE = [{ address: '10.0.0.5', family: 4 as const }];

/** A lookup answering by hostname; anything unlisted is public. */
const lookupFor = (answers: Record<string, typeof PUBLIC>): jest.MockedFunction<HostLookup> =>
  jest.fn(async (host: string) => answers[host] ?? PUBLIC);

describe('target-url.guard (#780)', () => {
  describe('vetTargetUrl — the static rules (a) never resolve', () => {
    it.each([
      ['not a url', 'Invalid URL format'],
      ['ftp://files.example.com/x', 'Target URL must use HTTP or HTTPS protocol'],
      [
        'http://public.example',
        'Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost)',
      ],
      ['https://169.254.169.254', 'Target URL cannot point to internal services'],
      ['https://metadata.google.internal', 'Target URL cannot point to internal services'],
      ['https://10.0.0.1', 'Target URL cannot point to internal IP ranges'],
      ['https://192.168.1.1:8443/api', 'Target URL cannot point to internal IP ranges'],
    ])('%s → %s', async (url, reason) => {
      const lookup = lookupFor({});
      await expect(vetTargetUrl(url, lookup)).resolves.toEqual({
        ok: false,
        check: 'static',
        reason,
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://backend.default.svc:8080',
      'https://backend.default.svc.cluster.local',
    ])('an explicitly internal host %s passes without a lookup', async (url) => {
      const lookup = lookupFor({});
      await expect(vetTargetUrl(url, lookup)).resolves.toEqual({ ok: true });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('vetTargetUrl — resolve and vet (b)', () => {
    it('passes a public name resolving to public addresses', async () => {
      const lookup = lookupFor({});
      await expect(vetTargetUrl('https://api.example.com/v1', lookup)).resolves.toEqual({
        ok: true,
      });
      expect(lookup).toHaveBeenCalledWith('api.example.com');
    });

    it('fails with check "resolve" and the guard verdict when any address is non-public', async () => {
      const lookup = lookupFor({ 'intranet.example': PRIVATE });
      const verdict = await vetTargetUrl('https://intranet.example', lookup);
      expect(verdict).toMatchObject({
        ok: false,
        check: 'resolve',
        reason: 'intranet.example resolves to a non-public address (10.0.0.5)',
        verdict: { ok: false, reason: 'non-public' },
      });
    });

    it('judges a public IP literal as itself', async () => {
      const lookup = lookupFor({});
      await expect(vetTargetUrl('https://8.8.8.8', lookup)).resolves.toEqual({ ok: true });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('vetTargetUrls — one lookup per hostname across many URLs', () => {
    it('keys the result by URL and resolves each distinct host once', async () => {
      const lookup = lookupFor({ 'intranet.example': PRIVATE });
      const urls = [
        'https://api.example.com/a',
        'https://api.example.com/b',
        'https://intranet.example',
        'http://public.example',
        'http://localhost:3000',
        'https://api.example.com/a',
      ];

      const out = await vetTargetUrls(urls, { lookup });

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(out.size).toBe(5);
      expect(out.get('https://api.example.com/a')).toEqual({ ok: true });
      expect(out.get('https://api.example.com/b')).toEqual({ ok: true });
      expect(out.get('https://intranet.example')).toMatchObject({ ok: false, check: 'resolve' });
      expect(out.get('http://public.example')).toMatchObject({ ok: false, check: 'static' });
      expect(out.get('http://localhost:3000')).toEqual({ ok: true });
    });
  });

  describe('isExternalTargetRule', () => {
    const base = { pathPattern: '/api/*', targetUrl: 'https://api.example.com' };
    it.each([
      ['a plain external_proxy rule', { ...base }, true],
      ['an explicit external_proxy', { ...base, proxyType: 'external_proxy' }, true],
      ['an internal rewrite', { ...base, internalRewrite: true }, false],
      ['a pipeline by proxyType', { ...base, proxyType: 'pipeline' }, false],
      [
        'a pipeline inferred from pipelineConfig with the internal default target',
        { ...base, targetUrl: 'http://internal/pipeline', pipelineConfig: { steps: [] } },
        false,
      ],
      ['an email handler', { ...base, emailHandlerConfig: { to: ['a@b'] } }, false],
      ['no target', { pathPattern: '/api/*' }, false],
      ['a null target', { pathPattern: '/api/*', targetUrl: null }, false],
      ['an empty target', { pathPattern: '/api/*', targetUrl: '' }, false],
    ])('%s → %s', (_name, rule, expected) => {
      expect(isExternalTargetRule(rule)).toBe(expected);
    });
  });

  describe('ruleTargetLabel', () => {
    it('names the rule by method(s) and pathPattern, omitting the method for any-method rules', () => {
      expect(ruleTargetLabel({ pathPattern: '/api/*', method: 'get' })).toBe('Rule "GET /api/*"');
      expect(ruleTargetLabel({ pathPattern: '/api/*', methods: ['post', 'get'] })).toBe(
        'Rule "GET,POST /api/*"',
      );
      expect(ruleTargetLabel({ pathPattern: '/api/*' })).toBe('Rule "/api/*"');
    });
  });

  describe('guardRuleTargets', () => {
    const rules = [
      { pathPattern: '/a/*', method: 'GET', targetUrl: 'https://intranet.example' },
      { pathPattern: '/b/*', method: 'POST', targetUrl: 'https://api.example.com' },
      { pathPattern: '/c/*', targetUrl: 'http://public.example' },
      { pathPattern: '/d/*', targetUrl: 'https://intranet.example/other' },
      { pathPattern: '/pipe/*', targetUrl: 'http://internal/pipeline', proxyType: 'pipeline' },
      { pathPattern: '/local/*', targetUrl: 'http://localhost:3000' },
    ];

    it('warn: one line per failing rule, in input order, in the schema-warning format', async () => {
      const lookup = lookupFor({ 'intranet.example': PRIVATE });

      const warnings = await guardRuleTargets(rules, { mode: 'warn', lookup });

      expect(warnings).toEqual([
        'Rule "GET /a/*": target https://intranet.example — intranet.example resolves to a non-public address (10.0.0.5); allowed because OUTBOUND_URL_GUARD=warn',
        'Rule "/c/*": target http://public.example — Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost); allowed because OUTBOUND_URL_GUARD=warn',
        'Rule "/d/*": target https://intranet.example/other — intranet.example resolves to a non-public address (10.0.0.5); allowed because OUTBOUND_URL_GUARD=warn',
      ]);
      // intranet.example and api.example.com — one lookup each; nothing for the
      // http:// rule (static), the pipeline or the localhost rule.
      expect(lookup).toHaveBeenCalledTimes(2);
    });

    it('reject: one BadRequestException listing every failing rule', async () => {
      const lookup = lookupFor({ 'intranet.example': PRIVATE });

      const attempt = guardRuleTargets(rules, { mode: 'reject', lookup });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(
        'Proxy rule targets refused by OUTBOUND_URL_GUARD=reject: ' +
          'Rule "GET /a/*": target https://intranet.example — intranet.example resolves to a non-public address (10.0.0.5); ' +
          'Rule "/c/*": target http://public.example — Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost); ' +
          'Rule "/d/*": target https://intranet.example/other — intranet.example resolves to a non-public address (10.0.0.5)',
      );
    });

    it('is silent when every external target passes, in reject mode too', async () => {
      const lookup = lookupFor({});
      await expect(
        guardRuleTargets(rules.slice(1, 2), { mode: 'reject', lookup }),
      ).resolves.toEqual([]);
    });

    it('skips a batch with no external-target rules without a lookup', async () => {
      const lookup = lookupFor({});
      await expect(guardRuleTargets(rules.slice(4), { mode: 'reject', lookup })).resolves.toEqual(
        [],
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('takes the mode from OUTBOUND_URL_GUARD when none is given', async () => {
      const before = process.env.OUTBOUND_URL_GUARD;
      const lookup = lookupFor({ 'intranet.example': PRIVATE });
      try {
        process.env.OUTBOUND_URL_GUARD = 'reject';
        await expect(guardRuleTargets(rules.slice(0, 1), { lookup })).rejects.toThrow(
          BadRequestException,
        );
        delete process.env.OUTBOUND_URL_GUARD;
        await expect(guardRuleTargets(rules.slice(0, 1), { lookup })).resolves.toHaveLength(1);
      } finally {
        if (before === undefined) delete process.env.OUTBOUND_URL_GUARD;
        else process.env.OUTBOUND_URL_GUARD = before;
      }
    });
  });
});
