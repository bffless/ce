// Thenable chainable db mock — same house pattern as app-installer.service.spec.ts.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'limit', 'update', 'set', 'returning'];
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
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '../db/client';
import { AppCatalogService } from './app-catalog.service';
import type { AppManifest, AppRegistryEntry } from './app-manifest.types';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (result: unknown) => void;
  __reset: () => void;
};

const MANIFEST: AppManifest = {
  schemaVersion: 1,
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  install: {
    alias: 'handoff',
    deployment: { path: 'dist', basePath: '/apps/handoff/dist' },
    ruleSets: [{ file: 'rulesets/handoff.json' }],
    manualSteps: [
      { id: 'bucket-cors', title: 'CORS', body: 'set it up', appliesWhen: 'bucketStorage' },
      { id: 'always-step', title: 'Always', body: 'always applies' },
    ],
  },
  eject: {
    repo: 'bffless/apps',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    variables: ['BFFLESS_URL', 'BFFLESS_PROJECT'],
    secrets: ['BFFLESS_API_KEY'],
  },
};

const LEGACY_MANIFEST: AppManifest = {
  schemaVersion: 1,
  id: 'legacy-app',
  name: 'Legacy App',
  version: '1.0.0',
  install: {
    alias: 'legacy-app',
    deployment: { path: 'dist', basePath: '/apps/legacy-app/dist' },
    ruleSets: [{ file: 'rulesets/legacy-app.json' }],
  },
};

const ROW = {
  id: 'ia-1',
  appId: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  projectId: 'proj-1',
  alias: 'handoff',
  domainId: null,
  deploymentId: 'dep-1',
  ruleSetIds: ['rs-1'],
  schemaIds: [] as string[],
  bundleSha256: 'a'.repeat(64),
  manifest: MANIFEST,
  manualStepsAcked: [] as string[],
  status: 'installed' as const,
  createdResources: {},
  installedBy: 'user-1',
  installedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const LEGACY_ROW = {
  ...ROW,
  id: 'ia-legacy',
  appId: 'legacy-app',
  name: 'Legacy App',
  manifest: LEGACY_MANIFEST,
};

const HANDOFF_ENTRY: AppRegistryEntry = {
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  bundleUrl: 'https://apps.bffless.dev/handoff.zip',
  sha256: 'a'.repeat(64),
  requires: { presignedStorage: true },
};

describe('AppCatalogService', () => {
  let service: AppCatalogService;
  let projects: { getProjectById: jest.Mock };
  let config: { get: jest.Mock };
  let registry: { getRegistry: jest.Mock };
  let bundle: { fetchBundle: jest.Mock };
  let preflight: { instanceGates: jest.Mock; projectGates: jest.Mock };
  let installer: {
    startInstall: jest.Mock;
    startUpdate: jest.Mock;
    undo: jest.Mock;
    uninstall: jest.Mock;
    uninstallPreview: jest.Mock;
  };
  let jobs: { get: jest.Mock };
  let storageAdapter: { supportsPresignedUrls: jest.Mock; getAdapterType?: jest.Mock };

  beforeEach(() => {
    mockDb.__reset();
    projects = {
      getProjectById: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    registry = {
      getRegistry: jest.fn().mockResolvedValue({ ok: true, registry: { schemaVersion: 1, apps: [] } }),
    };
    bundle = { fetchBundle: jest.fn() };
    preflight = {
      instanceGates: jest.fn().mockResolvedValue([{ id: 'storage', status: 'pass', message: 'ok' }]),
      projectGates: jest.fn().mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [],
        appHost: null,
      }),
    };
    installer = {
      startInstall: jest.fn().mockReturnValue({ jobId: 'job-1' }),
      startUpdate: jest.fn().mockReturnValue({ jobId: 'job-2' }),
      undo: jest.fn().mockResolvedValue({ removed: ['ruleSet:rs-1'] }),
      uninstall: jest.fn().mockResolvedValue({ removed: {}, dataTables: {}, note: 'note' }),
      uninstallPreview: jest.fn().mockResolvedValue({ dataTables: [] }),
    };
    jobs = { get: jest.fn() };
    storageAdapter = {
      supportsPresignedUrls: jest.fn().mockReturnValue(true),
      getAdapterType: jest.fn().mockReturnValue('LocalStorageAdapter'),
    };

    service = new AppCatalogService(
      projects as never,
      config as unknown as ConfigService,
      registry as never,
      bundle as never,
      preflight as never,
      installer as never,
      jobs as never,
      storageAdapter as never,
    );
  });

  describe('ejectPayload', () => {
    it('derives BFFLESS_URL from https://admin.PRIMARY_DOMAIN when PUBLIC_ORIGIN is unset', async () => {
      config.get.mockImplementation((key: string) => (key === 'PRIMARY_DOMAIN' ? 'example.com' : undefined));
      mockDb.__queue([ROW]);

      const payload = await service.ejectPayload('ia-1');

      expect(payload.variables.BFFLESS_URL).toBe('https://admin.example.com');
      expect(payload.variables.BFFLESS_PROJECT).toBe('acme/site');
      expect(payload.repo).toBe('bffless/apps');
      expect(payload.appPath).toBe('apps/handoff');
      expect(payload.deployWorkflow).toBe('deploy-handoff.yml');
      expect(payload.forkUrl).toBe('https://github.com/bffless/apps/fork');
      expect(payload.secrets).toEqual(['BFFLESS_API_KEY']);
      expect(payload.alias).toBe('handoff');
      expect(payload.note).toMatch(/same alias/i);
    });

    it('prefers an explicit PUBLIC_ORIGIN over PRIMARY_DOMAIN', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'PUBLIC_ORIGIN') return 'https://my-bffless.example/';
        if (key === 'PRIMARY_DOMAIN') return 'example.com';
        return undefined;
      });
      mockDb.__queue([ROW]);

      const payload = await service.ejectPayload('ia-1');

      expect(payload.variables.BFFLESS_URL).toBe('https://my-bffless.example');
    });

    it('throws when the installed app is not found', async () => {
      mockDb.__queue([]);

      await expect(service.ejectPayload('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('ackManualStep', () => {
    it('appends a step id to the acked list', async () => {
      mockDb.__queue([{ ...ROW, manualStepsAcked: ['bucket-cors'] }]);
      mockDb.__queue([]); // update

      const acked = await service.ackManualStep('ia-1', 'platform-only');

      expect(acked).toEqual(expect.arrayContaining(['bucket-cors', 'platform-only']));
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ manualStepsAcked: expect.arrayContaining(['bucket-cors', 'platform-only']) }),
      );
    });

    it('is idempotent — double-acking the same step does not duplicate it', async () => {
      mockDb.__queue([{ ...ROW, manualStepsAcked: ['bucket-cors'] }]);
      mockDb.__queue([]);

      const acked = await service.ackManualStep('ia-1', 'bucket-cors');

      expect(acked).toEqual(['bucket-cors']);
    });
  });

  describe('listCatalog', () => {
    it('lists a registry app with no installs: instance gates only, installable true, no installed block', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      mockDb.__queue([]); // no installed rows

      const result = await service.listCatalog();

      expect(preflight.instanceGates).toHaveBeenCalledWith(HANDOFF_ENTRY.requires);
      expect(result.registryError).toBeUndefined();
      expect(result.data).toEqual([
        {
          id: 'handoff',
          name: 'Handoff',
          summary: undefined,
          iconUrl: undefined,
          docsUrl: undefined,
          sourceUrl: undefined,
          registryVersion: '1.0.0',
          gates: [{ id: 'storage', status: 'pass', message: 'ok' }],
          installable: true,
        },
      ]);
    });

    it('marks a registry app not-installable when an instance gate fails', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      preflight.instanceGates.mockResolvedValue([{ id: 'storage', status: 'fail', message: 'nope' }]);
      mockDb.__queue([]);

      const result = await service.listCatalog();

      expect(result.data[0].installable).toBe(false);
    });

    it('attaches the installed summary, computing updateAvailable via compareSemver', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [{ ...HANDOFF_ENTRY, version: '1.1.0' }] },
      });
      mockDb.__queue([ROW]); // one installed row, version 1.0.0
      storageAdapter.supportsPresignedUrls.mockReturnValue(true);

      const result = await service.listCatalog();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].installed).toEqual({
        installedAppId: 'ia-1',
        version: '1.0.0',
        projectId: 'proj-1',
        projectName: 'acme/site',
        alias: 'handoff',
        appUrl: undefined,
        status: 'installed',
        updateAvailable: true, // 1.1.0 > 1.0.0
        manualSteps: [{ id: 'always-step', title: 'Always', body: 'always applies' }],
        manualStepsAcked: [],
      });
    });

    it('updateAvailable is false when the installed version already matches the registry', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] }, // version 1.0.0, same as ROW
      });
      mockDb.__queue([ROW]);

      const result = await service.listCatalog();

      expect(result.data[0].installed!.updateAvailable).toBe(false);
    });

    it('degrades to registryError while still listing installed apps', async () => {
      registry.getRegistry.mockResolvedValue({ ok: false, error: 'registry unreachable' });
      mockDb.__queue([ROW]);

      const result = await service.listCatalog();

      expect(result.registryError).toBe('registry unreachable');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('handoff');
      expect(result.data[0].registryVersion).toBeUndefined();
      expect(result.data[0].installable).toBe(false);
      expect(result.data[0].installed!.installedAppId).toBe('ia-1');
      // instanceGates computed from the stored manifest's requires, not a registry entry.
      expect(preflight.instanceGates).toHaveBeenCalledWith(undefined);
    });

    it('renders an installed app that is no longer present in a healthy registry', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [] }, // handoff removed from the registry
      });
      mockDb.__queue([ROW]);

      const result = await service.listCatalog();

      expect(result.registryError).toBeUndefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].registryVersion).toBeUndefined();
      expect(result.data[0].installable).toBe(false);
      expect(result.data[0].installed!.installedAppId).toBe('ia-1');
    });

    it('lists multiple unrelated installed-only apps alongside registry apps', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      mockDb.__queue([ROW, LEGACY_ROW]);

      const result = await service.listCatalog();

      const ids = result.data.map((e) => e.id).sort();
      expect(ids).toEqual(['handoff', 'legacy-app']);
    });
  });

  describe('preflight', () => {
    it('combines instance and project gates and derives appUrl from appHost', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      bundle.fetchBundle.mockResolvedValue({ manifest: MANIFEST, files: {}, sha256: 'a'.repeat(64) });
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [{ ruleSet: 'handoff', created: 1, updated: 0, unchanged: 0, pruneCandidates: 0, schemaResolutions: [] }],
        appHost: 'handoff.example.com',
      });

      const result = await service.preflight('handoff', { projectId: 'proj-1' } as never, 'user-1');

      expect(bundle.fetchBundle).toHaveBeenCalledWith(HANDOFF_ENTRY.bundleUrl, HANDOFF_ENTRY.sha256);
      expect(preflight.projectGates).toHaveBeenCalledWith(
        { manifest: MANIFEST, files: {}, sha256: 'a'.repeat(64) },
        { projectId: 'proj-1' },
        'user-1',
      );
      expect(result.gates).toEqual([
        { id: 'storage', status: 'pass', message: 'ok' },
        { id: 'dns', status: 'pass', message: 'ok' },
      ]);
      expect(result.syncPlans).toHaveLength(1);
      expect(result.appHost).toBe('handoff.example.com');
      expect(result.appUrl).toBe('https://handoff.example.com');
    });

    it('throws NotFoundException for an app id not in the registry', async () => {
      registry.getRegistry.mockResolvedValue({ ok: true, registry: { schemaVersion: 1, apps: [] } });

      await expect(
        service.preflight('unknown-app', { projectId: 'proj-1' } as never, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the registry is unavailable', async () => {
      registry.getRegistry.mockResolvedValue({ ok: false, error: 'boom' });

      await expect(
        service.preflight('handoff', { projectId: 'proj-1' } as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither projectId nor newProject is given', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });

      await expect(service.preflight('handoff', {} as never, 'user-1')).rejects.toThrow(BadRequestException);
      expect(bundle.fetchBundle).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when both projectId and newProject are given', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });

      await expect(
        service.preflight(
          'handoff',
          { projectId: 'proj-1', newProject: { owner: 'acme', name: 'site' } } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('install', () => {
    it('resolves the registry entry and target, then delegates to the installer', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });

      const result = await service.install(
        'handoff',
        { newProject: { owner: 'acme', name: 'site' } } as never,
        'user-1',
      );

      expect(installer.startInstall).toHaveBeenCalledWith(
        HANDOFF_ENTRY,
        { newProject: { owner: 'acme', name: 'site' } },
        'user-1',
      );
      expect(result).toEqual({ jobId: 'job-1' });
    });

    it('throws NotFoundException for an unknown app id', async () => {
      registry.getRegistry.mockResolvedValue({ ok: true, registry: { schemaVersion: 1, apps: [] } });

      await expect(service.install('unknown', { projectId: 'proj-1' } as never, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(installer.startInstall).not.toHaveBeenCalled();
    });
  });

  describe('updateInstalled', () => {
    it('loads the row, resolves the matching registry entry, and delegates to the installer', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [{ ...HANDOFF_ENTRY, version: '1.1.0' }] },
      });
      mockDb.__queue([ROW]);

      const result = await service.updateInstalled('ia-1', true, 'user-1');

      expect(installer.startUpdate).toHaveBeenCalledWith(
        ROW,
        { ...HANDOFF_ENTRY, version: '1.1.0' },
        'user-1',
        { prune: true },
      );
      expect(result).toEqual({ jobId: 'job-2' });
    });

    it('throws NotFoundException when the installed app row does not exist', async () => {
      mockDb.__queue([]);

      await expect(service.updateInstalled('missing', false, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the app is no longer in the registry', async () => {
      registry.getRegistry.mockResolvedValue({ ok: true, registry: { schemaVersion: 1, apps: [] } });
      mockDb.__queue([ROW]);

      await expect(service.updateInstalled('ia-1', false, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getJob', () => {
    it('returns the job when found', () => {
      jobs.get.mockReturnValue({ id: 'job-1', status: 'running' });

      expect(service.getJob('job-1')).toEqual({ id: 'job-1', status: 'running' });
    });

    it('throws NotFoundException for an unknown job id', () => {
      jobs.get.mockReturnValue(null);

      expect(() => service.getJob('missing')).toThrow(NotFoundException);
    });
  });

  describe('undoJob', () => {
    it('refuses to undo an update — that would delete the original install and its data tables', async () => {
      // createdResources is cumulative, so undo on an update job would tear
      // down the ORIGINAL install: rule sets, alias, domain, deployment and
      // (undo passes includeSchemas: true) its populated data tables.
      jobs.get.mockReturnValue({
        id: 'job-2',
        kind: 'update',
        installedAppId: 'ia-1',
        status: 'failed',
      });

      await expect(service.undoJob('job-2', 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.undoJob('job-2', 'user-1')).rejects.toThrow(/alias/i);
      expect(installer.undo).not.toHaveBeenCalled();
    });

    it('delegates to installer.undo using the job’s installedAppId', async () => {
      jobs.get.mockReturnValue({
        id: 'job-1',
        kind: 'install',
        installedAppId: 'ia-1',
        status: 'failed',
      });

      const result = await service.undoJob('job-1', 'user-1');

      expect(installer.undo).toHaveBeenCalledWith('ia-1', 'user-1');
      expect(result).toEqual({ removed: ['ruleSet:rs-1'] });
    });

    it('returns an empty removal with no installer call when the job never reached a row', async () => {
      jobs.get.mockReturnValue({ id: 'job-1', kind: 'install', status: 'failed' });

      const result = await service.undoJob('job-1', 'user-1');

      expect(installer.undo).not.toHaveBeenCalled();
      expect(result).toEqual({ removed: [] });
    });

    it('throws NotFoundException for an unknown job id', async () => {
      jobs.get.mockReturnValue(null);

      await expect(service.undoJob('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('uninstallPreview / uninstall', () => {
    it('uninstallPreview delegates straight to the installer', async () => {
      await service.uninstallPreview('ia-1');
      expect(installer.uninstallPreview).toHaveBeenCalledWith('ia-1');
    });

    it('uninstall delegates with the deleteData option', async () => {
      await service.uninstall('ia-1', true, 'user-1');
      expect(installer.uninstall).toHaveBeenCalledWith('ia-1', 'user-1', { deleteData: true });
    });
  });
});
