import 'reflect-metadata';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { lookup as dnsLookup } from 'node:dns/promises';
import { ProxyRuleSetsController } from './proxy-rule-sets.controller';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { guardRuleTargets } from './target-url.guard';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const mockDnsLookup = dnsLookup as unknown as jest.Mock;

/**
 * What the outbound target guard (#780) can and cannot see on the two
 * rules-as-code HTTP doors, through the SAME global ValidationPipe as
 * main.ts. The sync and import DTOs already enforce the protocol rule
 * (`IsValidSyncTargetUrl` / `IsValidTargetUrlOrPath`: HTTPS, or HTTP only to
 * an explicitly internal host) as an unconditional 400 — so for a plain-http
 * public target the service, and with it `OUTBOUND_URL_GUARD`, is never
 * reached. The DTOs do NOT enforce the named-internal-host / IP-literal rules
 * or the resolve check; those targets pass the pipe and the guard judges
 * them by mode.
 *
 * The service is a stub that runs the real `guardRuleTargets` over the DTO
 * the pipe delivered — the DB-backed composition is proxy-rule-sets.service.spec.ts's
 * job; this spec pins what the pipe lets through.
 */
describe('rules-as-code HTTP doors × OUTBOUND_URL_GUARD (#780)', () => {
  const PROJECT = '11111111-1111-4111-8111-111111111111';
  const envBefore = process.env.OUTBOUND_URL_GUARD;
  let app: INestApplication;

  const syncRuleSet = jest.fn(async (_projectId: string, dto: { rules?: unknown[] }) => ({
    ruleSetId: 'set-1',
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    pruneCandidates: [],
    preserved: [],
    merged: [],
    conflicts: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: await guardRuleTargets((dto.rules ?? []) as never),
    dryRun: false,
    setCreated: true,
  }));
  const importRuleSet = jest.fn(async (_projectId: string, dto: { rules?: unknown[] }) => ({
    id: 'set-1',
    warnings: await guardRuleTargets((dto.rules ?? []) as never),
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProxyRuleSetsController],
      providers: [
        { provide: ProxyRuleSetsService, useValue: { syncRuleSet, importRuleSet } },
        { provide: ProxyRulesService, useValue: {} },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = {
            id: 'user-1',
            role: 'admin',
            apiKeyProjectId: null,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    // Exactly main.ts's pipe.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDnsLookup.mockResolvedValue([{ address: '104.18.1.1', family: 4 }]);
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env.OUTBOUND_URL_GUARD;
    else process.env.OUTBOUND_URL_GUARD = envBefore;
  });

  const syncBody = (targetUrl: string) => ({
    ruleSet: { name: 'api-backend' },
    rules: [{ pathPattern: '/api/*', targetUrl }],
  });
  const importBody = (targetUrl: string) => ({
    ruleSet: { name: 'Imported Set' },
    rules: [{ pathPattern: '/api/*', targetUrl }],
  });
  const putSync = (targetUrl: string) =>
    request(app.getHttpServer())
      .put(`/api/proxy-rule-sets/project/${PROJECT}/sync`)
      .send(syncBody(targetUrl));
  const postImport = (targetUrl: string) =>
    request(app.getHttpServer())
      .post(`/api/proxy-rule-sets/project/${PROJECT}/import`)
      .send(importBody(targetUrl));

  describe('the protocol rule is the DTO’s, unconditional, before the service', () => {
    it.each(['warn', 'reject'])(
      'PUT …/sync with http://public.example is a 400 from the pipe in mode %s; the service never runs',
      async (mode) => {
        process.env.OUTBOUND_URL_GUARD = mode;
        const res = await putSync('http://public.example');
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body.message)).toContain(
          'targetUrl must be HTTPS, or HTTP for internal services',
        );
        expect(syncRuleSet).not.toHaveBeenCalled();
        expect(mockDnsLookup).not.toHaveBeenCalled();
      },
    );

    it.each(['warn', 'reject'])(
      'POST …/import with http://public.example is a 400 from the pipe in mode %s; the service never runs',
      async (mode) => {
        process.env.OUTBOUND_URL_GUARD = mode;
        const res = await postImport('http://public.example');
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body.message)).toContain(
          'targetUrl must be HTTPS, or HTTP for internal services',
        );
        expect(importRuleSet).not.toHaveBeenCalled();
      },
    );
  });

  describe('the named-internal-host / IP-literal rules pass the pipe and follow the mode', () => {
    it('sync, warn: https://10.0.0.1 reaches the service and comes back as a warning', async () => {
      delete process.env.OUTBOUND_URL_GUARD;
      const res = await putSync('https://10.0.0.1');
      expect(res.status).toBe(200);
      expect(syncRuleSet).toHaveBeenCalledTimes(1);
      expect(res.body.warnings).toEqual([
        'Rule "/api/*": target https://10.0.0.1 — Target URL cannot point to internal IP ranges; allowed because OUTBOUND_URL_GUARD=warn',
      ]);
    });

    it('sync, reject: https://10.0.0.1 reaches the service and is the guard’s 400', async () => {
      process.env.OUTBOUND_URL_GUARD = 'reject';
      const res = await putSync('https://10.0.0.1');
      expect(res.status).toBe(400);
      expect(syncRuleSet).toHaveBeenCalledTimes(1);
      expect(res.body.message).toBe(
        'Proxy rule targets refused by OUTBOUND_URL_GUARD=reject: Rule "/api/*": target https://10.0.0.1 — Target URL cannot point to internal IP ranges',
      );
    });

    it('import, warn / reject: https://169.254.169.254 reaches the service and follows the mode', async () => {
      delete process.env.OUTBOUND_URL_GUARD;
      const warn = await postImport('https://169.254.169.254');
      expect(warn.status).toBe(201);
      expect(warn.body.warnings).toEqual([
        'Rule "/api/*": target https://169.254.169.254 — Target URL cannot point to internal services; allowed because OUTBOUND_URL_GUARD=warn',
      ]);

      process.env.OUTBOUND_URL_GUARD = 'reject';
      const reject = await postImport('https://169.254.169.254');
      expect(reject.status).toBe(400);
      expect(reject.body.message).toContain('refused by OUTBOUND_URL_GUARD=reject');
      expect(importRuleSet).toHaveBeenCalledTimes(2);
    });
  });

  describe('the resolve check passes the pipe and follows the mode', () => {
    it('sync: a public name resolving to a private address is a warning under warn and a 400 under reject', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

      delete process.env.OUTBOUND_URL_GUARD;
      const warn = await putSync('https://intranet.example');
      expect(warn.status).toBe(200);
      expect(warn.body.warnings).toEqual([
        'Rule "/api/*": target https://intranet.example — intranet.example resolves to a non-public address (10.0.0.5); allowed because OUTBOUND_URL_GUARD=warn',
      ]);

      process.env.OUTBOUND_URL_GUARD = 'reject';
      const reject = await putSync('https://intranet.example');
      expect(reject.status).toBe(400);
      expect(reject.body.message).toContain('intranet.example resolves to a non-public address');
      expect(mockDnsLookup).toHaveBeenCalledWith(
        'intranet.example',
        expect.objectContaining({ all: true }),
      );
    });
  });
});
