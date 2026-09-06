import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppTokensService } from './app-tokens.service';

jest.mock('../db/client', () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of [
    'insert',
    'values',
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'update',
    'set',
    'limit',
    'returning',
  ]) {
    chain[m] = jest.fn();
  }
  return { db: chain };
});
const mockDb = jest.requireMock('../db/client').db as Record<string, jest.Mock>;

const project = { id: 'proj-1', owner: 'bffless', name: 'workflow' };
const inserted = {
  id: 'tok-1',
  name: 'walk',
  tokenHash: 'h',
  tokenPrefix: 'bfat_1234567',
  userId: 'user-1',
  projectId: 'proj-1',
  scopes: ['workflow:read'],
  kind: 'personal',
  clientId: null,
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date('2026-09-03T00:00:00Z'),
};

describe('AppTokensService', () => {
  let service: AppTokensService;
  let projectsService: { getProjectByOwnerName: jest.Mock };
  let permissions: { getUserProjectRole: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const m of Object.keys(mockDb)) mockDb[m].mockReturnValue(mockDb);
    projectsService = { getProjectByOwnerName: jest.fn().mockResolvedValue(project) };
    permissions = { getUserProjectRole: jest.fn().mockResolvedValue('viewer') };
    service = new AppTokensService(projectsService as never, permissions as never);
  });

  describe('create', () => {
    const dto = {
      name: 'walk',
      project: 'bffless/workflow',
      scopes: ['workflow:read', 'workflow:read'],
    };

    it('stores the hash, never the raw, and returns the raw once with a 90-day default expiry', async () => {
      mockDb.returning.mockResolvedValueOnce([inserted]);
      const { view, raw } = await service.create('user-1', 'user', dto);
      expect(raw).toMatch(/^bfat_[0-9a-f]{64}$/);
      const values = mockDb.values.mock.calls[0][0];
      expect(values.tokenHash).toHaveLength(64);
      expect(values).not.toHaveProperty('token');
      expect(values.scopes).toEqual(['workflow:read']); // de-duplicated
      expect(values.kind).toBe('personal');
      const ttl = values.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(89 * 86400000);
      expect(ttl).toBeLessThanOrEqual(90 * 86400000);
      expect(view).toEqual({
        id: 'tok-1',
        name: 'walk',
        tokenPrefix: 'bfat_1234567',
        project,
        scopes: ['workflow:read'],
        kind: 'personal',
        clientId: null,
        expiresAt: '2026-12-01T00:00:00.000Z',
        revokedAt: null,
        lastUsedAt: null,
        createdAt: '2026-09-03T00:00:00.000Z',
      });
    });

    it('refuses a non-member (and a guest), admits a global admin without a role', async () => {
      permissions.getUserProjectRole.mockResolvedValueOnce(null);
      await expect(service.create('user-1', 'user', dto)).rejects.toThrow(ForbiddenException);
      permissions.getUserProjectRole.mockResolvedValueOnce('guest');
      await expect(service.create('user-1', 'user', dto)).rejects.toThrow(ForbiddenException);
      mockDb.returning.mockResolvedValueOnce([inserted]);
      await expect(service.create('admin-1', 'admin', dto)).resolves.toBeDefined();
      expect(permissions.getUserProjectRole).toHaveBeenCalledTimes(2);
    });

    it('404s an unknown project', async () => {
      projectsService.getProjectByOwnerName.mockRejectedValueOnce(new NotFoundException('x'));
      await expect(service.create('user-1', 'user', dto)).rejects.toThrow(NotFoundException);
    });

    it('clamps expiry: past or beyond 365 days is refused, a valid one is kept', async () => {
      await expect(
        service.create('user-1', 'user', { ...dto, expiresAt: '2020-01-01T00:00:00Z' }),
      ).rejects.toThrow(BadRequestException);
      const farFuture = new Date(Date.now() + 400 * 86400000).toISOString();
      await expect(
        service.create('user-1', 'user', { ...dto, expiresAt: farFuture }),
      ).rejects.toThrow(BadRequestException);
      const soon = new Date(Date.now() + 86400000);
      mockDb.returning.mockResolvedValueOnce([inserted]);
      await service.create('user-1', 'user', { ...dto, expiresAt: soon.toISOString() });
      expect(mockDb.values.mock.calls[0][0].expiresAt.getTime()).toBe(soon.getTime());
    });

    it('mints a never-expiring token on neverExpires (expiresAt null, reported as null)', async () => {
      mockDb.returning.mockResolvedValueOnce([{ ...inserted, expiresAt: null }]);
      const { view } = await service.create('user-1', 'user', { ...dto, neverExpires: true });
      expect(mockDb.values.mock.calls[0][0].expiresAt).toBeNull();
      expect(view.expiresAt).toBeNull();
    });

    it('keeps the 90-day default when neverExpires is false or absent', async () => {
      mockDb.returning.mockResolvedValueOnce([inserted]);
      await service.create('user-1', 'user', { ...dto, neverExpires: false });
      const ttl = mockDb.values.mock.calls[0][0].expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(89 * 86400000);
      expect(ttl).toBeLessThanOrEqual(90 * 86400000);
    });

    it('refuses neverExpires together with an expiresAt', async () => {
      const soon = new Date(Date.now() + 86400000).toISOString();
      await expect(
        service.create('user-1', 'user', { ...dto, neverExpires: true, expiresAt: soon }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('lets an OAuth caller set kind, clientId and its own expiry', async () => {
      mockDb.returning.mockResolvedValueOnce([{ ...inserted, kind: 'oauth', clientId: 'c1' }]);
      const at = new Date(Date.now() + 3600_000);
      await service.create('user-1', 'user', dto, { kind: 'oauth', clientId: 'c1', expiresAt: at });
      expect(mockDb.values.mock.calls[0][0]).toMatchObject({
        kind: 'oauth',
        clientId: 'c1',
        expiresAt: at,
      });
    });
  });

  describe('listMine', () => {
    it('lists the caller’s tokens joined with their project, without hashes', async () => {
      mockDb.orderBy.mockResolvedValueOnce([{ token: inserted, project }]);
      const list = await service.listMine('user-1');
      expect(list).toHaveLength(1);
      expect(list[0].project).toEqual(project);
      expect(list[0]).not.toHaveProperty('tokenHash');
    });
  });

  describe('revoke', () => {
    it('soft-revokes the caller’s token, 404s another user’s, is idempotent', async () => {
      mockDb.limit.mockResolvedValueOnce([inserted]);
      mockDb.where.mockReturnValueOnce(mockDb).mockResolvedValueOnce(undefined);
      await service.revoke('tok-1', 'user-1');
      expect(mockDb.set).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });

      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.revoke('tok-1', 'user-2')).rejects.toThrow(NotFoundException);

      jest.clearAllMocks();
      for (const m of Object.keys(mockDb)) mockDb[m].mockReturnValue(mockDb);
      mockDb.limit.mockResolvedValueOnce([{ ...inserted, revokedAt: new Date() }]);
      await service.revoke('tok-1', 'user-1');
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
