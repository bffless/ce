import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncProxyRuleDto, SyncProxyRuleSetDto } from './sync-proxy-rule-set.dto';

/**
 * DTO validation for the sync endpoint — the SSRF gap closure (Task 7 of the
 * Phase 1 plan): sync rule targetUrls go through IsValidTargetUrlOrPath
 * semantics (via IsValidSyncTargetUrl) while remaining optional so elided
 * canonical pipeline payloads keep working.
 */
describe('SyncProxyRuleDto', () => {
  const validateRule = async (rule: Record<string, unknown>) =>
    validate(plainToInstance(SyncProxyRuleDto, rule));

  const propertiesWithErrors = (errors: { property: string }[]) => errors.map((e) => e.property);

  describe('targetUrl SSRF validation', () => {
    it('rejects an HTTP URL to the cloud metadata IP (169.254.169.254)', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        targetUrl: 'http://169.254.169.254/latest/meta-data',
      });
      expect(propertiesWithErrors(errors)).toContain('targetUrl');
    });

    it('rejects a plain external HTTP URL (only *.svc / localhost may use http)', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        targetUrl: 'http://internal-api.example.com',
      });
      expect(propertiesWithErrors(errors)).toContain('targetUrl');
    });

    it('accepts an HTTPS URL', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        targetUrl: 'https://api.example.com',
      });
      expect(errors).toEqual([]);
    });

    it('accepts HTTP for K8s-internal service hosts (*.svc)', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        targetUrl: 'http://backend.default.svc:3000',
      });
      expect(errors).toEqual([]);
    });

    it('accepts a path targetUrl for internal rewrites', async () => {
      const errors = await validateRule({
        pathPattern: '/env.json',
        proxyType: 'internal_rewrite',
        targetUrl: '/environments/production.json',
      });
      expect(errors).toEqual([]);
    });

    it('rejects a non-URL string on an external rule', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        targetUrl: 'not a url',
      });
      expect(propertiesWithErrors(errors)).toContain('targetUrl');
    });
  });

  describe('elided canonical pipeline payloads', () => {
    const pipelineConfig = {
      name: 'contact',
      steps: [{ handlerType: 'form_handler', config: { fields: {} } }],
    };

    it('accepts an absent targetUrl (targetUrl is optional; normalization fills the default later)', async () => {
      const errors = await validateRule({
        pathPattern: '/api/contact',
        method: 'POST',
        pipelineConfig,
      });
      expect(errors).toEqual([]);
    });

    it('accepts the pipeline default URL with an explicit proxyType', async () => {
      const errors = await validateRule({
        pathPattern: '/api/contact',
        method: 'POST',
        proxyType: 'pipeline',
        targetUrl: 'http://internal/pipeline',
        pipelineConfig,
      });
      expect(errors).toEqual([]);
    });

    it('accepts the pipeline default URL with an ELIDED proxyType (inferred from pipelineConfig)', async () => {
      // Without inference the base validator would reject http://internal/pipeline
      // as a non-internal HTTP URL — see IsValidSyncTargetUrl.
      const errors = await validateRule({
        pathPattern: '/api/contact',
        method: 'POST',
        targetUrl: 'http://internal/pipeline',
        pipelineConfig,
      });
      expect(errors).toEqual([]);
    });
  });

  describe('method whitelist (match-key protection)', () => {
    it('rejects a non-whitelisted method', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        method: 'FETCH',
        targetUrl: 'https://api.example.com',
      });
      expect(propertiesWithErrors(errors)).toContain('method');
    });

    it('rejects a lowercase method (uppercase HTTP methods only)', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        method: 'get',
        targetUrl: 'https://api.example.com',
      });
      expect(propertiesWithErrors(errors)).toContain('method');
    });

    it('rejects a non-whitelisted entry in methods[]', async () => {
      const errors = await validateRule({
        pathPattern: '/api/*',
        methods: ['GET', 'TRACE'],
        targetUrl: 'https://api.example.com',
      });
      expect(propertiesWithErrors(errors)).toContain('methods');
    });
  });
});

describe('SyncProxyRuleSetDto', () => {
  it('accepts a full payload (envelope extras, options, source)', async () => {
    const dto = plainToInstance(SyncProxyRuleSetDto, {
      version: 2,
      exportedAt: '2026-07-11T00:00:00.000Z',
      kind: 'bffless-proxy-rule-set',
      ruleSet: { name: 'studio', description: 'Studio API', environment: 'production' },
      rules: [{ pathPattern: '/api/*', targetUrl: 'https://api.example.com' }],
      schemas: [
        {
          id: 'f4b6e9a0-0000-4000-8000-000000000001',
          name: 'comments',
          fields: [{ name: 'body', type: 'text', required: true }],
        },
      ],
      options: { prune: true, dryRun: true, strictSchemas: true },
      source: {
        repo: 'bffless/apps',
        path: 'apps/studio/.bffless/proxy-rules/studio',
        gitSha: 'abc123',
      },
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a nested rule with a forbidden targetUrl', async () => {
    const dto = plainToInstance(SyncProxyRuleSetDto, {
      ruleSet: { name: 'studio' },
      rules: [{ pathPattern: '/api/*', targetUrl: 'http://10.0.0.5/admin' }],
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('rules');
  });

  it('rejects a payload without ruleSet.name', async () => {
    const dto = plainToInstance(SyncProxyRuleSetDto, {
      ruleSet: {},
      rules: [],
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('ruleSet');
  });
});
