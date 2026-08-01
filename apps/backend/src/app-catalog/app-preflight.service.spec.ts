// Thenable chainable db mock: every builder method returns the chain, and
// awaiting consumes the next queued result in await order. Mirrors
// blocklist.service.spec / request-log.service.spec / pipeline-schedules.service.spec
// (the house pattern) — declared above imports.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = [
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
    'delete',
    'returning',
  ];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) {
    chainable[method] = jest.fn(() => chainable);
  }
  chainable.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

// getCeVersion is a free function (not injected), so it's mocked per-test;
// satisfiesMin is kept real since it's pure and cheap to exercise for real.
jest.mock('./ce-version.util', () => ({
  getCeVersion: jest.fn(),
  satisfiesMin: jest.requireActual('./ce-version.util').satisfiesMin,
}));

import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { db } from '../db/client';
import { getCeVersion } from './ce-version.util';
import { AppPreflightService } from './app-preflight.service';
import type { LoadedBundle } from './app-bundle.service';
import type { AppManifest } from './app-manifest.types';
import type { ProjectsService } from '../projects/projects.service';
import type { ProxyRuleSetsService } from '../proxy-rules/proxy-rule-sets.service';
import type { BootstrapDnsPreflightService, PreflightCheck } from '../setup/bootstrap-dns-preflight.service';
import type { IStorageAdapter } from '../storage/storage.interface';

// Local fixture (not imported from app-manifest.util.spec.ts): that file's
// module graph pulls in compareSemver from ce-version.util, which the
// jest.mock above replaces with a bare getCeVersion/satisfiesMin stub and
// would break its own suite if evaluated in this file's module registry.
const TEST_MANIFEST: AppManifest = {
  schemaVersion: 1,
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  summary: 'Share files and folders with ACLs',
  requires: { presignedStorage: true, ceMin: '0.3.15' },
  install: {
    alias: 'handoff',
    deployment: { path: 'dist', basePath: '/apps/handoff/dist' },
    ruleSets: [
      { file: 'rulesets/handoff.json', attachToAlias: true },
      { file: 'rulesets/handoff-rss-feed.json', attachToAlias: true },
    ],
    domain: { subdomain: 'handoff', isPublic: true, isSpa: true },
    schedules: [],
    manualSteps: [],
  },
};

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeBundle(manifestOverrides: Partial<AppManifest> = {}): LoadedBundle {
  const manifest = { ...TEST_MANIFEST, ...manifestOverrides } as AppManifest;
  return {
    manifest,
    files: {
      'rulesets/handoff.json': encode(
        JSON.stringify({
          ruleSet: { name: 'handoff' },
          rules: [{ pathPattern: '/api/nodes', method: 'GET' }],
          schemas: [{ id: 's1', name: 'handoff_nodes', fields: [] }],
        }),
      ),
      'rulesets/handoff-rss-feed.json': encode(
        JSON.stringify({ ruleSet: { name: 'handoff-rss-feed' }, rules: [], schemas: [] }),
      ),
      'dist/index.html': encode('<!doctype html>ok'),
    },
    sha256: 'a'.repeat(64),
  };
}

const EMPTY_SYNC_RESPONSE = {
  ruleSetId: 'rs-1',
  created: [],
  updated: [],
  deleted: [],
  unchanged: [],
  pruneCandidates: [],
  schemaResolutions: [],
  missingSecrets: [],
  warnings: [],
  dryRun: true,
  setCreated: true,
};

function stubProjectGateDeps(proxyRuleSetsService: ProxyRuleSetsService): void {
  (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
    ruleSetId: 'rs-1',
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    pruneCandidates: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: [],
    dryRun: true,
    setCreated: true,
  });
  mockDb.__queue([]); // installedApps lookup
  mockDb.__queue([]); // ruleSet 1
  mockDb.__queue([]); // ruleSet 2
  mockDb.__queue([]); // alias
  mockDb.__queue([]); // domain
  mockDb.__queue([]); // cross-namespace
}

function buildService(
  overrides: {
    storageAdapter?: Partial<IStorageAdapter>;
    configValues?: Record<string, string | undefined>;
    dnsPreflight?: Partial<BootstrapDnsPreflightService>;
    proxyRuleSetsService?: Partial<ProxyRuleSetsService>;
    projectsService?: Partial<ProjectsService>;
    certStepService?: { plan?: jest.Mock };
  } = {},
) {
  const storageAdapter = (overrides.storageAdapter ?? {}) as IStorageAdapter;
  const configService = new ConfigService(overrides.configValues ?? {});
  const dnsPreflight = {
    probeHost: jest.fn(),
    ...overrides.dnsPreflight,
  } as unknown as BootstrapDnsPreflightService;
  const proxyRuleSetsService = {
    syncRuleSet: jest.fn(),
    ...overrides.proxyRuleSetsService,
  } as unknown as ProxyRuleSetsService;
  const projectsService = {
    projectExists: jest.fn().mockResolvedValue(false),
    ...overrides.projectsService,
  } as unknown as ProjectsService;

  const certStepService = {
    // Default: nothing to warn about (a wildcard covers the app host).
    plan: jest.fn().mockResolvedValue({ model: 'wildcard', action: 'covered' }),
    ...overrides.certStepService,
  } as never;

  const service = new AppPreflightService(
    storageAdapter,
    configService,
    dnsPreflight,
    proxyRuleSetsService,
    projectsService,
    certStepService,
  );

  return {
    service,
    storageAdapter,
    configService,
    dnsPreflight,
    proxyRuleSetsService,
    projectsService,
  };
}

describe('AppPreflightService', () => {
  beforeEach(() => {
    mockDb.__reset();
    (getCeVersion as jest.Mock).mockReset();
    (getCeVersion as jest.Mock).mockReturnValue('0.3.20');
  });

  describe('instanceGates > storage', () => {
    it('passes through when requires omits presignedStorage', async () => {
      const { service } = buildService();

      const gates = await service.instanceGates(undefined);

      const storage = gates.find((g) => g.id === 'storage');
      expect(storage).toMatchObject({ id: 'storage', status: 'pass' });
    });

    it('passes when presignedStorage is required and the adapter supports it', async () => {
      const { service } = buildService({
        storageAdapter: { supportsPresignedUrls: () => true },
      });

      const gates = await service.instanceGates({ presignedStorage: true });

      const storage = gates.find((g) => g.id === 'storage');
      expect(storage).toMatchObject({ id: 'storage', status: 'pass' });
    });

    it('fails with remediation naming MinIO, a real bucket, and local FS when required and unsupported', async () => {
      const { service } = buildService({ storageAdapter: {} }); // no supportsPresignedUrls at all -> ?? false

      const gates = await service.instanceGates({ presignedStorage: true });

      const storage = gates.find((g) => g.id === 'storage');
      expect(storage?.status).toBe('fail');
      expect(storage?.remediation).toMatch(/ENABLE_MINIO/);
      expect(storage?.remediation).toMatch(/bucket/i);
      expect(storage?.remediation).toMatch(/ENCRYPTION_KEY/);
      expect(storage?.remediation).toMatch(/FEATURE_LOCAL_PRESIGNED_UPLOADS/);
    });
  });

  describe('instanceGates > ce-version', () => {
    it('passes when requires omits ceMin', async () => {
      const { service } = buildService();

      const gates = await service.instanceGates(undefined);

      const version = gates.find((g) => g.id === 'ce-version');
      expect(version).toMatchObject({ id: 'ce-version', status: 'pass' });
    });

    it('fails closed with an "could not be determined" message when the running version is unknown', async () => {
      (getCeVersion as jest.Mock).mockReturnValue('unknown');
      const { service } = buildService();

      const gates = await service.instanceGates({ ceMin: '0.3.15' });

      const version = gates.find((g) => g.id === 'ce-version');
      expect(version?.status).toBe('fail');
      expect(version?.message).toMatch(/could not be determined/i);
    });

    it('fails when the running version is below the minimum', async () => {
      (getCeVersion as jest.Mock).mockReturnValue('0.3.10');
      const { service } = buildService();

      const gates = await service.instanceGates({ ceMin: '0.3.15' });

      const version = gates.find((g) => g.id === 'ce-version');
      expect(version?.status).toBe('fail');
      expect(version?.remediation).toBeTruthy();
    });

    it('passes when the running version satisfies the minimum', async () => {
      (getCeVersion as jest.Mock).mockReturnValue('0.3.15');
      const { service } = buildService();

      const gates = await service.instanceGates({ ceMin: '0.3.15' });

      const version = gates.find((g) => g.id === 'ce-version');
      expect(version).toMatchObject({ id: 'ce-version', status: 'pass' });
    });
  });

  describe('instanceGates > platform-config', () => {
    it('produces no platform-config gates when PLATFORM_MODE is not "true"', async () => {
      const { service } = buildService({ configValues: {} });

      const gates = await service.instanceGates(undefined);

      expect(gates.filter((g) => g.id.startsWith('platform-'))).toHaveLength(0);
    });

    it('fails the config check and adds the cert-coverage warn when platform mode lacks CONTROL_PLANE_URL/WORKSPACE_ID', async () => {
      const { service } = buildService({ configValues: { PLATFORM_MODE: 'true' } });

      const gates = await service.instanceGates(undefined);

      const platformGates = gates.filter((g) => g.id.startsWith('platform-'));
      expect(platformGates).toHaveLength(2);
      expect(platformGates.find((g) => g.status === 'fail')?.id).toBe('platform-config');
      const warn = platformGates.find((g) => g.status === 'warn');
      expect(warn?.id).toBe('platform-cert-scope');
      expect(warn?.message).toMatch(/wildcard/i);
    });

    it('passes the config check and still adds the cert-coverage warn when configured', async () => {
      const { service } = buildService({
        configValues: {
          PLATFORM_MODE: 'true',
          CONTROL_PLANE_URL: 'https://cp.example.com',
          WORKSPACE_ID: 'ws-1',
        },
      });

      const gates = await service.instanceGates(undefined);

      const platformGates = gates.filter((g) => g.id.startsWith('platform-'));
      expect(platformGates).toHaveLength(2);
      expect(platformGates.find((g) => g.status === 'fail')).toBeFalsy();
      expect(platformGates.find((g) => g.status === 'pass')?.id).toBe('platform-config');
      expect(platformGates.find((g) => g.status === 'warn')?.id).toBe('platform-cert-scope');
    });

    // ce#584: both platform gates shipped with id 'platform-config', and the
    // install dialog renders `key={gate.id}` — duplicate React keys on the one
    // path where two gates always appear together.
    it('gives every emitted gate a unique id', async () => {
      const { service } = buildService({
        configValues: {
          PLATFORM_MODE: 'true',
          CONTROL_PLANE_URL: 'https://cp.example.com',
          WORKSPACE_ID: 'ws-1',
        },
      });

      const gates = await service.instanceGates(undefined);

      const ids = gates.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ce#584: on a direct-serving instance with no wildcard, an app subdomain
  // CANNOT be served over HTTPS — a per-app certificate never reaches its
  // vhost. The operator must learn that in the install dialog, BEFORE
  // committing, not from a manual step afterwards. Warn, never block.
  describe('projectGates > app-host-tls (ce#584)', () => {
    it('BLOCKS when direct serving has no wildcard: an app must never be served over plain HTTP', async () => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
        dnsPreflight: { probeHost: jest.fn().mockResolvedValue({ host: 'h', resolvedIps: [], probeOk: true }) },
        certStepService: {
          plan: jest.fn().mockResolvedValue({ model: 'direct-no-wildcard', action: 'report' }),
        },
      });

      stubProjectGateDeps(proxyRuleSetsService);
      const { gates } = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const tls = gates.find((g) => g.id === 'app-host-tls');
      expect(tls).toBeDefined();
      expect(tls!.status).toBe('fail');
      expect(tls!.message.toLowerCase()).toContain('http');
      expect(tls!.remediation?.toLowerCase()).toContain('wildcard');
      expect(tls!.deepLink).toBe('/domains');
      // Retryable: provisioning a wildcard is minutes away, and re-running the
      // same preflight then passes — unlike a name collision.
      expect(tls!.retryable).toBe(true);
    });

    it.each([
      ['wildcard', { model: 'wildcard', action: 'covered' }],
      ['edge-terminated', { model: 'edge-terminated', action: 'none-needed' }],
      ['platform', { model: 'platform', action: 'delegated' }],
      ['unknown', { model: 'unknown', action: 'report' }],
    ])('emits no TLS warning on a %s instance — HTTPS already works there', async (_label, plan) => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
        dnsPreflight: { probeHost: jest.fn().mockResolvedValue({ host: 'h', resolvedIps: [], probeOk: true }) },
        certStepService: { plan: jest.fn().mockResolvedValue(plan) },
      });

      stubProjectGateDeps(proxyRuleSetsService);
      const { gates } = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(gates.find((g) => g.id === 'app-host-tls')).toBeUndefined();
    });

    it('emits no TLS gate when the app declares no domain at all', async () => {
      const bundle = makeBundle({
        install: { ...TEST_MANIFEST.install, domain: undefined },
      } as Partial<AppManifest>);
      const certPlan = jest.fn();
      const { service, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
        certStepService: { plan: certPlan },
      });

      stubProjectGateDeps(proxyRuleSetsService);
      const { gates } = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(gates.find((g) => g.id === 'app-host-tls')).toBeUndefined();
      expect(certPlan).not.toHaveBeenCalled();
    });

    it('never fails the preflight when the cert plan itself throws', async () => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
        dnsPreflight: { probeHost: jest.fn().mockResolvedValue({ host: 'h', resolvedIps: [], probeOk: true }) },
        certStepService: { plan: jest.fn().mockRejectedValue(new Error('boom')) },
      });

      stubProjectGateDeps(proxyRuleSetsService);
      const { gates } = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(gates.find((g) => g.id === 'app-host-tls')).toBeUndefined();
      expect(gates.some((g) => g.status === 'fail')).toBe(false);
    });
  });

  describe('projectGates > appHost', () => {
    it('is null when the manifest declares no install.domain', async () => {
      const bundle = makeBundle({
        install: { ...TEST_MANIFEST.install, domain: undefined },
      } as Partial<AppManifest>);
      const { service, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue(EMPTY_SYNC_RESPONSE);
      mockDb.__queue([]); // installedApps lookup
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(result.appHost).toBeNull();
    });

    it('is "<sub>.<PRIMARY_DOMAIN>" when the manifest declares install.domain', async () => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService, dnsPreflight } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
        ruleSetId: 'rs-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [],
        missingSecrets: [],
        warnings: [],
        dryRun: true,
        setCreated: true,
      });
      mockDb.__queue([]); // installedApps lookup
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(result.appHost).toBe('handoff.example.com');
    });
  });

  describe('projectGates > subdomain override', () => {
    it('uses the override for appHost and as the DNS probe target', async () => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService, dnsPreflight } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'my-app.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue(EMPTY_SYNC_RESPONSE);
      mockDb.__queue([]); // installedApps lookup
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(
        bundle,
        { projectId: 'proj-1' },
        'user-1',
        'my-app',
      );

      expect(result.appHost).toBe('my-app.example.com');
      expect(dnsPreflight.probeHost).toHaveBeenCalledWith('my-app.example.com', {
        mode: 'reachability',
      });
      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('pass');
      const nameCollision = result.gates.find((g) => g.id === 'name-collision');
      expect(nameCollision?.status).toBe('pass');
    });

    it('fails the name-collision gate with a clear message when the override is a reserved subdomain', async () => {
      const bundle = makeBundle();
      const { service, proxyRuleSetsService, dnsPreflight } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'admin.example.com',
        resolvedIps: [],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue(EMPTY_SYNC_RESPONSE);
      mockDb.__queue([]); // installedApps lookup
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1', 'admin');

      const nameCollision = result.gates.find((g) => g.id === 'name-collision');
      expect(nameCollision?.status).toBe('fail');
      expect(nameCollision?.message).toMatch(/reserved/i);
    });

    it('rejects an override when the manifest declares no install.domain', async () => {
      const bundle = makeBundle({
        install: { ...TEST_MANIFEST.install, domain: undefined },
      } as Partial<AppManifest>);
      const { service } = buildService({ configValues: { PRIMARY_DOMAIN: 'example.com' } });

      await expect(
        service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1', 'my-app'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('projectGates > dns', () => {
    it('passes with a note when the manifest declares no install.domain (probeHost not called)', async () => {
      const bundle = makeBundle({
        install: { ...TEST_MANIFEST.install, domain: undefined },
      } as Partial<AppManifest>);
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue(EMPTY_SYNC_RESPONSE);
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns).toMatchObject({ id: 'dns', status: 'pass' });
      expect(dnsPreflight.probeHost).not.toHaveBeenCalled();
    });

    it('passes when probeHost succeeds', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
        ruleSetId: 'rs-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [],
        missingSecrets: [],
        warnings: [],
        dryRun: true,
        setCreated: true,
      });
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns).toMatchObject({ id: 'dns', status: 'pass' });
      // Reachability mode, not the ACME gate — see dnsGate's comment.
      expect(dnsPreflight.probeHost).toHaveBeenCalledWith('handoff.example.com', {
        mode: 'reachability',
      });
    });

    it('fails as retryable with the exact record to add and resolved IPs when probeHost fails', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: [],
        probeOk: false,
        error: 'Hostname does not resolve yet',
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
        ruleSetId: 'rs-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [],
        missingSecrets: [],
        warnings: [],
        dryRun: true,
        setCreated: true,
      });
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('fail');
      expect(dns?.retryable).toBe(true);
      expect(dns?.message).toMatch(/Hostname does not resolve yet/);
      expect(dns?.message).toMatch(/resolved ips/i);
      expect(dns?.remediation).toMatch(/CNAME/);
      expect(dns?.remediation).toMatch(/handoff/);
      expect(dns?.remediation).toMatch(/example\.com/);
    });

    // A proxied instance can only ever get the weaker HTTPS answer, so the
    // gate's wording has to stop over-claiming. These lock that in.
    function buildDnsCase(check: PreflightCheck) {
      const bundle = makeBundle();
      const built = buildService({ configValues: { PRIMARY_DOMAIN: 'example.com' } });
      (built.dnsPreflight.probeHost as jest.Mock).mockResolvedValue(check);
      (built.proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue(EMPTY_SYNC_RESPONSE);
      for (let i = 0; i < 6; i++) mockDb.__queue([]);
      return { bundle, ...built };
    }

    it('on a proxied instance, a passing HTTPS probe says HTTPS and admits it cannot prove the origin', async () => {
      const { service, bundle } = buildDnsCase({
        host: 'handoff.example.com',
        resolvedIps: ['104.21.1.1'],
        probeOk: true,
        probeKind: 'https-reachability',
        status: 404,
      });

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('pass');
      expect(dns?.message).toMatch(/HTTPS/);
      expect(dns?.message).toMatch(/HTTP 404/);
      expect(dns?.message).toMatch(/cannot prove/i);
      expect(dns?.message).toMatch(/104\.21\.1\.1/);
    });

    it('a Cloudflare 520 fails with an origin-down message, not a "fix your DNS" message', async () => {
      const { service, bundle } = buildDnsCase({
        host: 'handoff.example.com',
        resolvedIps: ['104.21.1.1'],
        probeOk: false,
        probeKind: 'https-reachability',
        status: 520,
        failure: 'origin-error',
        error:
          'The proxy in front of handoff.example.com returned HTTP 520 — it could not reach an origin',
      });

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('fail');
      expect(dns?.retryable).toBe(true);
      expect(dns?.message).toMatch(/HTTP 520/);
      expect(dns?.message).toMatch(/DNS is fine/i);
      expect(dns?.remediation).toMatch(/serving handoff\.example\.com/);
      // Still names the exact record, in case the record really is missing.
      expect(dns?.remediation).toMatch(/CNAME/);
    });

    it('a 502 behind a generic proxy fails with a backend-down message, not an origin-unreachable one', async () => {
      const { service, bundle } = buildDnsCase({
        host: 'handoff.example.com',
        resolvedIps: ['203.0.113.7'],
        probeOk: false,
        probeKind: 'https-reachability',
        status: 502,
        failure: 'origin-down',
        error:
          'The proxy in front of handoff.example.com returned HTTP 502 — it reached this server, but ' +
          'the backend behind it did not return a valid response',
      });

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('fail');
      expect(dns?.retryable).toBe(true);
      expect(dns?.message).toMatch(/HTTP 502/);
      expect(dns?.message).toMatch(/DNS is fine/i);
      expect(dns?.message).toMatch(/backend is not serving requests/i);
      // Different remedy from the Cloudflare 520 case: fix the backend, not DNS.
      expect(dns?.remediation).toMatch(/backend is running/i);
      expect(dns?.remediation).not.toMatch(/CNAME/);
    });

    it('a refused connection keeps the DNS-record remediation', async () => {
      const { service, bundle } = buildDnsCase({
        host: 'handoff.example.com',
        resolvedIps: [],
        probeOk: false,
        probeKind: 'https-reachability',
        failure: 'no-response',
        error: 'connect ECONNREFUSED 104.21.1.1:443',
      });

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dns = result.gates.find((g) => g.id === 'dns');
      expect(dns?.status).toBe('fail');
      expect(dns?.retryable).toBe(true);
      expect(dns?.message).toMatch(/ECONNREFUSED/);
      expect(dns?.remediation).toMatch(/CNAME record "handoff"/);
    });
  });

  describe('projectGates > name-collision (existing project target)', () => {
    function queueNoDnsCall(dnsPreflight: BootstrapDnsPreflightService) {
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
    }

    function stubSyncRuleSetPassthrough(proxyRuleSetsService: ProxyRuleSetsService) {
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
        ruleSetId: 'rs-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [],
        missingSecrets: [],
        warnings: [],
        dryRun: true,
        setCreated: true,
      });
    }

    it('passes when nothing collides', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision).toMatchObject({ id: 'name-collision', status: 'pass' });
    });

    it('fails when a same-named rule set exists and is not part of this app install', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([]); // installedApps: no prior install
      mockDb.__queue([{ id: 'rs-foreign', projectId: 'proj-1', name: 'handoff' }]); // ruleSet 1 collides
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
      expect(collision?.remediation).toBeTruthy();
    });

    it('does not fail when the colliding rule set belongs to this app\'s existing install (update path)', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([
        { id: 'install-1', appId: 'handoff', projectId: 'proj-1', alias: 'handoff', domainId: null, ruleSetIds: ['rs-1'] },
      ]); // installedApps: existing install owns rs-1
      mockDb.__queue([{ id: 'rs-1', projectId: 'proj-1', name: 'handoff' }]); // ruleSet 1, owned
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias (no row -> pass, alias belongs to install anyway)
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision).toMatchObject({ id: 'name-collision', status: 'pass' });
    });

    it('fails when the alias is already used by another deployment in the project', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([{ id: 'alias-1', projectId: 'proj-1', alias: 'handoff' }]); // alias collides
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
    });

    it('fails when the domain is already mapped and not owned by this app\'s install', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([{ id: 'dom-1', domain: 'handoff.example.com', projectId: 'other-proj' }]); // domain collides
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
    });

    it('does not fail on a domain owned by this app\'s existing install', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([
        { id: 'install-1', appId: 'handoff', projectId: 'proj-1', alias: 'handoff', domainId: 'dom-1', ruleSetIds: [] },
      ]); // installedApps: owns dom-1
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([{ id: 'dom-1', domain: 'handoff.example.com', projectId: 'proj-1' }]); // domain, owned
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision).toMatchObject({ id: 'name-collision', status: 'pass' });
    });

    it('fails via the cross-namespace trap when another project owns an alias matching the subdomain', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      queueNoDnsCall(dnsPreflight);
      stubSyncRuleSetPassthrough(proxyRuleSetsService);
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias (no same-project collision)
      mockDb.__queue([]); // domain
      mockDb.__queue([{ id: 'alias-foreign', projectId: 'other-proj', alias: 'handoff' }]); // cross-namespace trap

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
      expect(collision?.message).toMatch(/wildcard/i);
    });
  });

  describe('projectGates > name-collision (newProject target)', () => {
    it('only checks domain + cross-namespace collisions (no rule-set/alias db reads)', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({});
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(
        bundle,
        { newProject: { owner: 'acme', name: 'demo' } },
        'user-1',
      );

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision).toMatchObject({ id: 'name-collision', status: 'pass' });
      expect(proxyRuleSetsService.syncRuleSet).not.toHaveBeenCalled();
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('fails when the "new" project already exists, pointing at the picker instead', async () => {
      // Every project-scoped check (rule-set names, alias, this app's own
      // install row) is skipped for a newProject target — adopting an
      // existing project would sail past all of them, and its pre-existing
      // alias would end up in createdResources for a later undo to delete.
      const bundle = makeBundle();
      const { service, dnsPreflight, projectsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
        projectsService: { projectExists: jest.fn().mockResolvedValue(true) },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(
        bundle,
        { newProject: { owner: 'acme', name: 'demo' } },
        'user-1',
      );

      expect(projectsService.projectExists).toHaveBeenCalledWith('acme', 'demo');
      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
      expect(collision?.message).toMatch(/project named "acme\/demo" already exists/i);
      expect(collision?.remediation).toMatch(/picker/i);
    });

    it('fails when the domain is already mapped for a newProject target', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      mockDb.__queue([{ id: 'dom-1', domain: 'handoff.example.com', projectId: 'other-proj' }]); // domain collides
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(
        bundle,
        { newProject: { owner: 'acme', name: 'demo' } },
        'user-1',
      );

      const collision = result.gates.find((g) => g.id === 'name-collision');
      expect(collision?.status).toBe('fail');
    });
  });

  describe('projectGates > data-tables + syncPlans', () => {
    it('summarizes a dryRun sync plan from the response, warning (not failing) on schema field mismatch', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock)
        .mockResolvedValueOnce({
          ruleSetId: 'rs-1',
          created: [{ pathPattern: '/api/nodes', method: 'GET' }],
          updated: [],
          deleted: [],
          unchanged: [],
          pruneCandidates: [],
          schemaResolutions: [
            { name: 'handoff_nodes', action: 'reuse', targetSchemaId: 'x', fieldMismatch: true },
          ],
          missingSecrets: [],
          warnings: [],
          dryRun: true,
          setCreated: false,
        })
        .mockResolvedValueOnce({
          ruleSetId: 'rs-2',
          created: [],
          updated: [],
          deleted: [],
          unchanged: [],
          pruneCandidates: [],
          schemaResolutions: [],
          missingSecrets: [],
          warnings: [],
          dryRun: true,
          setCreated: true,
        });
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      expect(result.syncPlans).toEqual([
        {
          ruleSet: 'handoff',
          created: 1,
          updated: 0,
          unchanged: 0,
          pruneCandidates: 0,
          schemaResolutions: [{ name: 'handoff_nodes', action: 'reuse', fieldMismatch: true }],
        },
        {
          ruleSet: 'handoff-rss-feed',
          created: 0,
          updated: 0,
          unchanged: 0,
          pruneCandidates: 0,
          schemaResolutions: [],
        },
      ]);

      expect(proxyRuleSetsService.syncRuleSet).toHaveBeenNthCalledWith(
        1,
        'proj-1',
        expect.objectContaining({
          ruleSet: { name: 'handoff' },
          options: { dryRun: true },
        }),
        'user-1',
        'admin',
        null,
      );

      const dataTables = result.gates.find((g) => g.id === 'data-tables');
      expect(dataTables?.status).toBe('warn');
      expect(dataTables?.message).toMatch(/handoff_nodes/);
    });

    it('passes when no schema has a field mismatch', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      (proxyRuleSetsService.syncRuleSet as jest.Mock).mockResolvedValue({
        ruleSetId: 'rs-1',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [],
        missingSecrets: [],
        warnings: [],
        dryRun: true,
        setCreated: false,
      });
      mockDb.__queue([]); // installedApps
      mockDb.__queue([]); // ruleSet 1
      mockDb.__queue([]); // ruleSet 2
      mockDb.__queue([]); // alias
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(bundle, { projectId: 'proj-1' }, 'user-1');

      const dataTables = result.gates.find((g) => g.id === 'data-tables');
      expect(dataTables).toMatchObject({ id: 'data-tables', status: 'pass' });
    });

    it('synthesizes all-create summaries for a newProject target without calling syncRuleSet', async () => {
      const bundle = makeBundle();
      const { service, dnsPreflight, proxyRuleSetsService } = buildService({
        configValues: { PRIMARY_DOMAIN: 'example.com' },
      });
      (dnsPreflight.probeHost as jest.Mock).mockResolvedValue({
        host: 'handoff.example.com',
        resolvedIps: ['1.2.3.4'],
        probeOk: true,
      } as PreflightCheck);
      mockDb.__queue([]); // domain
      mockDb.__queue([]); // cross-namespace

      const result = await service.projectGates(
        bundle,
        { newProject: { owner: 'acme', name: 'demo' } },
        'user-1',
      );

      expect(proxyRuleSetsService.syncRuleSet).not.toHaveBeenCalled();
      expect(result.syncPlans).toEqual([
        {
          ruleSet: 'handoff',
          created: 1,
          updated: 0,
          unchanged: 0,
          pruneCandidates: 0,
          schemaResolutions: [{ name: 'handoff_nodes', action: 'create', fieldMismatch: false }],
        },
        {
          ruleSet: 'handoff-rss-feed',
          created: 0,
          updated: 0,
          unchanged: 0,
          pruneCandidates: 0,
          schemaResolutions: [],
        },
      ]);

      const dataTables = result.gates.find((g) => g.id === 'data-tables');
      expect(dataTables).toMatchObject({ id: 'data-tables', status: 'pass' });
    });
  });
});
