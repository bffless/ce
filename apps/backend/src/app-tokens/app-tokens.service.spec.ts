import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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

/** The SQL text + params of the last `where(...)` the service built. */
function lastWhere(): { sql: string; params: unknown[] } {
  const calls = mockDb.where.mock.calls;
  return new PgDialect().sqlToQuery(calls[calls.length - 1][0] as SQL);
}

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
    const CURSOR = '11111111-1111-4111-8111-111111111111';
    const rowsOf = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        token: { ...inserted, id: `tok-${i + 1}` },
        project,
      }));

    it('lists the caller’s tokens joined with their project, without hashes', async () => {
      mockDb.limit.mockResolvedValueOnce([{ token: inserted, project }]);
      const { items, nextCursor } = await service.listMine('user-1');
      expect(items).toHaveLength(1);
      expect(items[0].project).toEqual(project);
      expect(items[0]).not.toHaveProperty('tokenHash');
      expect(nextCursor).toBeNull();
    });

    it('hides revoked and expired tokens by default, and lists them with includeInactive', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await service.listMine('user-1');
      const { sql, params } = lastWhere();
      expect(sql).toContain('"app_tokens"."user_id" = $1');
      expect(sql).toContain('"app_tokens"."revoked_at" is null');
      expect(sql).toMatch(/"app_tokens"\."expires_at" is null or "app_tokens"\."expires_at" > \$2/);
      expect(params[0]).toBe('user-1');
      // "now", as the timestamp column's driver value.
      expect(Math.abs(Date.now() - new Date(String(params[1])).getTime())).toBeLessThan(5000);

      mockDb.limit.mockResolvedValueOnce([]);
      await service.listMine('user-1', { includeInactive: true });
      const all = lastWhere();
      expect(all.sql).toContain('"app_tokens"."user_id" = $1');
      expect(all.sql).not.toContain('revoked_at');
      expect(all.sql).not.toContain('expires_at');
    });

    it('orders newest first with the id as tie-break and over-fetches one row to detect a next page', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await service.listMine('user-1', { limit: 20 });
      expect(mockDb.limit).toHaveBeenCalledWith(21);
      const [createdAt, id] = mockDb.orderBy.mock.calls[0];
      expect(new PgDialect().sqlToQuery(createdAt).sql).toBe('"app_tokens"."created_at" desc');
      expect(new PgDialect().sqlToQuery(id).sql).toBe('"app_tokens"."id" desc');

      mockDb.limit.mockResolvedValueOnce([]);
      await service.listMine('user-1');
      expect(mockDb.limit).toHaveBeenLastCalledWith(51); // APP_TOKEN_LIST_DEFAULT_LIMIT + 1
    });

    it('returns exactly `limit` items and the last one’s id as the cursor when more follow', async () => {
      mockDb.limit.mockResolvedValueOnce(rowsOf(3));
      const page = await service.listMine('user-1', { limit: 2 });
      expect(page.items.map((t) => t.id)).toEqual(['tok-1', 'tok-2']);
      expect(page.nextCursor).toBe('tok-2');

      mockDb.limit.mockResolvedValueOnce(rowsOf(2));
      const last = await service.listMine('user-1', { limit: 2 });
      expect(last.items).toHaveLength(2);
      expect(last.nextCursor).toBeNull();
    });

    it('resumes after the cursor row by keyset, reading its key in SQL and scoping it to the caller', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await service.listMine('user-1', { cursor: CURSOR, includeInactive: true });
      const { sql, params } = lastWhere();
      expect(sql).toContain(
        '("app_tokens"."created_at", "app_tokens"."id") < (select "cursor_row"."created_at", "cursor_row"."id" from "app_tokens" "cursor_row" where "cursor_row"."id" = $2 and "cursor_row"."user_id" = $3)',
      );
      expect(params).toEqual(['user-1', CURSOR, 'user-1']);
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
