// Thenable chainable db mock: every builder method returns the chain, and
// awaiting consumes the next queued result in await order. Mirrors
// pipeline-schedules.service.spec / app-preflight.service.spec (the house
// pattern) — declared above imports.
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
  chainable.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) {
      (chainable[method] as jest.Mock).mockClear();
    }
  };
  return { db: chainable };
});

import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { db } from '../db/client';
import { AppInstallJobsService } from './app-install-jobs.service';
import { AppInstallerService } from './app-installer.service';
import type { AppManifest, AppRegistryEntry } from './app-manifest.types';
import type { LoadedBundle } from './app-bundle.service';
import type { CreatedResources } from '../db/schema';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

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
      { file: 'rulesets/handoff-rss-feed.json', attachToAlias: false },
    ],
    domain: { subdomain: 'handoff', isPublic: true, isSpa: true },
    schedules: [],
    manualSteps: [
      {
        id: 'bucket-cors',
        title: 'Configure bucket CORS',
        body: 'Allow PUT from your app origin on the storage bucket.',
        appliesWhen: 'bucketStorage',
      },
      {
        id: 'platform-only',
        title: 'Platform only step',
        body: 'Never applies on a self-hosted box.',
        appliesWhen: 'platformMode',
      },
    ],
  },
  eject: {
    repo: 'bffless/apps',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    variables: ['BFFLESS_URL'],
    secrets: ['BFFLESS_API_KEY'],
  },
};

const ENTRY: AppRegistryEntry = {
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  bundleUrl: 'https://example.com/handoff.zip',
  sha256: 'a'.repeat(64),
  requires: TEST_MANIFEST.requires,
};

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeBundle(
  overrides: Partial<AppManifest> = {},
  ruleSetJson?: unknown,
  build?: LoadedBundle['build'],
): LoadedBundle {
  const manifest = { ...TEST_MANIFEST, ...overrides } as AppManifest;
  return {
    manifest,
    build,
    files: {
      'rulesets/handoff.json': encode(
        JSON.stringify(
          ruleSetJson ?? {
            version: 2,
            kind: 'proxy-rule-set',
            ruleSet: { name: 'handoff', description: 'Handoff API' },
            rules: [
              { pathPattern: '/api/nodes', method: 'GET', targetUrl: 'https://api.example.com' },
            ],
            schemas: [],
          },
        ),
      ),
      'rulesets/handoff-rss-feed.json': encode(
        JSON.stringify({ ruleSet: { name: 'handoff-rss-feed' }, rules: [], schemas: [] }),
      ),
      'dist/index.html': encode('<!doctype html>ok'),
      'dist/assets/app.js': encode('console.log(1)'),
      'README.md': encode('not deployed'),
    },
    sha256: 'a'.repeat(64),
  };
}

function syncResponse(overrides: Record<string, unknown> = {}) {
  return {
    ruleSetId: 'rs-1',
    created: [{ pathPattern: '/api/nodes', method: 'GET' }],
    updated: [],
    deleted: [],
    unchanged: [],
    pruneCandidates: [],
    preserved: [],
    merged: [],
    conflicts: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: [],
    dryRun: false,
    setCreated: true,
    ...overrides,
  };
}

function deployResponse(overrides: Record<string, unknown> = {}) {
  return {
    deploymentId: 'dep-1',
    commitSha: 'a'.repeat(40),
    fileCount: 2,
    totalSize: 100,
    urls: {
      sha: 'https://admin.example.com/sha',
      default: 'https://admin.example.com/alias/handoff',
    },
    aliases: ['handoff'],
    ...overrides,
  };
}

const INSTALLED_ROW = {
  id: 'ia-1',
  appId: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  projectId: 'proj-1',
  alias: 'handoff',
  domainId: null,
  deploymentId: null,
  ruleSetIds: [] as string[],
  schemaIds: [] as string[],
  bundleSha256: 'a'.repeat(64),
  manifest: TEST_MANIFEST,
  status: 'installing',
  createdResources: {} as CreatedResources,
  installedBy: 'user-1',
  installedAt: new Date(),
  updatedAt: new Date(),
};

describe('AppInstallerService', () => {
  let jobs: AppInstallJobsService;
  let service: AppInstallerService;
  let bundleService: { fetchBundle: jest.Mock };
  let preflight: { instanceGates: jest.Mock; projectGates: jest.Mock };
  let certStep: { plan: jest.Mock; execute: jest.Mock; schemeFor: jest.Mock };
  let ruleSets: { syncRuleSet: jest.Mock; delete: jest.Mock };
  let deployments: {
    createDeploymentFromFiles: jest.Mock;
    deleteDeployment: jest.Mock;
    deleteAlias: jest.Mock;
  };
  let domains: { create: jest.Mock; remove: jest.Mock };
  let projects: {
    findOrCreateProject: jest.Mock;
    projectExists: jest.Mock;
    getProjectById: jest.Mock;
    deleteProject: jest.Mock;
  };
  let schedules: {
    listPipelineRules: jest.Mock;
    listSchedules: jest.Mock;
    createSchedule: jest.Mock;
    deleteSchedule: jest.Mock;
  };
  let schemas: { delete: jest.Mock; getByIdWithCount: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    mockDb.__reset();
    jobs = new AppInstallJobsService();
    bundleService = { fetchBundle: jest.fn().mockResolvedValue(makeBundle()) };
    preflight = {
      instanceGates: jest
        .fn()
        .mockResolvedValue([{ id: 'storage', status: 'pass', message: 'ok' }]),
      projectGates: jest.fn().mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [],
        appHost: 'handoff.example.com',
      }),
    };
    certStep = {
      plan: jest.fn().mockResolvedValue({ model: 'wildcard', action: 'covered' }),
      execute: jest.fn().mockResolvedValue({ status: 'done', detail: 'covered by wildcard' }),
      // Default: a certificate covers the app host, so app URLs are https.
      // Scheme selection itself is covered in app-cert-step.service.spec.ts.
      schemeFor: jest.fn().mockResolvedValue('https'),
    };
    ruleSets = {
      syncRuleSet: jest
        .fn()
        .mockResolvedValueOnce(syncResponse({ ruleSetId: 'rs-1' }))
        .mockResolvedValueOnce(syncResponse({ ruleSetId: 'rs-2' })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    deployments = {
      createDeploymentFromFiles: jest.fn().mockResolvedValue(deployResponse()),
      deleteDeployment: jest.fn().mockResolvedValue(undefined),
      deleteAlias: jest.fn().mockResolvedValue(undefined),
    };
    domains = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'dom-1', domain: 'handoff.example.com', sslEnabled: true }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    projects = {
      findOrCreateProject: jest
        .fn()
        .mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
      projectExists: jest.fn().mockResolvedValue(true),
      getProjectById: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
      deleteProject: jest.fn().mockResolvedValue(undefined),
    };
    schedules = {
      listPipelineRules: jest.fn().mockResolvedValue([]),
      listSchedules: jest.fn().mockResolvedValue([]),
      createSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      deleteSchedule: jest.fn().mockResolvedValue(undefined),
    };
    schemas = {
      delete: jest.fn().mockResolvedValue(undefined),
      getByIdWithCount: jest.fn((id: string) => Promise.resolve({ id, name: id, recordCount: 0 })),
    };
    config = {
      get: jest.fn((key: string) => (key === 'PRIMARY_DOMAIN' ? 'example.com' : undefined)),
    };

    service = new AppInstallerService(
      jobs,
      bundleService as never,
      preflight as never,
      certStep as never,
      ruleSets as never,
      deployments as never,
      domains as never,
      projects as never,
      schedules as never,
      schemas as never,
      config as unknown as ConfigService,
      { supportsPresignedUrls: () => true } as never,
    );
  });

  /** Queue the three db awaits a successful install performs. */
  function queueInstallDb(existing: unknown[] = []) {
    mockDb.__queue(existing); // select existing installed_apps row
    mockDb.__queue([INSTALLED_ROW]); // insert/update ... returning
    mockDb.__queue([]); // final record update
  }

  describe('startInstall — happy path', () => {
    it('runs every step, in order, and reports the job as succeeded', async () => {
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('succeeded');
      expect(job.steps.map((s) => s.id)).toEqual([
        'preflight',
        'fetch',
        'sync-rules',
        'deploy',
        'domain',
        'certificate',
        'schedules',
        'record',
      ]);
      expect(job.steps.filter((s) => s.status === 'failed')).toHaveLength(0);
      expect(job.steps.find((s) => s.id === 'schedules')!.status).toBe('skipped');
      expect(job.installedAppId).toBe('ia-1');
      expect(job.projectId).toBe('proj-1');
    });

    it('syncs rule sets before deploying (a deploy cannot attach unsynced sets)', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(ruleSets.syncRuleSet).toHaveBeenCalledTimes(2);
      expect(ruleSets.syncRuleSet.mock.invocationCallOrder[1]).toBeLessThan(
        deployments.createDeploymentFromFiles.mock.invocationCallOrder[0],
      );
      expect(deployments.createDeploymentFromFiles.mock.invocationCallOrder[0]).toBeLessThan(
        domains.create.mock.invocationCallOrder[0],
      );
    });

    it('syncs with dryRun off, prune off and manifest provenance, in manifest order', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const [projectId, dto, userId, role] = ruleSets.syncRuleSet.mock.calls[0];
      expect(projectId).toBe('proj-1');
      expect(userId).toBe('user-1');
      expect(role).toBe('admin');
      expect(dto.ruleSet.name).toBe('handoff');
      expect(dto.options).toEqual({ dryRun: false, prune: false });
      expect(dto.source).toEqual({ repo: 'bffless/apps', path: 'rulesets/handoff.json' });
      expect(ruleSets.syncRuleSet.mock.calls[1][1].ruleSet.name).toBe('handoff-rss-feed');
    });

    it('passes only attachToAlias rule set names to the deployment', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const [entries, dto, userId, role] = deployments.createDeploymentFromFiles.mock.calls[0];
      expect(dto.proxyRuleSetNames).toEqual(['handoff']);
      expect(dto.repository).toBe('acme/site');
      expect(dto.alias).toBe('handoff');
      expect(dto.basePath).toBe('/apps/handoff/dist');
      expect(dto.branch).toBe('app-catalog');
      expect(dto.commitSha).toBe('a'.repeat(40));
      expect(dto.source).toBe('manual');
      expect(userId).toBe('user-1');
      expect(role).toBe('admin');
      expect(Object.values(entries).every((v) => v instanceof Uint8Array)).toBe(true);
    });

    // Provenance: a stamped bundle deploys under the commit that produced it, so the SHA in the
    // repo browser and the deployment URL resolves to real source instead of the content hash.
    it('deploys under the source commit when the bundle carries a build stamp', async () => {
      const commit = 'c01bb08a1b2c3d4e5f60718293a4b5c6d7e8f900';
      bundleService.fetchBundle.mockResolvedValue(makeBundle({}, undefined, { commit }));
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(deployments.createDeploymentFromFiles.mock.calls[0][1].commitSha).toBe(commit);
    });

    // Every app published before the stamp existed. Those must keep deploying exactly as they
    // do today — same 40-char value, same storage keys, no migration.
    it('falls back to the truncated bundle hash when the bundle is unstamped', async () => {
      bundleService.fetchBundle.mockResolvedValue(makeBundle());
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const { commitSha } = deployments.createDeploymentFromFiles.mock.calls[0][1];
      expect(commitSha).toBe('a'.repeat(40));
      expect(commitSha).toHaveLength(40);
    });

    it('uploads only the dist/ subtree, re-keyed under basePath', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const entries = Object.keys(deployments.createDeploymentFromFiles.mock.calls[0][0]).sort();
      expect(entries).toEqual(['apps/handoff/dist/assets/app.js', 'apps/handoff/dist/index.html']);
    });

    // The deploy step used to re-zip the bundle it had just decompressed, only for the
    // deployment service to unzip it again — two extra full copies of the payload. Studio's
    // 63MB bundle made that the difference between installing and an OOM kill, so the
    // entries must be handed over by reference, never re-encoded.
    it('hands the bundle bytes to the deployment without re-zipping them', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const bundle = await bundleService.fetchBundle.mock.results[0].value;
      const entries = deployments.createDeploymentFromFiles.mock.calls[0][0];

      // Same underlying Uint8Array objects — no copy was made.
      expect(entries['apps/handoff/dist/index.html']).toBe(bundle.files['dist/index.html']);
    });

    it('creates the app domain with SSL and the manifest visibility flags', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const [dto, userId, authToken, apiKeyProjectId] = domains.create.mock.calls[0];
      expect(dto).toEqual({
        projectId: 'proj-1',
        alias: 'handoff',
        path: '/apps/handoff/dist',
        domain: 'handoff.example.com',
        domainType: 'subdomain',
        sslEnabled: true,
        isPublic: true,
        isSpa: true,
      });
      expect(userId).toBe('user-1');
      expect(authToken).toBeUndefined();
      expect(apiKeyProjectId).toBeNull();
    });

    it('records the created resources and marks the row installed', async () => {
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
        status: string;
        version: string;
        bundleSha256: string;
        createdResources: CreatedResources;
        ruleSetIds: string[];
        deploymentId: string;
        domainId: string;
      };
      expect(finalUpdate.status).toBe('installed');
      expect(finalUpdate.version).toBe('1.0.0');
      expect(finalUpdate.bundleSha256).toBe('a'.repeat(64));
      expect(finalUpdate.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      expect(finalUpdate.deploymentId).toBe('dep-1');
      expect(finalUpdate.domainId).toBe('dom-1');
      expect(finalUpdate.createdResources).toEqual({
        projectCreated: false,
        ruleSetIds: ['rs-1', 'rs-2'],
        schemaIdsCreated: [],
        aliasName: 'handoff',
        deploymentId: 'dep-1',
        domainId: 'dom-1',
        scheduleIds: [],
      });
      expect(jobs.get(jobId)!.appUrl).toBe('https://handoff.example.com');
    });

    // ce#584: the dialog disables Install on a failing gate, but the job
    // re-runs projectGates itself — an API caller must be stopped too, before
    // anything is written.
    it('aborts before any write when the app host could only be served over http://', async () => {
      preflight.projectGates.mockResolvedValue({
        gates: [
          {
            id: 'app-host-tls',
            status: 'fail',
            message: 'handoff.example.com could only be served over http://',
            retryable: true,
          },
        ],
        syncPlans: [],
        appHost: 'handoff.example.com',
      });

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
      expect(domains.create).not.toHaveBeenCalled();
    });

    // ce#584: on a direct-serving instance with no certificate covering the app
    // host, the origin serves it over plain HTTP. Linking https:// there lands
    // the operator on the default vhost — certificate mismatch, then 404.
    it('links http:// when the cert step reports no certificate covers the host yet', async () => {
      queueInstallDb();
      certStep.schemeFor.mockResolvedValue('http');

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(jobs.get(jobId)!.status).toBe('succeeded');
      expect(jobs.get(jobId)!.appUrl).toBe('http://handoff.example.com');
    });

    it('filters manifest manual steps by the instance context', async () => {
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(jobs.get(jobId)!.manualSteps!.map((s) => s.id)).toEqual(['bucket-cors']);
    });

    it('interpolates {projectPath} and {appHost} into the job manual steps', async () => {
      const withToken = {
        ...TEST_MANIFEST.install,
        manualSteps: [
          {
            id: 'grant-access',
            title: 'Give other people access',
            body: 'Add each person as a guest.',
            deepLink: '/repo/{projectPath}/settings?tab=members',
          },
        ],
      };
      bundleService.fetchBundle.mockResolvedValue(makeBundle({ install: withToken }));
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(jobs.get(jobId)!.manualSteps![0].deepLink).toBe(
        '/repo/acme/site/settings?tab=members',
      );
    });

    it('does not treat a CachingStorageAdapter-wrapped local adapter as bucket storage (regression: live droplet Redis cache)', async () => {
      // Shape observed live: STORAGE_ADAPTER is a CachingStorageAdapter wrapping the real
      // LocalStorageAdapter. It has no getAdapterType(), so the old `getAdapterType?.() ??
      // constructor.name` fallback resolved to 'CachingStorageAdapter' -> bucketStorage=true,
      // wrongly surfacing the bucket-cors manual step on a local-FS install.
      const wrappedLocalAdapter = {
        supportsPresignedUrls: () => true,
        getUnderlyingAdapter: () => ({ isLocalAdapter: true }),
      };
      const localService = new AppInstallerService(
        jobs,
        bundleService as never,
        preflight as never,
        certStep as never,
        ruleSets as never,
        deployments as never,
        domains as never,
        projects as never,
        schedules as never,
        schemas as never,
        config as unknown as ConfigService,
        wrappedLocalAdapter as never,
      );
      queueInstallDb();

      const { jobId } = localService.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await localService.whenIdle();

      expect(jobs.get(jobId)!.manualSteps!.map((s) => s.id)).toEqual([]);
    });
  });

  describe('subdomain override', () => {
    it("passes the override straight through to the job's own re-preflight", async () => {
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [],
        appHost: 'my-app.example.com',
      });
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1', 'my-app');
      await service.whenIdle();

      expect(preflight.projectGates).toHaveBeenCalledWith(
        expect.anything(),
        { projectId: 'proj-1' },
        'user-1',
        'my-app',
      );
    });

    it('creates the app domain at "<override>.<PRIMARY_DOMAIN>", not the manifest default', async () => {
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [],
        appHost: 'my-app.example.com',
      });
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1', 'my-app');
      await service.whenIdle();

      const [dto] = domains.create.mock.calls[0];
      expect(dto.domain).toBe('my-app.example.com');
      expect(jobs.get(jobId)!.appUrl).toBe('https://my-app.example.com');
    });

    it('names both the deployment alias and the serving host in the deploy step detail (manifest alias "handoff" != overridden subdomain "my-app")', async () => {
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [],
        appHost: 'my-app.example.com',
      });
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1', 'my-app');
      await service.whenIdle();

      const deployStep = jobs.get(jobId)!.steps.find((s) => s.id === 'deploy')!;
      // The alias genuinely stays "handoff" (a different namespace from the
      // subdomain) — wording it alongside the actual serving host avoids
      // reading like the override was ignored.
      expect(deployStep.detail).toContain('alias "handoff"');
      expect(deployStep.detail).toContain('my-app.example.com');
    });
  });

  describe('project resolution', () => {
    it('creates the project and flags projectCreated when it did not exist', async () => {
      projects.projectExists.mockResolvedValue(false);
      queueInstallDb();

      service.startInstall(ENTRY, { newProject: { owner: 'acme', name: 'site' } }, 'user-1');
      await service.whenIdle();

      expect(projects.projectExists).toHaveBeenCalledWith('acme', 'site');
      expect(projects.findOrCreateProject).toHaveBeenCalledWith('acme', 'site', 'user-1');
      expect(projects.projectExists.mock.invocationCallOrder[0]).toBeLessThan(
        projects.findOrCreateProject.mock.invocationCallOrder[0],
      );
      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
        createdResources: CreatedResources;
      };
      expect(finalUpdate.createdResources.projectCreated).toBe(true);
    });

    it('refuses a newProject target whose project already exists, rather than adopting it', async () => {
      // Preflight's project-scoped gates are all skipped for a newProject
      // target, so adopting an existing project would install into it
      // unchecked — and its pre-existing alias would land in
      // createdResources for a later undo to delete.
      projects.projectExists.mockResolvedValue(true);

      const { jobId } = service.startInstall(
        ENTRY,
        { newProject: { owner: 'acme', name: 'site' } },
        'user-1',
      );
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/already exists/i);
      expect(job.error).toMatch(/picker/i);
      expect(projects.findOrCreateProject).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
    });

    it('inserts the installing row before any project-scoped write', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const inserted = mockDb.values.mock.calls[0][0] as { status: string; appId: string };
      expect(inserted.status).toBe('installing');
      expect(inserted.appId).toBe('handoff');
      expect(mockDb.insert.mock.invocationCallOrder[0]).toBeLessThan(
        ruleSets.syncRuleSet.mock.invocationCallOrder[0],
      );
    });

    it('resumes an existing failed row instead of inserting a duplicate', async () => {
      mockDb.__queue([{ ...INSTALLED_ROW, status: 'failed' }]);
      mockDb.__queue([{ ...INSTALLED_ROW, status: 'installing' }]);
      mockDb.__queue([]);

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('preflight and payload validation gates', () => {
    it('fails the job before any write when an instance gate fails', async () => {
      preflight.instanceGates.mockResolvedValue([
        { id: 'storage', status: 'fail', message: 'no presigned support' },
      ]);

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'preflight')!.status).toBe('failed');
      expect(job.error).toMatch(/no presigned support/);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
    });

    it('fails the job when a project gate fails', async () => {
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'name-collision', status: 'fail', message: 'alias taken' }],
        syncPlans: [],
        appHost: 'handoff.example.com',
      });

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(jobs.get(jobId)!.status).toBe('failed');
      expect(jobs.get(jobId)!.error).toMatch(/alias taken/);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('aborts on the fetch step when a bundled rule set fails DTO validation (SSRF parity)', async () => {
      bundleService.fetchBundle.mockResolvedValue(
        makeBundle(
          {},
          {
            ruleSet: { name: 'handoff' },
            rules: [
              {
                pathPattern: '/api/meta',
                method: 'GET',
                targetUrl: 'http://169.254.169.254/latest',
              },
            ],
            schemas: [],
          },
        ),
      );

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'fetch')!.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'fetch')!.error).toMatch(/targetUrl/i);
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('aborts on a rule set carrying keys the sync DTO does not declare (HTTP parity)', async () => {
      // `whitelist` alone would silently DELETE this key and sync a payload
      // that is not what the bundle shipped; the HTTP endpoint 400s on it.
      bundleService.fetchBundle.mockResolvedValue(
        makeBundle(
          {},
          {
            ruleSet: { name: 'handoff' },
            rules: [
              {
                pathPattern: '/api/nodes',
                method: 'GET',
                targetUrl: 'https://api.example.com',
                futureFeatureFlag: true,
              },
            ],
            schemas: [],
          },
        ),
      );

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'fetch')!.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'fetch')!.error).toMatch(/futureFeatureFlag/);
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('sync results', () => {
    it('keeps every resolved schema id but only records the created ones as ours', async () => {
      ruleSets.syncRuleSet
        .mockReset()
        .mockResolvedValueOnce(
          syncResponse({
            ruleSetId: 'rs-1',
            schemaResolutions: [
              {
                name: 'handoff_nodes',
                action: 'create',
                targetSchemaId: 'sch-new',
                fieldMismatch: false,
              },
              {
                name: 'handoff_acl',
                action: 'reuse',
                targetSchemaId: 'sch-existing',
                fieldMismatch: false,
              },
            ],
          }),
        )
        .mockResolvedValueOnce(syncResponse({ ruleSetId: 'rs-2', setCreated: false }));
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
        schemaIds: string[];
        ruleSetIds: string[];
        createdResources: CreatedResources;
      };
      expect(finalUpdate.schemaIds).toEqual(['sch-new', 'sch-existing']);
      expect(finalUpdate.createdResources.schemaIdsCreated).toEqual(['sch-new']);
      // rs-2 was adopted (setCreated false) — not ours to delete
      expect(finalUpdate.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      expect(finalUpdate.createdResources.ruleSetIds).toEqual(['rs-1']);
    });

    it('surfaces missing secrets and warnings in the step detail', async () => {
      ruleSets.syncRuleSet
        .mockReset()
        .mockResolvedValue(
          syncResponse({ missingSecrets: ['STRIPE_KEY'], warnings: ['nginx reload skipped'] }),
        );
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const detail = jobs.get(jobId)!.steps.find((s) => s.id === 'sync-rules')!.detail!;
      expect(detail).toMatch(/STRIPE_KEY/);
      expect(detail).toMatch(/nginx reload skipped/);
    });
  });

  describe('deploy verification', () => {
    it('fails the step when the returned aliases do not include the app alias', async () => {
      deployments.createDeploymentFromFiles.mockResolvedValue(deployResponse({ aliases: [] }));
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'deploy')!.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'deploy')!.error).toMatch(/alias/i);
      expect(domains.create).not.toHaveBeenCalled();
      const failedUpdate = mockDb.set.mock.calls.at(-1)![0] as { status: string };
      expect(failedUpdate.status).toBe('failed');
    });
  });

  describe('progress persistence', () => {
    it('writes the sync step results to the row before the deploy runs', async () => {
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      // The insert uses values(), so the FIRST set() is the post-sync flush.
      const afterSync = mockDb.set.mock.calls[0][0] as {
        ruleSetIds: string[];
        createdResources: CreatedResources;
        deploymentId: string | null;
      };
      expect(afterSync.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      expect(afterSync.createdResources.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      // Nothing deployed yet at that point.
      expect(afterSync.deploymentId).toBeNull();
      expect(mockDb.set.mock.invocationCallOrder[0]).toBeLessThan(
        deployments.createDeploymentFromFiles.mock.invocationCallOrder[0],
      );
    });

    it('carries what the sync created into the failure write, so undo can find it', async () => {
      // Nothing hand-seeded: everything asserted here must have been produced
      // by the run itself. A `failed` row with an empty createdResources would
      // orphan the rule sets/schemas the sync just created.
      ruleSets.syncRuleSet
        .mockReset()
        .mockResolvedValueOnce(
          syncResponse({
            ruleSetId: 'rs-1',
            schemaResolutions: [
              {
                name: 'handoff_nodes',
                action: 'create',
                targetSchemaId: 'sch-new',
                fieldMismatch: false,
              },
            ],
          }),
        )
        .mockResolvedValueOnce(syncResponse({ ruleSetId: 'rs-2' }));
      deployments.createDeploymentFromFiles.mockResolvedValue(deployResponse({ aliases: [] }));
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const failureWrite = mockDb.set.mock.calls.at(-1)![0] as {
        status: string;
        ruleSetIds: string[];
        schemaIds: string[];
        createdResources: CreatedResources;
      };
      expect(failureWrite.status).toBe('failed');
      expect(failureWrite.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      expect(failureWrite.schemaIds).toEqual(['sch-new']);
      expect(failureWrite.createdResources.ruleSetIds).toEqual(['rs-1', 'rs-2']);
      expect(failureWrite.createdResources.schemaIdsCreated).toEqual(['sch-new']);
    });

    it('persists the domain id as soon as the domain step created it', async () => {
      certStep.plan.mockRejectedValue(new Error('boom')); // cert runs after domain
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const writes = mockDb.set.mock.calls.map((c) => c[0] as { domainId?: string | null });
      const firstWithDomain = writes.findIndex((w) => w.domainId === 'dom-1');
      expect(firstWithDomain).toBeGreaterThan(-1);
      // Not only at the final record write.
      expect(firstWithDomain).toBeLessThan(writes.length - 1);
    });

    it('stamps installedAppId on a failed job once a row exists, so it can still be undone by jobId', async () => {
      deployments.createDeploymentFromFiles.mockResolvedValue(deployResponse({ aliases: [] }));
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.installedAppId).toBe('ia-1');
    });

    it('leaves installedAppId unset on a failed job that never reached a row', async () => {
      preflight.instanceGates.mockResolvedValue([
        { id: 'storage', status: 'fail', message: 'no presigned support' },
      ]);

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.installedAppId).toBeUndefined();
    });

    it('persists a failed update run too', async () => {
      deployments.createDeploymentFromFiles.mockResolvedValue(deployResponse({ aliases: [] }));

      service.startUpdate(
        { ...INSTALLED_ROW, status: 'installed', createdResources: {} } as never,
        ENTRY,
        'user-1',
        { prune: false },
      );
      await service.whenIdle();

      const failureWrite = mockDb.set.mock.calls.at(-1)![0] as {
        status: string;
        createdResources: CreatedResources;
      };
      expect(failureWrite.status).toBe('failed');
      expect(failureWrite.createdResources.ruleSetIds).toEqual(['rs-1', 'rs-2']);
    });
  });

  describe('domain and certificate steps', () => {
    it('skips both when the manifest declares no domain, and falls back to the deployment URL', async () => {
      const noDomain = { ...TEST_MANIFEST.install };
      delete (noDomain as { domain?: unknown }).domain;
      bundleService.fetchBundle.mockResolvedValue(makeBundle({ install: noDomain }));
      preflight.projectGates.mockResolvedValue({ gates: [], syncPlans: [], appHost: null });
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('succeeded');
      expect(job.steps.find((s) => s.id === 'domain')!.status).toBe('skipped');
      expect(job.steps.find((s) => s.id === 'certificate')!.status).toBe('skipped');
      expect(domains.create).not.toHaveBeenCalled();
      expect(certStep.plan).not.toHaveBeenCalled();
      expect(job.appUrl).toBe('https://admin.example.com/alias/handoff');
    });

    it('does not recreate a domain already recorded on this app row (re-run)', async () => {
      mockDb.__queue([
        { ...INSTALLED_ROW, status: 'failed', createdResources: { domainId: 'dom-1' } },
      ]);
      mockDb.__queue([{ ...INSTALLED_ROW, createdResources: { domainId: 'dom-1' } }]);
      mockDb.__queue([]);

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(domains.create).not.toHaveBeenCalled();
      expect(jobs.get(jobId)!.steps.find((s) => s.id === 'domain')!.status).toBe('done');
      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as { domainId: string };
      expect(finalUpdate.domainId).toBe('dom-1');
    });

    it('succeeds with the synthesized manual step when the cert step needs action', async () => {
      certStep.plan.mockResolvedValue({ model: 'direct-le', action: 'stage-san-reissue' });
      certStep.execute.mockResolvedValue({
        status: 'action-required',
        detail: 'staged',
        manualStep: {
          id: 'apply-ssl-cert',
          title: 'Apply the updated certificate',
          body: 'review + apply',
          appliesWhen: 'selfHosted',
        },
      });
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('succeeded');
      expect(job.steps.find((s) => s.id === 'certificate')!.status).toBe('action-required');
      expect(job.manualSteps!.map((s) => s.id)).toEqual(['bucket-cors', 'apply-ssl-cert']);
    });

    it('notes a silently downgraded sslEnabled in the certificate detail', async () => {
      domains.create.mockResolvedValue({
        id: 'dom-1',
        domain: 'handoff.example.com',
        sslEnabled: false,
      });
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(jobs.get(jobId)!.steps.find((s) => s.id === 'certificate')!.detail).toMatch(/ssl/i);
    });

    it('never fails the install when the cert step throws', async () => {
      certStep.plan.mockRejectedValue(new Error('acme unreachable'));
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('succeeded');
      expect(job.steps.find((s) => s.id === 'certificate')!.status).toBe('skipped');
      expect(job.steps.find((s) => s.id === 'certificate')!.detail).toMatch(/acme unreachable/);
    });
  });

  describe('schedules step', () => {
    const withSchedule = {
      ...TEST_MANIFEST.install,
      schedules: [
        {
          name: 'Refresh feeds',
          cronExpression: '*/15 * * * *',
          timezone: 'UTC',
          targetRulePath: '/api/feeds/refresh',
          targetRuleMethod: 'POST',
        },
      ],
    };

    it('creates a schedule against the matching pipeline rule', async () => {
      bundleService.fetchBundle.mockResolvedValue(makeBundle({ install: withSchedule }));
      schedules.listPipelineRules.mockResolvedValue([
        { id: 'rule-other', pathPattern: '/api/nodes', method: 'GET' },
        { id: 'rule-1', pathPattern: '/api/feeds/refresh', method: 'POST' },
      ]);
      queueInstallDb();

      const { jobId } = service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(schedules.createSchedule).toHaveBeenCalledWith(
        'proj-1',
        {
          name: 'Refresh feeds',
          targetProxyRuleId: 'rule-1',
          cronExpression: '*/15 * * * *',
          timezone: 'UTC',
        },
        'user-1',
        'admin',
        null,
      );
      expect(jobs.get(jobId)!.steps.find((s) => s.id === 'schedules')!.status).toBe('done');
      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
        createdResources: CreatedResources;
      };
      expect(finalUpdate.createdResources.scheduleIds).toEqual(['sched-1']);
    });

    it('does not create a schedule that already exists by name (idempotent re-run)', async () => {
      bundleService.fetchBundle.mockResolvedValue(makeBundle({ install: withSchedule }));
      schedules.listPipelineRules.mockResolvedValue([
        { id: 'rule-1', pathPattern: '/api/feeds/refresh', method: 'POST' },
      ]);
      schedules.listSchedules.mockResolvedValue([{ id: 'sched-existing', name: 'Refresh feeds' }]);
      queueInstallDb();

      service.startInstall(ENTRY, { projectId: 'proj-1' }, 'user-1');
      await service.whenIdle();

      expect(schedules.createSchedule).not.toHaveBeenCalled();
    });
  });

  describe('startUpdate', () => {
    const installed = { ...INSTALLED_ROW, status: 'installed' as const, createdResources: {} };

    it('runs only preflight → fetch → sync-rules → deploy → record, leaving the domain alone', async () => {
      mockDb.__queue([]); // final record update

      const { jobId } = service.startUpdate(
        installed as never,
        { ...ENTRY, version: '1.1.0' },
        'user-1',
        { prune: false },
      );
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.kind).toBe('update');
      expect(job.status).toBe('succeeded');
      expect(job.steps.map((s) => s.id)).toEqual([
        'preflight',
        'fetch',
        'sync-rules',
        'deploy',
        'record',
      ]);
      expect(domains.create).not.toHaveBeenCalled();
      // Instance gates ARE re-verified; project gates would collide with this
      // install's own alias/rule sets and are deliberately not run.
      expect(preflight.instanceGates).toHaveBeenCalledWith(ENTRY.requires);
      expect(preflight.projectGates).not.toHaveBeenCalled();
      expect(schedules.createSchedule).not.toHaveBeenCalled();
    });

    it('refuses before any collaborator call when an instance gate now fails', async () => {
      // A registry bump can raise requires.ceMin/presignedStorage: the
      // previously-installed version says nothing about the new one.
      preflight.instanceGates.mockResolvedValue([
        {
          id: 'ce-version',
          status: 'fail',
          message: 'CE 0.3.1 is below the required minimum 0.4.0',
        },
      ]);

      const { jobId } = service.startUpdate(installed as never, ENTRY, 'user-1', { prune: false });
      await service.whenIdle();

      const job = jobs.get(jobId)!;
      expect(job.status).toBe('failed');
      expect(job.steps.find((s) => s.id === 'preflight')!.status).toBe('failed');
      expect(job.error).toMatch(/below the required minimum 0\.4\.0/);
      expect(bundleService.fetchBundle).not.toHaveBeenCalled();
      expect(ruleSets.syncRuleSet).not.toHaveBeenCalled();
      expect(deployments.createDeploymentFromFiles).not.toHaveBeenCalled();
    });

    it('leaves the healthy installed row untouched when a gate refuses the update', async () => {
      preflight.instanceGates.mockResolvedValue([
        { id: 'storage', status: 'fail', message: 'no presigned support' },
      ]);

      service.startUpdate(installed as never, ENTRY, 'user-1', { prune: false });
      await service.whenIdle();

      // No write at all — in particular the row is NOT restamped 'failed',
      // which would mislabel a still-working install.
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.set).not.toHaveBeenCalled();
    });

    it('passes the prune flag through to the sync and deploys to the same alias', async () => {
      mockDb.__queue([]);

      service.startUpdate(installed as never, ENTRY, 'user-1', { prune: true });
      await service.whenIdle();

      // An update preserves dashboard edits the new bundle doesn't touch (three-way).
      expect(ruleSets.syncRuleSet.mock.calls[0][1].options).toEqual({
        dryRun: false,
        prune: true,
        conflictPolicy: 'preserve',
      });
      expect(deployments.createDeploymentFromFiles.mock.calls[0][1].alias).toBe('handoff');
    });

    // Silently KEEPING a local edit is no better than silently discarding one:
    // either way the operator is running a rule the app didn't ship. Both
    // outcomes have to reach the progress detail the install dialog renders.
    it('reports preserved and conflicted rules in the step detail', async () => {
      mockDb.__queue([]);
      ruleSets.syncRuleSet = jest.fn().mockResolvedValue(
        syncResponse({
          ruleSetId: 'rs-1',
          preserved: [{ pathPattern: '/api/thumbnail/draft', method: 'POST' }],
          merged: [
            { pathPattern: '/api/refine-scene', method: 'POST', keptFields: ['description'] },
          ],
          conflicts: [
            {
              pathPattern: '/api/scenes',
              method: 'POST',
              liveId: 'rule-9',
              fields: [
                {
                  field: 'pipelineConfig.steps.draft.config.skills.enabled',
                  ours: ['mine'],
                  theirs: ['theirs'],
                },
              ],
            },
          ],
        }),
      );

      const { jobId } = service.startUpdate(installed as never, ENTRY, 'user-1', { prune: false });
      await service.whenIdle();

      const details = jobs
        .get(jobId)!
        .steps.map((step) => step.detail ?? '')
        .join(' ');

      expect(details).toContain('POST /api/thumbnail/draft');
      expect(details).toContain('POST /api/scenes');
      expect(details).toContain('pipelineConfig.steps.draft.config.skills.enabled');
      // A clean merge is reported too — the live rule still isn't the shipped one.
      expect(details).toContain('POST /api/refine-scene');
    });

    it('bumps the recorded version on the existing row', async () => {
      mockDb.__queue([]);

      service.startUpdate(installed as never, { ...ENTRY, version: '1.1.0' }, 'user-1', {
        prune: false,
      });
      await service.whenIdle();

      const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as { version: string; status: string };
      expect(finalUpdate.status).toBe('installed');
      expect(finalUpdate.version).toBe('1.0.0'); // manifest version wins over the registry entry
    });

    describe('appUrl (regression: an update read the manifest default subdomain instead of the row it never touches)', () => {
      // TEST_MANIFEST's install.domain.subdomain is "handoff" — an update
      // never recreates the domain (no 'domain' step in UPDATE_STEPS), so the
      // finished job's appUrl must come from the ORIGINAL install's stored
      // domain row, even when that row's actual host ("files.example.com")
      // differs from the manifest default.
      it('resolves appUrl from the stored domain row, not the manifest default subdomain', async () => {
        mockDb.__queue([{ domain: 'files.example.com' }]); // lookupDomainHost
        mockDb.__queue([]); // final record update

        const { jobId } = service.startUpdate(
          { ...installed, domainId: 'dom-1' } as never,
          { ...ENTRY, version: '1.1.0' },
          'user-1',
          { prune: false },
        );
        await service.whenIdle();

        const job = jobs.get(jobId)!;
        expect(job.status).toBe('succeeded');
        expect(job.appUrl).toBe('https://files.example.com');
      });

      it('falls back to the deployment URL when domainId points at a since-deleted mapping', async () => {
        mockDb.__queue([]); // lookupDomainHost: mapping gone
        mockDb.__queue([]); // final record update

        const { jobId } = service.startUpdate(
          { ...installed, domainId: 'dom-gone' } as never,
          { ...ENTRY, version: '1.1.0' },
          'user-1',
          { prune: false },
        );
        await service.whenIdle();

        expect(jobs.get(jobId)!.appUrl).toBe('https://admin.example.com/alias/handoff');
      });

      it('names both the deployment alias and the serving host in the deploy step detail', async () => {
        mockDb.__queue([{ domain: 'files.example.com' }]);
        mockDb.__queue([]);

        const { jobId } = service.startUpdate(
          { ...installed, domainId: 'dom-1' } as never,
          { ...ENTRY, version: '1.1.0' },
          'user-1',
          { prune: false },
        );
        await service.whenIdle();

        const deployStep = jobs.get(jobId)!.steps.find((s) => s.id === 'deploy')!;
        expect(deployStep.detail).toContain('alias "handoff"');
        expect(deployStep.detail).toContain('files.example.com');
      });

      it('interpolates {projectPath} and {appHost} into the update job manual steps', async () => {
        const withToken = {
          ...TEST_MANIFEST.install,
          manualSteps: [
            {
              id: 'grant-access',
              title: 'Give other people access',
              body: 'Add each person as a guest.',
              deepLink: '/repo/{projectPath}/settings?tab=members',
            },
          ],
        };
        bundleService.fetchBundle.mockResolvedValue(makeBundle({ install: withToken }));
        mockDb.__queue([{ domain: 'files.example.com' }]); // lookupDomainHost
        mockDb.__queue([]); // final record update

        const { jobId } = service.startUpdate(
          { ...installed, domainId: 'dom-1' } as never,
          { ...ENTRY, version: '1.1.0' },
          'user-1',
          { prune: false },
        );
        await service.whenIdle();

        expect(jobs.get(jobId)!.manualSteps![0].deepLink).toBe(
          '/repo/acme/site/settings?tab=members',
        );
      });
    });
  });

  describe('undo', () => {
    const created: CreatedResources = {
      projectCreated: false,
      ruleSetIds: ['rs-1'],
      schemaIdsCreated: ['sch-new'],
      aliasName: 'handoff',
      deploymentId: 'dep-1',
      domainId: 'dom-1',
      scheduleIds: ['sched-1'],
    };

    it('deletes only the created resources, in reverse order', async () => {
      mockDb.__queue([
        { ...INSTALLED_ROW, schemaIds: ['sch-new', 'sch-reused'], createdResources: created },
      ]);
      mockDb.__queue([]); // delete installed_apps row

      const result = await service.undo('ia-1', 'user-1');

      expect(schedules.deleteSchedule).toHaveBeenCalledWith('sched-1', 'user-1', 'admin', null);
      expect(domains.remove).toHaveBeenCalledWith('dom-1', 'user-1', undefined, null);
      expect(deployments.deleteAlias).toHaveBeenCalledWith(
        'acme/site',
        'handoff',
        'user-1',
        'admin',
      );
      expect(deployments.deleteDeployment).toHaveBeenCalledWith('dep-1', 'user-1', 'admin');
      expect(ruleSets.delete).toHaveBeenCalledWith('rs-1', 'user-1', 'admin', null);
      expect(schemas.delete).toHaveBeenCalledWith('sch-new', 'user-1', 'admin', null);

      expect(schedules.deleteSchedule.mock.invocationCallOrder[0]).toBeLessThan(
        domains.remove.mock.invocationCallOrder[0],
      );
      expect(domains.remove.mock.invocationCallOrder[0]).toBeLessThan(
        deployments.deleteAlias.mock.invocationCallOrder[0],
      );
      expect(deployments.deleteDeployment.mock.invocationCallOrder[0]).toBeLessThan(
        ruleSets.delete.mock.invocationCallOrder[0],
      );
      expect(ruleSets.delete.mock.invocationCallOrder[0]).toBeLessThan(
        schemas.delete.mock.invocationCallOrder[0],
      );
      expect(result.removed).toEqual(
        expect.arrayContaining([
          'schedule:sched-1',
          'domain:dom-1',
          'ruleSet:rs-1',
          'schema:sch-new',
        ]),
      );
    });

    it('never deletes a reused schema or a pre-existing rule set', async () => {
      mockDb.__queue([
        {
          ...INSTALLED_ROW,
          ruleSetIds: ['rs-1', 'rs-adopted'],
          schemaIds: ['sch-new', 'sch-reused'],
          createdResources: created,
        },
      ]);
      mockDb.__queue([]);

      await service.undo('ia-1', 'user-1');

      expect(schemas.delete).toHaveBeenCalledTimes(1);
      expect(schemas.delete).not.toHaveBeenCalledWith('sch-reused', 'user-1', 'admin', null);
      expect(ruleSets.delete).toHaveBeenCalledTimes(1);
      expect(ruleSets.delete).not.toHaveBeenCalledWith('rs-adopted', 'user-1', 'admin', null);
    });

    it('does not touch a domain or project it did not create', async () => {
      mockDb.__queue([
        {
          ...INSTALLED_ROW,
          domainId: 'dom-preexisting',
          createdResources: { ruleSetIds: ['rs-1'] },
        },
      ]);
      mockDb.__queue([]);

      await service.undo('ia-1', 'user-1');

      expect(domains.remove).not.toHaveBeenCalled();
      expect(projects.deleteProject).not.toHaveBeenCalled();
    });

    it('deletes a project it created only when nothing else lives in it', async () => {
      mockDb.__queue([{ ...INSTALLED_ROW, createdResources: { projectCreated: true } }]);
      mockDb.__queue([]); // remaining aliases in project
      mockDb.__queue([]); // remaining rule sets in project
      mockDb.__queue([]); // delete installed_apps row

      await service.undo('ia-1', 'user-1');

      expect(projects.deleteProject).toHaveBeenCalledWith('proj-1');
    });

    it('keeps a project it created when other content remains', async () => {
      mockDb.__queue([{ ...INSTALLED_ROW, createdResources: { projectCreated: true } }]);
      mockDb.__queue([{ id: 'alias-other' }]); // remaining aliases
      mockDb.__queue([]); // remaining rule sets
      mockDb.__queue([]); // delete installed_apps row

      await service.undo('ia-1', 'user-1');

      expect(projects.deleteProject).not.toHaveBeenCalled();
    });

    it('marks the matching job undone and drops the installed_apps row', async () => {
      const job = jobs.create('install', 'handoff', ['record']);
      jobs.finish(job.id, 'succeeded', { installedAppId: 'ia-1' });
      mockDb.__queue([{ ...INSTALLED_ROW, createdResources: {} }]);
      mockDb.__queue([]);

      await service.undo('ia-1', 'user-1');

      expect(jobs.get(job.id)!.status).toBe('undone');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('continues past an individual delete failure and reports what it removed', async () => {
      domains.remove.mockRejectedValue(new Error('domain gone'));
      mockDb.__queue([{ ...INSTALLED_ROW, createdResources: created }]);
      mockDb.__queue([]);

      const result = await service.undo('ia-1', 'user-1');

      expect(result.removed).not.toContain('domain:dom-1');
      expect(ruleSets.delete).toHaveBeenCalled();
    });

    it('keeps the installed_apps row (status failed) instead of dropping it when a delete throws', async () => {
      deployments.deleteAlias.mockRejectedValue(new Error('alias gone for real'));
      mockDb.__queue([
        { ...INSTALLED_ROW, schemaIds: ['sch-new', 'sch-reused'], createdResources: created },
      ]);
      mockDb.__queue([]); // the status-update, not a row delete

      const result = await service.undo('ia-1', 'user-1');

      expect(result.failures).toEqual(['alias:handoff']);
      expect(result.removed).toEqual(
        expect.arrayContaining([
          'schedule:sched-1',
          'domain:dom-1',
          'deployment:dep-1',
          'ruleSet:rs-1',
          'schema:sch-new',
        ]),
      );
      // Other deletions were still attempted despite the alias failure.
      expect(schedules.deleteSchedule).toHaveBeenCalled();
      expect(domains.remove).toHaveBeenCalled();
      expect(deployments.deleteDeployment).toHaveBeenCalled();
      expect(ruleSets.delete).toHaveBeenCalled();
      expect(schemas.delete).toHaveBeenCalled();

      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('uninstall', () => {
    const created: CreatedResources = {
      ruleSetIds: ['rs-1'],
      schemaIdsCreated: ['sch-new'],
      aliasName: 'handoff',
      deploymentId: 'dep-1',
      domainId: 'dom-1',
      scheduleIds: ['sched-1'],
    };

    beforeEach(() => {
      schemas.getByIdWithCount = jest.fn((id: string) => {
        if (id === 'sch-new')
          return Promise.resolve({ id, name: 'handoff_nodes', recordCount: 42 });
        if (id === 'sch-reused') {
          return Promise.resolve({ id, name: 'handoff_shared_table', recordCount: 7 });
        }
        return Promise.resolve(null);
      });
    });

    it('by default removes rule sets, alias, domain, deployment, schedules and keeps ALL data tables', async () => {
      mockDb.__queue([
        {
          ...INSTALLED_ROW,
          // "rs-adopted" is attached to the app (in ruleSetIds) but was NOT
          // created by this install (absent from createdResources.ruleSetIds)
          // — the default uninstall removes it anyway (deviation 5).
          ruleSetIds: ['rs-1', 'rs-adopted'],
          schemaIds: ['sch-new', 'sch-reused'],
          createdResources: created,
        },
      ]);
      mockDb.__queue([]); // delete installed_apps row

      const summary = await service.uninstall('ia-1', 'user-1', { deleteData: false });

      expect(schemas.delete).not.toHaveBeenCalled();
      expect(ruleSets.delete).toHaveBeenCalledWith('rs-1', 'user-1', 'admin', null);
      expect(ruleSets.delete).toHaveBeenCalledWith('rs-adopted', 'user-1', 'admin', null);
      expect(deployments.deleteAlias).toHaveBeenCalledWith(
        'acme/site',
        'handoff',
        'user-1',
        'admin',
      );
      expect(deployments.deleteDeployment).toHaveBeenCalledWith('dep-1', 'user-1', 'admin');
      expect(domains.remove).toHaveBeenCalledWith('dom-1', 'user-1', undefined, null);
      expect(schedules.deleteSchedule).toHaveBeenCalledWith('sched-1', 'user-1', 'admin', null);

      expect(summary.removed).toEqual({
        ruleSets: 2,
        alias: true,
        domain: true,
        deployment: true,
        schedules: 1,
      });
      expect(summary.dataTables.deleted).toEqual([]);
      expect(summary.dataTables.deletedRecordCounts).toEqual({});
      expect(summary.dataTables.kept).toEqual(
        expect.arrayContaining(['handoff_nodes', 'handoff_shared_table']),
      );
      expect(summary.dataTables.kept).toHaveLength(2);
      expect(summary.note).toContain('acme/site');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('with deleteData: true deletes only created tables, fetching counts first, and never deletes reused tables', async () => {
      mockDb.__queue([
        { ...INSTALLED_ROW, schemaIds: ['sch-new', 'sch-reused'], createdResources: created },
      ]);
      mockDb.__queue([]);

      const summary = await service.uninstall('ia-1', 'user-1', { deleteData: true });

      expect(schemas.getByIdWithCount).toHaveBeenCalledWith('sch-new', null);
      expect(schemas.delete).toHaveBeenCalledWith('sch-new', 'user-1', 'admin', null);
      expect(schemas.delete).not.toHaveBeenCalledWith('sch-reused', 'user-1', 'admin', null);
      expect(schemas.getByIdWithCount.mock.invocationCallOrder[0]).toBeLessThan(
        schemas.delete.mock.invocationCallOrder[0],
      );

      expect(summary.dataTables.deleted).toEqual(['handoff_nodes']);
      expect(summary.dataTables.kept).toEqual(['handoff_shared_table']);
      expect(summary.dataTables.deletedRecordCounts).toEqual({ handoff_nodes: 42 });
    });

    it('also keeps the row when a data-table delete fails under deleteData: true', async () => {
      schemas.delete.mockRejectedValue(new Error('schema delete failed for real'));
      mockDb.__queue([
        { ...INSTALLED_ROW, schemaIds: ['sch-new', 'sch-reused'], createdResources: created },
      ]);
      mockDb.__queue([]); // status update, not a row delete

      const summary = await service.uninstall('ia-1', 'user-1', { deleteData: true });

      expect(summary.failures).toEqual(['schema:sch-new']);
      expect(summary.dataTables.deleted).toEqual([]);
      expect(summary.dataTables.kept).toEqual(
        expect.arrayContaining(['handoff_nodes', 'handoff_shared_table']),
      );
      expect(summary.dataTables.deletedRecordCounts).toEqual({});
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('continues past an individual delete failure and reports accurate counts', async () => {
      domains.remove.mockRejectedValue(new Error('domain gone'));
      mockDb.__queue([{ ...INSTALLED_ROW, ruleSetIds: ['rs-1'], createdResources: created }]);
      mockDb.__queue([]);

      const summary = await service.uninstall('ia-1', 'user-1', { deleteData: false });

      expect(summary.removed.domain).toBe(false);
      expect(summary.removed.alias).toBe(true);
      expect(ruleSets.delete).toHaveBeenCalled();
    });

    it('keeps the installed_apps row (status failed) and reports the failing label when a delete throws', async () => {
      deployments.deleteAlias.mockRejectedValue(new Error('alias gone for real'));
      mockDb.__queue([{ ...INSTALLED_ROW, ruleSetIds: ['rs-1'], createdResources: created }]);
      mockDb.__queue([]); // the status-update, not a row delete

      const summary = await service.uninstall('ia-1', 'user-1', { deleteData: false });

      expect(summary.failures).toEqual(['alias:handoff']);
      expect(summary.removed.alias).toBe(false);
      // Other deletions were still attempted despite the alias failure.
      expect(summary.removed.domain).toBe(true);
      expect(summary.removed.deployment).toBe(true);
      expect(summary.removed.schedules).toBe(1);
      expect(summary.removed.ruleSets).toBe(1);
      expect(schedules.deleteSchedule).toHaveBeenCalled();
      expect(domains.remove).toHaveBeenCalled();
      expect(deployments.deleteDeployment).toHaveBeenCalled();
      expect(ruleSets.delete).toHaveBeenCalled();

      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('re-running after a partial failure is idempotent (already-removed resources do not block it) and completes by dropping the row', async () => {
      // Pass 1: the alias delete throws a real error; everything else succeeds.
      // Pass 2 (after whatever broke it is fixed): the alias delete succeeds,
      // and the rule set — already deleted for real during pass 1 — now
      // throws NotFoundException, standing in for "this object is already
      // gone". Neither should block the retry from completing.
      deployments.deleteAlias
        .mockRejectedValueOnce(new Error('alias gone for real'))
        .mockResolvedValueOnce(undefined);
      ruleSets.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new NotFoundException('rule set already gone'));

      const row = { ...INSTALLED_ROW, ruleSetIds: ['rs-1'], createdResources: created };

      mockDb.__queue([row]);
      mockDb.__queue([]); // status update, not a delete
      const first = await service.uninstall('ia-1', 'user-1', { deleteData: false });

      expect(first.failures).toEqual(['alias:handoff']);
      expect(mockDb.delete).not.toHaveBeenCalled();

      mockDb.__reset(); // clears queued db results + call counts; service mocks (alias/ruleSets) are untouched
      mockDb.__queue([row]);
      mockDb.__queue([]); // this time, the final row delete

      const second = await service.uninstall('ia-1', 'user-1', { deleteData: false });

      expect(second.failures).toBeUndefined();
      expect(second.removed.alias).toBe(true);
      expect(second.removed.ruleSets).toBe(1); // NotFound on retry still counts as removed
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('uninstallPreview', () => {
    it('returns per-table name, record count, and whether this install created it', async () => {
      mockDb.__queue([
        {
          ...INSTALLED_ROW,
          schemaIds: ['sch-new', 'sch-reused'],
          createdResources: { schemaIdsCreated: ['sch-new'] },
        },
      ]);
      schemas.getByIdWithCount = jest.fn((id: string) => {
        if (id === 'sch-new')
          return Promise.resolve({ id, name: 'handoff_nodes', recordCount: 42 });
        return Promise.resolve({ id, name: 'handoff_shared_table', recordCount: 7 });
      });

      const preview = await service.uninstallPreview('ia-1');

      expect(preview.dataTables).toEqual([
        { name: 'handoff_nodes', recordCount: 42, createdByInstall: true },
        { name: 'handoff_shared_table', recordCount: 7, createdByInstall: false },
      ]);
    });
  });
});
