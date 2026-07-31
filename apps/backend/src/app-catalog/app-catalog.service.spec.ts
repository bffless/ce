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
import { NotFoundException } from '@nestjs/common';
import { db } from '../db/client';
import { AppCatalogService } from './app-catalog.service';
import type { AppManifest } from './app-manifest.types';

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
  },
  eject: {
    repo: 'bffless/apps',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    variables: ['BFFLESS_URL', 'BFFLESS_PROJECT'],
    secrets: ['BFFLESS_API_KEY'],
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
  status: 'installed',
  createdResources: {},
  installedBy: 'user-1',
  installedAt: new Date(),
  updatedAt: new Date(),
};

describe('AppCatalogService', () => {
  let service: AppCatalogService;
  let projects: { getProjectById: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    mockDb.__reset();
    projects = {
      getProjectById: jest.fn().mockResolvedValue({ id: 'proj-1', owner: 'acme', name: 'site' }),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new AppCatalogService(projects as never, config as unknown as ConfigService);
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
});
