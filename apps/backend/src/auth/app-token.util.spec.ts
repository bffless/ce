import * as crypto from 'crypto';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  },
}));

const mockDb = jest.requireMock('../db/client').db;

import {
  APP_TOKEN_PREFIX,
  LAST_USED_WRITE_INTERVAL_MS,
  bearerAppToken,
  hashToken,
  mintToken,
  requestUserFromAppToken,
  resetLastUsedThrottle,
  resolveAppToken,
} from './app-token.util';

const tokenRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'tok-1',
  name: 'walk',
  tokenHash: 'h',
  tokenPrefix: 'bfat_1234567',
  userId: 'user-1',
  projectId: 'proj-1',
  scopes: ['workflow:read'],
  kind: 'personal',
  clientId: null,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date(),
  ...over,
});
const userRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'user-1',
  email: 'm@example.com',
  role: 'user',
  disabled: false,
  ...over,
});

describe('app-token.util', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLastUsedThrottle();
    // `where` is terminal for the update chain and must resolve.
    mockDb.where.mockImplementation(function (this: unknown) {
      return mockDb;
    });
  });

  describe('bearerAppToken', () => {
    it('extracts a bfat_ bearer', () => {
      expect(bearerAppToken('Bearer bfat_abc')).toBe('bfat_abc');
      expect(bearerAppToken('bearer bfat_abc')).toBe('bfat_abc');
    });
    it('ignores other bearers, other schemes, and missing headers', () => {
      expect(bearerAppToken('Bearer eyJhbGciOi')).toBeNull();
      expect(bearerAppToken('Basic bfat_abc')).toBeNull();
      expect(bearerAppToken(undefined)).toBeNull();
      expect(bearerAppToken('')).toBeNull();
    });
    it('reads the first of an array header', () => {
      expect(bearerAppToken(['Bearer bfat_x', 'Bearer bfat_y'])).toBe('bfat_x');
    });
  });

  describe('mintToken / hashToken', () => {
    it('mints a prefixed 64-hex token whose hash is sha256 and whose prefix is 12 chars', () => {
      const minted = mintToken();
      expect(minted.raw).toMatch(new RegExp(`^${APP_TOKEN_PREFIX}[0-9a-f]{64}$`));
      expect(minted.hash).toBe(hashToken(minted.raw));
      expect(minted.hash).toBe(crypto.createHash('sha256').update(minted.raw).digest('hex'));
      expect(minted.prefix).toBe(minted.raw.slice(0, 12));
    });
    it('mints distinct tokens', () => {
      expect(mintToken().raw).not.toBe(mintToken().raw);
    });
  });

  describe('resolveAppToken', () => {
    it('returns null when the header carries no app token, without touching the db', async () => {
      expect(await resolveAppToken('Bearer eyJ')).toBeNull();
      expect(await resolveAppToken(undefined)).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('returns null for an unknown hash', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      expect(await resolveAppToken('Bearer bfat_unknown')).toBeNull();
    });

    it('returns null for an expired token', async () => {
      mockDb.limit.mockResolvedValueOnce([tokenRow({ expiresAt: new Date(Date.now() - 1000) })]);
      expect(await resolveAppToken('Bearer bfat_x')).toBeNull();
    });

    it('returns null for a revoked token', async () => {
      mockDb.limit.mockResolvedValueOnce([tokenRow({ revokedAt: new Date() })]);
      expect(await resolveAppToken('Bearer bfat_x')).toBeNull();
    });

    it('returns null when the user is missing or disabled', async () => {
      mockDb.limit.mockResolvedValueOnce([tokenRow()]).mockResolvedValueOnce([]);
      expect(await resolveAppToken('Bearer bfat_x')).toBeNull();
      mockDb.limit
        .mockResolvedValueOnce([tokenRow()])
        .mockResolvedValueOnce([userRow({ disabled: true })]);
      expect(await resolveAppToken('Bearer bfat_x')).toBeNull();
    });

    it('resolves the member and the token, and touches last_used_at once per interval', async () => {
      mockDb.limit.mockResolvedValueOnce([tokenRow()]).mockResolvedValueOnce([userRow()]);
      const resolved = await resolveAppToken('Bearer bfat_x');
      expect(resolved).toEqual({
        user: { id: 'user-1', email: 'm@example.com', role: 'user' },
        token: {
          id: 'tok-1',
          projectId: 'proj-1',
          scopes: ['workflow:read'],
          kind: 'personal',
          clientId: null,
        },
      });
      expect(mockDb.update).toHaveBeenCalledTimes(1);

      mockDb.limit.mockResolvedValueOnce([tokenRow()]).mockResolvedValueOnce([userRow()]);
      await resolveAppToken('Bearer bfat_x');
      expect(mockDb.update).toHaveBeenCalledTimes(1);

      // Past the interval, it writes again.
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + LAST_USED_WRITE_INTERVAL_MS + 1);
      mockDb.limit.mockResolvedValueOnce([tokenRow()]).mockResolvedValueOnce([userRow()]);
      await resolveAppToken('Bearer bfat_x');
      expect(mockDb.update).toHaveBeenCalledTimes(2);
      (Date.now as jest.Mock).mockRestore();
    });

    it('never throws on a db failure', async () => {
      mockDb.limit.mockRejectedValueOnce(new Error('boom'));
      expect(await resolveAppToken('Bearer bfat_x')).toBeNull();
    });
  });

  describe('requestUserFromAppToken', () => {
    const resolved = {
      user: { id: 'user-1', email: 'm@example.com', role: 'admin' },
      token: {
        id: 'tok-1',
        projectId: 'proj-1',
        scopes: ['a:b'],
        kind: 'personal',
        clientId: null,
      },
    };

    it('is the member in pipelines and the gate (no pin, no api-key project field)', () => {
      const u = requestUserFromAppToken(resolved, { pinRoleLikeApiKey: false });
      expect(u.role).toBe('admin');
      expect(u.apiKeyProjectId).toBeUndefined();
      expect(u.credential).toEqual({
        kind: 'app_token',
        appTokenId: 'tok-1',
        projectId: 'proj-1',
        scopes: ['a:b'],
      });
      expect(u.appTokenId).toBe('tok-1');
    });

    it('is a project-fenced pseudo-key on the admin API (admin pinned to user, member stays member)', () => {
      const admin = requestUserFromAppToken(resolved, { pinRoleLikeApiKey: true });
      expect(admin.role).toBe('user');
      expect(admin.apiKeyProjectId).toBe('proj-1');
      const member = requestUserFromAppToken(
        { ...resolved, user: { ...resolved.user, role: 'member' } },
        { pinRoleLikeApiKey: true },
      );
      expect(member.role).toBe('member');
    });
  });
});
