// Thenable chainable db mock — same house pattern as app-installer.service.spec.ts.
jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'limit', 'update', 'set', 'returning'];
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
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
  let certStep: { schemeFor: jest.Mock; plan: jest.Mock; execute: jest.Mock };
  let storageAdapter: {
    supportsPresignedUrls: jest.Mock;
    isLocalAdapter?: boolean;
    getUnderlyingAdapter?: jest.Mock;
  };

  beforeEach(() => {
    mockDb.__reset();
    projects = {
      getProjectById: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    registry = {
      getRegistry: jest
        .fn()
        .mockResolvedValue({ ok: true, registry: { schemaVersion: 1, apps: [] } }),
    };
    bundle = { fetchBundle: jest.fn() };
    preflight = {
      instanceGates: jest
        .fn()
        .mockResolvedValue([{ id: 'storage', status: 'pass', message: 'ok' }]),
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
    // Default serving model for these tests: a certificate covers the app host,
    // so URLs are https. Scheme selection itself is covered in
    // app-cert-step.service.spec.ts.
    certStep = {
      schemeFor: jest.fn().mockResolvedValue('https'),
      plan: jest.fn().mockResolvedValue({ model: 'wildcard', action: 'covered' }),
      execute: jest.fn().mockResolvedValue({ status: 'done', detail: 'covered' }),
    };
    storageAdapter = {
      supportsPresignedUrls: jest.fn().mockReturnValue(true),
      // Brands as local the way `resolveLocalAdapter` expects (see local.adapter.ts):
      // the real LocalStorageAdapter carries `readonly isLocalAdapter = true`.
      isLocalAdapter: true,
    };

    service = new AppCatalogService(
      projects as never,
      config as unknown as ConfigService,
      registry as never,
      bundle as never,
      preflight as never,
      installer as never,
      jobs as never,
      certStep as never,
      storageAdapter as never,
    );
  });

  describe('ejectPayload', () => {
    it('derives BFFLESS_URL from https://admin.PRIMARY_DOMAIN when PUBLIC_ORIGIN is unset', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'PRIMARY_DOMAIN' ? 'example.com' : undefined,
      );
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
          description: undefined,
          category: undefined,
          iconUrl: undefined,
          thumbnailUrl: undefined,
          screenshots: undefined,
          docsUrl: undefined,
          sourceUrl: undefined,
          registryVersion: '1.0.0',
          gates: [{ id: 'storage', status: 'pass', message: 'ok' }],
          installable: true,
          installs: [],
        },
      ]);
    });

    it('passes the store-presentation fields through to the catalog entry', async () => {
      // Admin -> Apps renders these (ce#590); they must survive the explicit
      // field-by-field copy in buildRegistryEntry rather than be dropped.
      const entry: AppRegistryEntry = {
        ...HANDOFF_ENTRY,
        summary: 'Share files with clients',
        description: '## Handoff\n\nShare files.',
        category: 'files',
        iconUrl: 'https://apps.example.com/assets/handoff/icon.png',
        thumbnailUrl: 'https://apps.example.com/assets/handoff/thumbnail.png',
        screenshots: ['https://apps.example.com/assets/handoff/screenshots/01.png'],
        docsUrl: 'https://example.com/docs',
        sourceUrl: 'https://github.com/bffless/apps',
      };
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [entry] },
      });
      mockDb.__queue([]);

      const result = await service.listCatalog();

      expect(result.data[0]).toMatchObject({
        summary: entry.summary,
        description: entry.description,
        category: entry.category,
        iconUrl: entry.iconUrl,
        thumbnailUrl: entry.thumbnailUrl,
        screenshots: entry.screenshots,
        docsUrl: entry.docsUrl,
        sourceUrl: entry.sourceUrl,
      });
    });

    it('marks a registry app not-installable when an instance gate fails', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      preflight.instanceGates.mockResolvedValue([
        { id: 'storage', status: 'fail', message: 'nope' },
      ]);
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
      expect(result.data[0].installs).toEqual([
        {
          installedAppId: 'ia-1',
          version: '1.0.0',
          projectId: 'proj-1',
          projectName: 'acme/site',
          alias: 'handoff',
          appUrl: undefined,
          status: 'installed',
          updateAvailable: true, // 1.1.0 > 1.0.0
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          manualSteps: [{ id: 'always-step', title: 'Always', body: 'always applies' }],
        },
      ]);
    });

    it('lists every install of the same app, oldest first, each with its own version and updateAvailable', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [{ ...HANDOFF_ENTRY, version: '1.1.0' }] },
      });
      const rowB = {
        ...ROW,
        id: 'ia-2',
        projectId: 'proj-2',
        version: '1.1.0',
        installedAt: new Date('2026-02-01T00:00:00Z'),
        updatedAt: new Date('2026-03-01T00:00:00Z'),
      };
      // Most recently touched row first in the DB result — ordering must not
      // depend on it.
      mockDb.__queue([rowB, ROW]);
      projects.getProjectById.mockImplementation(async (id: string) =>
        id === 'proj-2'
          ? { id: 'proj-2', owner: 'acme', name: 'blog' }
          : { id: 'proj-1', owner: 'acme', name: 'site' },
      );

      const result = await service.listCatalog();

      expect(result.data).toHaveLength(1);
      const installs = result.data[0].installs;
      expect(installs.map((i) => i.installedAppId)).toEqual(['ia-1', 'ia-2']);
      expect(installs.map((i) => i.projectName)).toEqual(['acme/site', 'acme/blog']);
      expect(installs.map((i) => i.version)).toEqual(['1.0.0', '1.1.0']);
      expect(installs.map((i) => i.updateAvailable)).toEqual([true, false]);
    });

    it('does not treat a CachingStorageAdapter-wrapped local adapter as bucket storage (regression: live droplet Redis cache)', async () => {
      // Shape observed live: STORAGE_ADAPTER is a CachingStorageAdapter wrapping the real
      // LocalStorageAdapter. It has no getAdapterType(), so the old `getAdapterType?.() ??
      // constructor.name` fallback resolved to 'CachingStorageAdapter' -> bucketStorage=true,
      // wrongly surfacing the bucket-cors manual step on a local-FS install.
      storageAdapter.isLocalAdapter = undefined;
      storageAdapter.getUnderlyingAdapter = jest.fn().mockReturnValue({ isLocalAdapter: true });
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      mockDb.__queue([ROW]);

      const result = await service.listCatalog();

      expect(result.data[0].installs[0].manualSteps).toEqual([
        { id: 'always-step', title: 'Always', body: 'always applies' },
      ]);
    });

    it('updateAvailable is false when the installed version already matches the registry', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] }, // version 1.0.0, same as ROW
      });
      mockDb.__queue([ROW]);

      const result = await service.listCatalog();

      expect(result.data[0].installs[0].updateAvailable).toBe(false);
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
      expect(result.data[0].installs[0].installedAppId).toBe('ia-1');
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
      expect(result.data[0].installs[0].installedAppId).toBe('ia-1');
    });

    it('renders a delisted app with two installs as one entry carrying both installs', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [] },
      });
      mockDb.__queue([LEGACY_ROW, { ...LEGACY_ROW, id: 'ia-legacy-2', projectId: 'proj-2' }]);

      const result = await service.listCatalog();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('legacy-app');
      expect(result.data[0].installable).toBe(false);
      expect(result.data[0].installs.map((i) => i.installedAppId)).toEqual([
        'ia-legacy',
        'ia-legacy-2',
      ]);
      expect(result.data[0].installs.every((i) => i.updateAvailable === false)).toBe(true);
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

    describe('appUrl (regression: catalog card linked to the manifest default, not the actual install)', () => {
      // Manifest default subdomain is "handoff" — the operator overrode it to
      // "files" at install time, so the domain row is files.example.com. The
      // card's "Open" link must follow the row, not the manifest.
      const MANIFEST_WITH_DOMAIN: AppManifest = {
        ...MANIFEST,
        install: { ...MANIFEST.install, domain: { subdomain: 'handoff' } },
      };

      it('resolves appUrl from the stored domain row, not the manifest default subdomain', async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        mockDb.__queue([{ ...ROW, manifest: MANIFEST_WITH_DOMAIN, domainId: 'dom-1' }]);
        mockDb.__queue([{ id: 'dom-1', domain: 'files.example.com' }]);

        const result = await service.listCatalog();

        expect(result.data[0].installs[0].appUrl).toBe('https://files.example.com');
      });

      it('links http:// when the serving model has no certificate for the host yet (ce#584)', async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        mockDb.__queue([{ ...ROW, manifest: MANIFEST_WITH_DOMAIN, domainId: 'dom-1' }]);
        mockDb.__queue([{ id: 'dom-1', domain: 'files.example.com', sslEnabled: false }]);
        certStep.schemeFor.mockResolvedValue('http');

        const result = await service.listCatalog();

        expect(certStep.schemeFor).toHaveBeenCalledWith('files.example.com', false);
        expect(result.data[0].installs[0].appUrl).toBe('http://files.example.com');
      });

      it("passes the row's sslEnabled through, so an edge-terminated install still links https", async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        mockDb.__queue([{ ...ROW, manifest: MANIFEST_WITH_DOMAIN, domainId: 'dom-1' }]);
        mockDb.__queue([{ id: 'dom-1', domain: 'files.example.com', sslEnabled: true }]);

        const result = await service.listCatalog();

        expect(certStep.schemeFor).toHaveBeenCalledWith('files.example.com', true);
        expect(result.data[0].installs[0].appUrl).toBe('https://files.example.com');
      });

      it('yields undefined appUrl when domainId points at a since-deleted mapping', async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        mockDb.__queue([{ ...ROW, manifest: MANIFEST_WITH_DOMAIN, domainId: 'dom-gone' }]);
        mockDb.__queue([]); // domain mapping no longer exists

        const result = await service.listCatalog();

        expect(result.data[0].installs[0].appUrl).toBeUndefined();
      });

      it('yields undefined appUrl with no domainId lookup at all when the row has none', async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        mockDb.__queue([{ ...ROW, manifest: MANIFEST_WITH_DOMAIN, domainId: null }]);

        const result = await service.listCatalog();

        expect(result.data[0].installs[0].appUrl).toBeUndefined();
        // No domainId anywhere -> the batch query is skipped entirely (only
        // the installedApps row select happened).
        expect(mockDb.select).toHaveBeenCalledTimes(1);
      });

      it('batches the domain lookup into a single query for multiple installed rows (no N+1)', async () => {
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        const rowA = {
          ...ROW,
          id: 'ia-1',
          appId: 'handoff',
          manifest: MANIFEST_WITH_DOMAIN,
          domainId: 'dom-1',
        };
        const rowB = { ...LEGACY_ROW, id: 'ia-legacy', appId: 'legacy-app', domainId: 'dom-2' };
        mockDb.__queue([rowA, rowB]);
        mockDb.__queue([
          { id: 'dom-1', domain: 'files.example.com' },
          { id: 'dom-2', domain: 'legacy.example.com' },
        ]);

        const result = await service.listCatalog();

        // One select() for the installedApps rows, one for the batched domain
        // lookup — never one per row (N rows here, still 2 selects total).
        expect(mockDb.select).toHaveBeenCalledTimes(2);
        expect(mockDb.where).toHaveBeenCalledTimes(1);

        const handoff = result.data.find((e) => e.id === 'handoff')!;
        const legacy = result.data.find((e) => e.id === 'legacy-app')!;
        expect(handoff.installs[0].appUrl).toBe('https://files.example.com');
        expect(legacy.installs[0].appUrl).toBe('https://legacy.example.com');
      });
    });
  });

  describe('installed manual steps', () => {
    // These four cases need an appHost the service can resolve — without a
    // domainId (ROW's default is null), buildInstalledSummary never even
    // calls certStepService, so the cert-note tests would pass trivially
    // without exercising anything. Give the row a domainId and queue the
    // matching domain mapping, the same pattern the appUrl tests above use.
    it('interpolates {projectPath} and {appHost} into the returned steps', async () => {
      const manifest = {
        ...MANIFEST,
        install: {
          ...MANIFEST.install,
          manualSteps: [
            {
              id: 'grant-access',
              title: 'Give other people access',
              body: 'Add each person as a guest.',
              deepLink: '/repo/{projectPath}/settings?tab=members',
            },
            {
              id: 'bucket-cors',
              title: 'Let the browser upload to your bucket',
              body: 'Allow PUT from {appHost}.',
            },
          ],
        },
      };
      mockDb.__queue([{ ...ROW, manifest, domainId: 'dom-1' }]);
      mockDb.__queue([{ id: 'dom-1', domain: 'reader.example.com' }]);

      const result = await service.listCatalog();
      const steps = result.data[0].installs[0].manualSteps;

      expect(steps[0].deepLink).toBe('/repo/acme/site/settings?tab=members');
      expect(steps[1].body).toBe('Allow PUT from reader.example.com.');
    });

    it('appends the cert note when the host has no certificate', async () => {
      certStep.plan.mockResolvedValue({ model: 'direct-no-wildcard', action: 'report' });
      certStep.execute.mockResolvedValue({
        status: 'action-required',
        detail: 'served over HTTP',
        manualStep: { id: 'provision-wildcard-cert', title: 'Turn on HTTPS', body: 'Body.' },
      });
      mockDb.__queue([{ ...ROW, domainId: 'dom-1' }]);
      mockDb.__queue([{ id: 'dom-1', domain: 'reader.example.com' }]);

      const result = await service.listCatalog();

      expect(result.data[0].installs[0].manualSteps.map((s) => s.id)).toContain(
        'provision-wildcard-cert',
      );
    });

    it('omits the cert note when a wildcard already covers the host', async () => {
      certStep.plan.mockResolvedValue({ model: 'wildcard', action: 'covered' });
      certStep.execute.mockResolvedValue({ status: 'done', detail: 'covered' });
      mockDb.__queue([{ ...ROW, domainId: 'dom-1' }]);
      mockDb.__queue([{ id: 'dom-1', domain: 'reader.example.com' }]);

      const result = await service.listCatalog();

      expect(result.data[0].installs[0].manualSteps.map((s) => s.id)).not.toContain(
        'provision-wildcard-cert',
      );
    });

    it('still lists the app when the cert lookup throws', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      certStep.plan.mockRejectedValue(new Error('domains service down'));
      mockDb.__queue([{ ...ROW, domainId: 'dom-1' }]);
      mockDb.__queue([{ id: 'dom-1', domain: 'reader.example.com' }]);

      const result = await service.listCatalog();

      expect(result.data[0].installs).toHaveLength(1);
      expect(result.data[0].installs[0].manualSteps.map((s) => s.id)).not.toContain(
        'provision-wildcard-cert',
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('preflight', () => {
    it('combines instance and project gates and derives appUrl from appHost', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      bundle.fetchBundle.mockResolvedValue({
        manifest: MANIFEST,
        files: {},
        sha256: 'a'.repeat(64),
      });
      preflight.projectGates.mockResolvedValue({
        gates: [{ id: 'dns', status: 'pass', message: 'ok' }],
        syncPlans: [
          {
            ruleSet: 'handoff',
            created: 1,
            updated: 0,
            unchanged: 0,
            pruneCandidates: 0,
            schemaResolutions: [],
          },
        ],
        appHost: 'handoff.example.com',
      });

      const result = await service.preflight('handoff', { projectId: 'proj-1' } as never, 'user-1');

      expect(bundle.fetchBundle).toHaveBeenCalledWith(
        HANDOFF_ENTRY.bundleUrl,
        HANDOFF_ENTRY.sha256,
      );
      expect(preflight.projectGates).toHaveBeenCalledWith(
        { manifest: MANIFEST, files: {}, sha256: 'a'.repeat(64) },
        { projectId: 'proj-1' },
        'user-1',
        undefined,
      );
      expect(result.gates).toEqual([
        { id: 'storage', status: 'pass', message: 'ok' },
        { id: 'dns', status: 'pass', message: 'ok' },
      ]);
      expect(result.syncPlans).toHaveLength(1);
      expect(result.appHost).toBe('handoff.example.com');
      expect(result.appUrl).toBe('https://handoff.example.com');
    });

    it('passes dto.subdomain through to projectGates as the override', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });
      bundle.fetchBundle.mockResolvedValue({
        manifest: MANIFEST,
        files: {},
        sha256: 'a'.repeat(64),
      });
      preflight.projectGates.mockResolvedValue({
        gates: [],
        syncPlans: [],
        appHost: 'my-app.example.com',
      });

      const result = await service.preflight(
        'handoff',
        { projectId: 'proj-1', subdomain: 'my-app' } as never,
        'user-1',
      );

      expect(preflight.projectGates).toHaveBeenCalledWith(
        { manifest: MANIFEST, files: {}, sha256: 'a'.repeat(64) },
        { projectId: 'proj-1' },
        'user-1',
        'my-app',
      );
      expect(result.appHost).toBe('my-app.example.com');
      expect(result.appUrl).toBe('https://my-app.example.com');
    });

    describe('suggestedSubdomain (install-again into another project)', () => {
      const MANIFEST_WITH_DEFAULT_HOST: AppManifest = {
        ...MANIFEST,
        install: { ...MANIFEST.install, domain: { subdomain: 'handoff' } },
      };
      const mappedDefault = { id: 'dom-1' };

      beforeEach(() => {
        config.get.mockImplementation((key: string) =>
          key === 'PRIMARY_DOMAIN' ? 'example.com' : undefined,
        );
        registry.getRegistry.mockResolvedValue({
          ok: true,
          registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
        });
        bundle.fetchBundle.mockResolvedValue({
          manifest: MANIFEST_WITH_DEFAULT_HOST,
          files: {},
          sha256: 'a'.repeat(64),
        });
      });

      it('suggests <default>-<project> when the manifest default host is already mapped', async () => {
        mockDb.__queue([mappedDefault]); // default host lookup: taken
        mockDb.__queue([]); // candidate host lookup: free
        mockDb.__queue([]); // candidate alias lookup: free

        const result = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBe('handoff-site');
      });

      it('walks to -2 when the first candidate host is mapped', async () => {
        mockDb.__queue([mappedDefault]); // default taken
        mockDb.__queue([{ id: 'dom-2' }]); // candidate 1 host taken
        mockDb.__queue([]); // candidate 2 host free
        mockDb.__queue([]); // candidate 2 alias free

        const result = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBe('handoff-site-2');
      });

      it('treats an alias of the candidate name anywhere as taken (wildcard route collision)', async () => {
        mockDb.__queue([mappedDefault]); // default taken
        mockDb.__queue([]); // candidate 1 host free
        mockDb.__queue([{ id: 'al-1' }]); // candidate 1 alias taken
        mockDb.__queue([]); // candidate 2 host free
        mockDb.__queue([]); // candidate 2 alias free

        const result = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBe('handoff-site-2');
      });

      it('uses the new project name for a newProject target', async () => {
        mockDb.__queue([mappedDefault]);
        mockDb.__queue([]);
        mockDb.__queue([]);

        const result = await service.preflight(
          'handoff',
          { newProject: { owner: 'acme', name: 'Docs Site' } } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBe('handoff-docs-site');
      });

      it('suggests nothing when the default host is free', async () => {
        mockDb.__queue([]); // default host lookup: free

        const result = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBeUndefined();
        expect(mockDb.select).toHaveBeenCalledTimes(1);
      });

      it('suggests nothing when the operator already chose a subdomain', async () => {
        const result = await service.preflight(
          'handoff',
          { projectId: 'proj-1', subdomain: 'mine' } as never,
          'user-1',
        );

        expect(result.suggestedSubdomain).toBeUndefined();
        expect(mockDb.select).not.toHaveBeenCalled();
      });

      it('suggests nothing when the manifest has no default subdomain or PRIMARY_DOMAIN is unset', async () => {
        bundle.fetchBundle.mockResolvedValue({
          manifest: MANIFEST,
          files: {},
          sha256: 'a'.repeat(64),
        });
        const noDomain = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );
        expect(noDomain.suggestedSubdomain).toBeUndefined();

        bundle.fetchBundle.mockResolvedValue({
          manifest: MANIFEST_WITH_DEFAULT_HOST,
          files: {},
          sha256: 'a'.repeat(64),
        });
        config.get.mockReturnValue(undefined);
        const noPrimary = await service.preflight(
          'handoff',
          { projectId: 'proj-1' } as never,
          'user-1',
        );
        expect(noPrimary.suggestedSubdomain).toBeUndefined();
        expect(mockDb.select).not.toHaveBeenCalled();
      });
    });

    it('throws NotFoundException for an app id not in the registry', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [] },
      });

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

      await expect(service.preflight('handoff', {} as never, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
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
        undefined,
      );
      expect(result).toEqual({ jobId: 'job-1' });
    });

    it('passes dto.subdomain through to the installer as the override', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [HANDOFF_ENTRY] },
      });

      await service.install(
        'handoff',
        { projectId: 'proj-1', subdomain: 'my-app' } as never,
        'user-1',
      );

      expect(installer.startInstall).toHaveBeenCalledWith(
        HANDOFF_ENTRY,
        { projectId: 'proj-1' },
        'user-1',
        'my-app',
      );
    });

    it('throws NotFoundException for an unknown app id', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [] },
      });

      await expect(
        service.install('unknown', { projectId: 'proj-1' } as never, 'user-1'),
      ).rejects.toThrow(NotFoundException);
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

      await expect(service.updateInstalled('missing', false, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the app is no longer in the registry', async () => {
      registry.getRegistry.mockResolvedValue({
        ok: true,
        registry: { schemaVersion: 1, apps: [] },
      });
      mockDb.__queue([ROW]);

      await expect(service.updateInstalled('ia-1', false, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
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
