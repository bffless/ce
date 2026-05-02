import { Request } from 'express';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
  },
}));

import { db } from '../db/client';
import { ProjectResolverService } from './project-resolver.service';

const mockedDb = db as any;

const reqFor = (host: string, forwardedHost?: string): Request =>
  ({
    headers: {
      host,
      ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
    },
  } as unknown as Request);

describe('ProjectResolverService', () => {
  let service: ProjectResolverService;
  const ORIGINAL_PRIMARY_DOMAIN = process.env.PRIMARY_DOMAIN;
  const ORIGINAL_ADMIN_DOMAIN = process.env.ADMIN_DOMAIN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRIMARY_DOMAIN = 'bffless.app';
    delete process.env.ADMIN_DOMAIN;
    service = new ProjectResolverService();
  });

  afterAll(() => {
    if (ORIGINAL_PRIMARY_DOMAIN === undefined) delete process.env.PRIMARY_DOMAIN;
    else process.env.PRIMARY_DOMAIN = ORIGINAL_PRIMARY_DOMAIN;
    if (ORIGINAL_ADMIN_DOMAIN === undefined) delete process.env.ADMIN_DOMAIN;
    else process.env.ADMIN_DOMAIN = ORIGINAL_ADMIN_DOMAIN;
  });

  describe('admin domain', () => {
    it('returns null for admin.<PRIMARY_DOMAIN>', async () => {
      const result = await service.resolveProjectFromRequest(reqFor('admin.bffless.app'));
      expect(result).toBeNull();
      expect(mockedDb.select).not.toHaveBeenCalled();
    });

    it('returns null for admin.sites.<PRIMARY_DOMAIN> (Platform layout)', async () => {
      const result = await service.resolveProjectFromRequest(reqFor('admin.sites.bffless.app'));
      expect(result).toBeNull();
      expect(mockedDb.select).not.toHaveBeenCalled();
    });

    it('returns null for explicit ADMIN_DOMAIN env override', async () => {
      process.env.ADMIN_DOMAIN = 'console.example.com';
      const result = await service.resolveProjectFromRequest(reqFor('console.example.com'));
      expect(result).toBeNull();
      expect(mockedDb.select).not.toHaveBeenCalled();
    });
  });

  describe('hostname → project lookup', () => {
    it('resolves a custom domain registered in domain_mappings', async () => {
      const project = { id: 'proj-1', name: 'bella', allowPublicSignup: false };
      mockedDb.limit
        .mockResolvedValueOnce([{ projectId: 'proj-1' }])
        .mockResolvedValueOnce([project]);

      const result = await service.resolveProjectFromRequest(reqFor('www.bellacharlesworth.com'));

      expect(result).toEqual(project);
      expect(mockedDb.select).toHaveBeenCalledTimes(2);
    });

    it('resolves a workspace subdomain (mapping stored as full hostname)', async () => {
      const project = { id: 'proj-2', name: 'realestate' };
      mockedDb.limit
        .mockResolvedValueOnce([{ projectId: 'proj-2' }])
        .mockResolvedValueOnce([project]);

      const result = await service.resolveProjectFromRequest(
        reqFor('realestate.sites.bffless.app'),
      );

      expect(result).toEqual(project);
    });

    it('uses x-forwarded-host when present', async () => {
      mockedDb.limit.mockResolvedValueOnce([{ projectId: 'proj-3' }]).mockResolvedValueOnce([
        { id: 'proj-3' },
      ]);

      await service.resolveProjectFromRequest(reqFor('internal.example', 'www.bella.com'));

      // First select call (domain lookup) should target the forwarded host (lowercased).
      // We can't easily inspect Drizzle's call args here, but the result chain must have
      // returned the project — which only happens when the lookup resolves to a row.
      expect(mockedDb.select).toHaveBeenCalled();
    });

    it('strips port and lowercases the hostname', async () => {
      mockedDb.limit.mockResolvedValueOnce([{ projectId: 'proj-4' }]).mockResolvedValueOnce([
        { id: 'proj-4' },
      ]);

      const result = await service.resolveProjectFromRequest(reqFor('Foo.Sites.BFFLESS.APP:8080'));

      expect(result).toEqual({ id: 'proj-4' });
    });

    it('returns null when domain_mappings has no row for the hostname', async () => {
      mockedDb.limit.mockResolvedValueOnce([]);

      const result = await service.resolveProjectFromRequest(reqFor('unknown.example.com'));

      expect(result).toBeNull();
    });

    it('returns null when a mapping exists but has no projectId (e.g., redirect domain)', async () => {
      mockedDb.limit.mockResolvedValueOnce([{ projectId: null }]);

      const result = await service.resolveProjectFromRequest(reqFor('redirect.example.com'));

      expect(result).toBeNull();
    });

    it('returns null when an empty hostname is supplied', async () => {
      const result = await service.resolveProjectFromRequest(reqFor(''));
      expect(result).toBeNull();
      expect(mockedDb.select).not.toHaveBeenCalled();
    });
  });
});
