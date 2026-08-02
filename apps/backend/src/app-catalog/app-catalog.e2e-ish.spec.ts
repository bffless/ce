// Thenable chainable db mock: every builder method returns the chain, and
// awaiting consumes the next queued result in await order. House pattern,
// same as app-installer.service.spec.ts — deviation 4 of the app-catalog
// spec: this is a house db mock, not a real Postgres. Declared above imports
// because jest.mock is hoisted.
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

import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { AppBundleService } from './app-bundle.service';
import { AppInstallJobsService } from './app-install-jobs.service';
import { AppInstallerService } from './app-installer.service';
import { makeFixtureBundle } from './__fixtures__/make-fixture-bundle';
import type { AppRegistryEntry } from './app-manifest.types';
import type { CreatedResources, InstalledApp } from '../db/schema';

/**
 * Orchestration spec (Task 11): the closest CE-side approximation of the
 * spec's integration suite. Unlike `app-installer.service.spec.ts` (which
 * hands the installer a hand-authored `LoadedBundle` directly), this spec
 * drives `AppInstallerService` through a REAL `AppBundleService` fed REAL zip
 * bytes built by `makeFixtureBundle` — so the manifest parse, `validateAppManifest`,
 * the sha256 check, and the rule-set-file-presence check all run for real. Only
 * the network fetch and the downstream side-effecting services
 * (sync/deploy/domains/projects/schedules) are mocked, returning realistic
 * response shapes. The real-DB pass happens on the live droplet (Task 16
 * checklist) — this spec is the contract seam for that.
 */

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

function fetchResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

const v1 = makeFixtureBundle('1.0.0');
const v2 = makeFixtureBundle('2.0.0');

const ENTRY_V1: AppRegistryEntry = {
  id: 'fixture-app',
  name: 'Fixture App',
  version: '1.0.0',
  bundleUrl: 'https://apps.bffless.dev/fixture-app-1.0.0.zip',
  sha256: v1.sha256,
};

const ENTRY_V2: AppRegistryEntry = {
  id: 'fixture-app',
  name: 'Fixture App',
  version: '2.0.0',
  bundleUrl: 'https://apps.bffless.dev/fixture-app-2.0.0.zip',
  sha256: v2.sha256,
};

function deployResponse(overrides: Record<string, unknown> = {}) {
  return {
    deploymentId: 'dep-fixture-1',
    commitSha: v1.sha256.slice(0, 40),
    fileCount: 1,
    totalSize: 64,
    urls: {
      sha: 'https://admin.example.com/repo/acme/site/sha',
      default: 'https://admin.example.com/public/acme/site/',
    },
    aliases: ['fixture-app'],
    ...overrides,
  };
}

/** Simulated state after a v1 install then a v2 update completed for real —
 * used to seed the two independent uninstall scenarios below. `sch-items` is
 * this app's own table; `sch-notes` was adopted from a table that already
 * existed in the project (a `reuse` resolution), so it must survive even a
 * `deleteData: true` uninstall. */
const POST_UPDATE_ROW: InstalledApp = {
  id: 'ia-fixture',
  appId: 'fixture-app',
  name: 'Fixture App',
  version: '2.0.0',
  projectId: 'proj-1',
  alias: 'fixture-app',
  domainId: null,
  deploymentId: 'dep-fixture-2',
  ruleSetIds: ['rs-a', 'rs-b'],
  schemaIds: ['sch-items', 'sch-notes'],
  bundleSha256: v2.sha256,
  manifest: v2.manifest,
  status: 'installed',
  createdResources: {
    projectCreated: false,
    ruleSetIds: ['rs-a', 'rs-b'],
    schemaIdsCreated: ['sch-items'],
    aliasName: 'fixture-app',
    deploymentId: 'dep-fixture-2',
    scheduleIds: [],
  },
  installedBy: 'user-1',
  installedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
} as unknown as InstalledApp;

describe('App catalog orchestration (fixture bundle, real bytes + real manifest validation)', () => {
  let jobs: AppInstallJobsService;
  let bundleService: AppBundleService;
  let service: AppInstallerService;
  let fetchSpy: jest.SpyInstance;
  let preflight: { instanceGates: jest.Mock; projectGates: jest.Mock };
  let certStep: { plan: jest.Mock; execute: jest.Mock };
  let ruleSets: { syncRuleSet: jest.Mock; delete: jest.Mock };
  let deployments: {
    createDeploymentFromZip: jest.Mock;
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
    bundleService = new AppBundleService();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(((url: string) => {
      if (url === ENTRY_V1.bundleUrl) return Promise.resolve(fetchResponse(v1.buf));
      if (url === ENTRY_V2.bundleUrl) return Promise.resolve(fetchResponse(v2.buf));
      return Promise.reject(new Error(`unexpected fetch url: ${url}`));
    }) as typeof fetch);

    preflight = {
      instanceGates: jest.fn().mockResolvedValue([]),
      projectGates: jest.fn().mockResolvedValue({ gates: [], syncPlans: [], appHost: null }),
    };
    certStep = { plan: jest.fn(), execute: jest.fn() }; // unused: the fixture manifest declares no domain
    ruleSets = { syncRuleSet: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) };
    deployments = {
      createDeploymentFromZip: jest.fn().mockResolvedValue(deployResponse()),
      deleteDeployment: jest.fn().mockResolvedValue(undefined),
      deleteAlias: jest.fn().mockResolvedValue(undefined),
    };
    domains = { create: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
    projects = {
      findOrCreateProject: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
      projectExists: jest.fn().mockResolvedValue(true),
      getProjectById: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
      deleteProject: jest.fn().mockResolvedValue(undefined),
    };
    schedules = {
      listPipelineRules: jest.fn().mockResolvedValue([]),
      listSchedules: jest.fn().mockResolvedValue([]),
      createSchedule: jest.fn(),
      deleteSchedule: jest.fn().mockResolvedValue(undefined),
    };
    schemas = { delete: jest.fn().mockResolvedValue(undefined), getByIdWithCount: jest.fn() };
    config = { get: jest.fn((key: string) => (key === 'PRIMARY_DOMAIN' ? 'example.com' : undefined)) };

    service = new AppInstallerService(
      jobs,
      bundleService,
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

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function queueInstallDb() {
    mockDb.__queue([]); // select existing installed_apps row (none)
    mockDb.__queue([{ ...POST_UPDATE_ROW, id: 'ia-fixture', version: '1.0.0', status: 'installing' }]); // insert ... returning
    mockDb.__queue([]); // extra buffer (unused, non-`.returning()` awaits don't destructure)
  }

  it('installs v1 from real bundle bytes: manifest + rule-set DTOs validated for real, bookkeeping recorded', async () => {
    ruleSets.syncRuleSet
      .mockReset()
      .mockResolvedValueOnce({
        ruleSetId: 'rs-a',
        created: [{ pathPattern: '/api/items', method: 'GET' }],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [{ name: 'fixture_items', action: 'create', targetSchemaId: 'sch-items', fieldMismatch: false }],
        missingSecrets: [],
        warnings: [],
        dryRun: false,
        setCreated: true,
      })
      .mockResolvedValueOnce({
        ruleSetId: 'rs-b',
        created: [{ pathPattern: '/api/notes', method: 'GET' }],
        updated: [],
        deleted: [],
        unchanged: [],
        pruneCandidates: [],
        schemaResolutions: [
          { name: 'fixture_items', action: 'reuse', targetSchemaId: 'sch-items', fieldMismatch: false },
          { name: 'fixture_notes', action: 'create', targetSchemaId: 'sch-notes', fieldMismatch: false },
        ],
        missingSecrets: [],
        warnings: [],
        dryRun: false,
        setCreated: true,
      });
    queueInstallDb();

    const { jobId } = service.startInstall(ENTRY_V1, { projectId: 'proj-1' }, 'user-1');
    await service.whenIdle();

    const job = jobs.get(jobId)!;
    expect(job.status).toBe('succeeded');
    expect(job.steps.filter((s) => s.status === 'failed')).toHaveLength(0);
    expect(job.steps.find((s) => s.id === 'domain')!.status).toBe('skipped');
    expect(job.steps.find((s) => s.id === 'certificate')!.status).toBe('skipped');
    expect(job.steps.find((s) => s.id === 'schedules')!.status).toBe('skipped');

    // Real network fetch happened once (preflight + fetch steps share the sha256 cache).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(ENTRY_V1.bundleUrl, expect.anything());

    expect(ruleSets.syncRuleSet).toHaveBeenCalledTimes(2);
    expect(ruleSets.syncRuleSet.mock.calls[0][1].ruleSet.name).toBe('fixture-app-a');
    expect(ruleSets.syncRuleSet.mock.calls[1][1].ruleSet.name).toBe('fixture-app-b');
    expect(ruleSets.syncRuleSet.mock.calls[0][1].options).toEqual({ dryRun: false, prune: false });

    const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
      status: string;
      version: string;
      bundleSha256: string;
      ruleSetIds: string[];
      schemaIds: string[];
      createdResources: CreatedResources;
    };
    expect(finalUpdate.status).toBe('installed');
    expect(finalUpdate.version).toBe('1.0.0');
    expect(finalUpdate.bundleSha256).toBe(v1.sha256);
    expect(finalUpdate.ruleSetIds).toEqual(['rs-a', 'rs-b']);
    expect(finalUpdate.schemaIds).toEqual(['sch-items', 'sch-notes']);
    expect(finalUpdate.createdResources.ruleSetIds).toEqual(['rs-a', 'rs-b']);
    expect(finalUpdate.createdResources.schemaIdsCreated).toEqual(['sch-items', 'sch-notes']);

    // Real zip built from real bundle bytes: only dist/, re-keyed under basePath.
    const { unzipSync } = jest.requireActual('fflate') as typeof import('fflate');
    const zippedFile = deployments.createDeploymentFromZip.mock.calls[0][0] as { buffer: Buffer };
    const entries = Object.keys(unzipSync(new Uint8Array(zippedFile.buffer))).sort();
    expect(entries).toEqual(['apps/fixture-app/dist/index.html']);
  });

  it('updates to v2 from real bundle bytes: same alias redeployed, prune false, version bumped', async () => {
    const installedAfterV1: InstalledApp = {
      ...POST_UPDATE_ROW,
      version: '1.0.0',
      bundleSha256: v1.sha256,
      manifest: v1.manifest,
      deploymentId: 'dep-fixture-1',
      createdResources: {
        ...POST_UPDATE_ROW.createdResources,
        schemaIdsCreated: ['sch-items', 'sch-notes'],
        deploymentId: 'dep-fixture-1',
      },
    };
    ruleSets.syncRuleSet
      .mockReset()
      .mockResolvedValueOnce({
        ruleSetId: 'rs-a',
        created: [],
        updated: [],
        deleted: [],
        unchanged: [{ pathPattern: '/api/items', method: 'GET' }],
        pruneCandidates: [],
        schemaResolutions: [{ name: 'fixture_items', action: 'reuse', targetSchemaId: 'sch-items', fieldMismatch: false }],
        missingSecrets: [],
        warnings: [],
        dryRun: false,
        setCreated: false,
      })
      .mockResolvedValueOnce({
        ruleSetId: 'rs-b',
        created: [{ pathPattern: '/api/notes', method: 'POST' }],
        updated: [],
        deleted: [],
        unchanged: [{ pathPattern: '/api/notes', method: 'GET' }],
        pruneCandidates: [],
        schemaResolutions: [
          { name: 'fixture_items', action: 'reuse', targetSchemaId: 'sch-items', fieldMismatch: false },
          { name: 'fixture_notes', action: 'reuse', targetSchemaId: 'sch-notes', fieldMismatch: false },
        ],
        missingSecrets: [],
        warnings: [],
        dryRun: false,
        setCreated: false,
      });
    deployments.createDeploymentFromZip.mockResolvedValue(deployResponse({ deploymentId: 'dep-fixture-2' }));
    mockDb.__queue([]); // final record update — startUpdate takes the row directly, no db read

    const { jobId } = service.startUpdate(installedAfterV1, ENTRY_V2, 'user-1', { prune: false });
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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(ENTRY_V2.bundleUrl, expect.anything());

    // prune false, on both synced rule sets
    expect(ruleSets.syncRuleSet.mock.calls[0][1].options).toEqual({ dryRun: false, prune: false });
    expect(ruleSets.syncRuleSet.mock.calls[1][1].options).toEqual({ dryRun: false, prune: false });

    // Same alias redeployed — not a new one.
    const [zippedFile, deployDto] = deployments.createDeploymentFromZip.mock.calls[0] as [
      { buffer: Buffer },
      { alias: string },
    ];
    expect(deployDto.alias).toBe('fixture-app');
    expect(domains.create).not.toHaveBeenCalled(); // update never touches the domain step

    const finalUpdate = mockDb.set.mock.calls.at(-1)![0] as {
      status: string;
      version: string;
      bundleSha256: string;
      deploymentId: string;
    };
    expect(finalUpdate.status).toBe('installed');
    expect(finalUpdate.version).toBe('2.0.0');
    expect(finalUpdate.bundleSha256).toBe(v2.sha256);
    expect(finalUpdate.deploymentId).toBe('dep-fixture-2');

    // Real v2 zip: dist/ changed — index.html content differs and assets/app.js is new.
    const { unzipSync } = jest.requireActual('fflate') as typeof import('fflate');
    const entries = Object.keys(unzipSync(new Uint8Array(zippedFile.buffer))).sort();
    expect(entries).toEqual(['apps/fixture-app/dist/assets/app.js', 'apps/fixture-app/dist/index.html']);
  });

  describe('uninstall (post v1-install, v2-update state)', () => {
    beforeEach(() => {
      schemas.getByIdWithCount = jest.fn((id: string) => {
        if (id === 'sch-items') return Promise.resolve({ id, name: 'fixture_items', recordCount: 5 });
        return Promise.resolve({ id, name: 'fixture_notes', recordCount: 12 });
      });
    });

    it('keep-data: keeps every data table and never calls schema delete', async () => {
      mockDb.__queue([POST_UPDATE_ROW]);
      mockDb.__queue([]); // delete installed_apps row

      const summary = await service.uninstall('ia-fixture', 'user-1', { deleteData: false });

      expect(schemas.delete).not.toHaveBeenCalled();
      expect(ruleSets.delete).toHaveBeenCalledTimes(2);
      expect(deployments.deleteAlias).toHaveBeenCalledWith('acme/site', 'fixture-app', 'user-1', 'admin');
      expect(deployments.deleteDeployment).toHaveBeenCalledWith('dep-fixture-2', 'user-1', 'admin');
      expect(summary.dataTables.deleted).toEqual([]);
      expect(summary.dataTables.kept.slice().sort()).toEqual(['fixture_items', 'fixture_notes']);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('delete-data: deletes only the table this install created, keeps the adopted one', async () => {
      mockDb.__queue([POST_UPDATE_ROW]);
      mockDb.__queue([]);

      const summary = await service.uninstall('ia-fixture', 'user-1', { deleteData: true });

      expect(schemas.delete).toHaveBeenCalledTimes(1);
      expect(schemas.delete).toHaveBeenCalledWith('sch-items', 'user-1', 'admin', null);
      expect(schemas.delete).not.toHaveBeenCalledWith('sch-notes', 'user-1', 'admin', null);
      expect(summary.dataTables.deleted).toEqual(['fixture_items']);
      expect(summary.dataTables.kept).toEqual(['fixture_notes']);
      expect(summary.dataTables.deletedRecordCounts).toEqual({ fixture_items: 5 });
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
