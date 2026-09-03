import { ExecutionContext } from '@nestjs/common';
import { OptionalAuthGuard } from './optional-auth.guard';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn(),
  },
}));
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
jest.mock('supertokens-node/recipe/session', () => ({ getSession: jest.fn() }));
jest.mock('./app-token.util', () => ({
  ...jest.requireActual('./app-token.util'),
  resolveAppToken: jest.fn().mockResolvedValue(null),
}));

const mockDb = jest.requireMock('../db/client').db;
const { compare: mockCompare } = jest.requireMock('bcrypt');
const { getSession: mockGetSession } = jest.requireMock('supertokens-node/recipe/session');
const { resolveAppToken: mockResolveAppToken } = jest.requireMock('./app-token.util');

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new OptionalAuthGuard();
    mockGetSession.mockResolvedValue(undefined);
    mockDb.from.mockResolvedValue([]);
  });

  it('leaves request.user undefined when nothing authenticates', async () => {
    const request: Record<string, unknown> = { headers: {}, cookies: {} };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('attaches the member (real role, no pin) for a Bearer app token', async () => {
    mockResolveAppToken.mockResolvedValueOnce({
      user: { id: 'user-9', email: 'm@example.com', role: 'admin' },
      token: {
        id: 'tok-1',
        projectId: 'project-9',
        scopes: ['workflow:run'],
        kind: 'personal',
        clientId: null,
      },
    });
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer bfat_valid' },
      cookies: {},
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-9',
      email: 'm@example.com',
      role: 'admin',
      appTokenId: 'tok-1',
      credential: {
        kind: 'app_token',
        appTokenId: 'tok-1',
        projectId: 'project-9',
        scopes: ['workflow:run'],
      },
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('prefers a valid X-API-Key over a Bearer app token', async () => {
    mockDb.from.mockResolvedValueOnce([
      { id: 'key-1', key: 'hashed', userId: 'user-1', projectId: 'p-1', expiresAt: null },
    ]);
    mockCompare.mockResolvedValueOnce(true);
    mockDb.where.mockResolvedValueOnce(undefined);
    const request: Record<string, unknown> = {
      headers: { 'x-api-key': 'raw', authorization: 'Bearer bfat_valid' },
      cookies: {},
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1', apiKeyId: 'key-1' });
    expect(mockResolveAppToken).not.toHaveBeenCalled();
  });

  it('falls through to the session when the bearer is not an app token', async () => {
    mockResolveAppToken.mockResolvedValueOnce(null);
    mockGetSession.mockResolvedValueOnce({ getUserId: () => 'user-2', getHandle: () => 'h' });
    mockDb.from.mockReturnValueOnce({
      where: () => ({
        limit: async () => [{ id: 'user-2', email: 's@example.com', role: 'user' }],
      }),
    });
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer eyJ.jwt' },
      cookies: {},
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-2', sessionHandle: 'h' });
  });
});
