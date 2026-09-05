import { Request } from 'express';
import { UnauthorizedException } from '@nestjs/common';

// Mock the database client used for the pending-invitation lookup branch and,
// through the real `resolveAppToken`, the app-token → session exchange (two
// `select … limit(1)` reads — token row, then user row — and the advisory
// `update … set({ lastUsedAt })` touch, whose `where` is terminal).
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  },
}));

const mockDb = jest.requireMock('../db/client').db;

// Mock the supertokens-node top-level imports used by getSession.
jest.mock('supertokens-node', () => ({
  __esModule: true,
  getUser: jest.fn(),
  listUsersByAccountInfo: jest.fn(),
  RecipeUserId: jest.fn().mockImplementation((id: string) => ({ getAsString: () => id })),
}));

jest.mock('supertokens-node/recipe/emailverification', () => ({
  __esModule: true,
  default: {
    isEmailVerified: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('supertokens-node/recipe/emailpassword', () => ({
  __esModule: true,
  default: {
    signIn: jest.fn(),
  },
}));

jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  default: {
    createNewSession: jest.fn(),
  },
}));

import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { resetLastUsedThrottle, SESSION_EXCHANGE_SCOPE } from './app-token.util';
import { AuthService } from './auth.service';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { OnboardingExecutorService } from '../onboarding-rules/onboarding-executor.service';
import { DomainTokenService } from './domain-token.service';
import { ProjectInviteLinksService } from '../project-invite-links/project-invite-links.service';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';

const SESSION_USER_ID = 'user-1';
const SESSION_HANDLE = 'session-handle-1';

const reqWithSession = (
  accessTokenPayload: Record<string, unknown> = {},
): Request & { session: any } =>
  ({
    headers: { host: 'foo.sites.bffless.app' },
    session: {
      getUserId: () => SESSION_USER_ID,
      getHandle: () => SESSION_HANDLE,
      getAccessTokenPayload: () => accessTokenPayload,
    },
  }) as unknown as Request & { session: any };

describe('AuthController.getSession (project-membership gate, Phase B)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let featureFlags: jest.Mocked<FeatureFlagsService>;
  let projectResolver: jest.Mocked<ProjectResolverService>;
  let permissions: jest.Mocked<PermissionsService>;

  const dbUser = { id: SESSION_USER_ID, email: 'a@example.com', role: 'member' };

  beforeEach(() => {
    jest.clearAllMocks();

    authService = {
      getUserById: jest.fn().mockResolvedValue(dbUser),
      getUserByEmail: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<AuthService>;

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    projectResolver = {
      resolveProjectFromRequest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProjectResolverService>;

    permissions = {
      getUserProjectRole: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PermissionsService>;

    controller = new AuthController(
      authService,
      {} as SetupService,
      featureFlags,
      {} as OnboardingExecutorService,
      {} as DomainTokenService,
      {} as ProjectInviteLinksService,
      projectResolver,
      permissions,
      {} as never, // OidcProvidersService — not exercised by these tests
    );
  });

  it('throws when there is no session', async () => {
    await expect(
      controller.getSession({ headers: {} } as unknown as Request & { session?: any }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the user normally when the master switch is OFF (no resolver call)', async () => {
    featureFlags.isEnabled.mockResolvedValue(false);

    const result: any = await controller.getSession(reqWithSession());

    expect(result.user).toEqual({ id: dbUser.id, email: dbUser.email, role: dbUser.role });
    expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
    expect(permissions.getUserProjectRole).not.toHaveBeenCalled();
  });

  it('returns the user normally when admin domain (resolver returns null)', async () => {
    featureFlags.isEnabled.mockResolvedValue(true);
    projectResolver.resolveProjectFromRequest.mockResolvedValue(null);

    const result: any = await controller.getSession(reqWithSession());

    expect(result.user).toEqual({ id: dbUser.id, email: dbUser.email, role: dbUser.role });
    expect(permissions.getUserProjectRole).not.toHaveBeenCalled();
  });

  it('returns { user: null } when project resolves and user has no membership', async () => {
    featureFlags.isEnabled.mockResolvedValue(true);
    projectResolver.resolveProjectFromRequest.mockResolvedValue({
      id: 'proj-1',
      allowPublicSignup: false,
    } as any);
    permissions.getUserProjectRole.mockResolvedValue(null);

    const result: any = await controller.getSession(reqWithSession());

    expect(result).toEqual({
      session: { userId: SESSION_USER_ID, handle: SESSION_HANDLE },
      user: null,
      emailVerified: false,
      emailVerificationRequired: false,
    });
    // Cheap-path optimisation: we should not have hit the DB for the user.
    expect(authService.getUserById).not.toHaveBeenCalled();
  });

  it('returns the user when project resolves and user IS a member', async () => {
    featureFlags.isEnabled.mockResolvedValue(true);
    projectResolver.resolveProjectFromRequest.mockResolvedValue({
      id: 'proj-1',
      allowPublicSignup: false,
    } as any);
    permissions.getUserProjectRole.mockResolvedValue('guest');

    const result: any = await controller.getSession(reqWithSession());

    expect(result.user).toEqual({ id: dbUser.id, email: dbUser.email, role: dbUser.role });
    expect(permissions.getUserProjectRole).toHaveBeenCalledWith(SESSION_USER_ID, 'proj-1');
  });

  describe('signIn (post-session resilience)', () => {
    const signInMock = EmailPassword.signIn as jest.Mock;
    const createNewSessionMock = Session.createNewSession as jest.Mock;

    const makeSession = (mergeImpl: () => Promise<void>) => ({
      getUserId: () => SESSION_USER_ID,
      getHandle: () => SESSION_HANDLE,
      mergeIntoAccessTokenPayload: jest.fn(mergeImpl),
    });

    const signInReq = () => ({ headers: { host: 'admin.bffless.app' } }) as unknown as Request;

    beforeEach(() => {
      // ENABLE_EMAIL_PASSWORD must be on; REQUIRE_PROJECT_MEMBERSHIP stays off.
      featureFlags.isEnabled.mockImplementation(
        async (flag: string) => flag === 'ENABLE_EMAIL_PASSWORD',
      );
      authService.getUserByEmail.mockResolvedValue(dbUser as never);
      signInMock.mockResolvedValue({
        status: 'OK',
        recipeUserId: { getAsString: () => SESSION_USER_ID },
      });
    });

    it('adds the role to the access token payload on the happy path', async () => {
      const session = makeSession(() => Promise.resolve());
      createNewSessionMock.mockResolvedValue(session);

      const result: any = await controller.signIn(
        { email: dbUser.email, password: 'pw' } as never,
        signInReq(),
        {} as never,
      );

      expect(result.message).toBe('Signed in successfully');
      expect(session.mergeIntoAccessTokenPayload).toHaveBeenCalledWith({ role: dbUser.role });
    });

    it('still reports success when the role-claim merge fails after the session was created', async () => {
      // Once createNewSession has run, the session cookies are already attached
      // to the response — the user IS signed in. A failure while decorating the
      // access token (e.g. the SuperTokens core erroring on /recipe/session/
      // regenerate) must not convert a successful login into a 401.
      const session = makeSession(() => Promise.reject(new Error('core regenerate blew up')));
      createNewSessionMock.mockResolvedValue(session);

      const result: any = await controller.signIn(
        { email: dbUser.email, password: 'pw' } as never,
        signInReq(),
        {} as never,
      );

      expect(result.message).toBe('Signed in successfully');
      expect(result.user).toEqual({ id: dbUser.id, email: dbUser.email, role: dbUser.role });
    });
  });

  it('getSession surfaces `via` when the session was minted from an app token', async () => {
    const result: any = await controller.getSession(
      reqWithSession({ role: 'member', via: 'app_token', appTokenId: 'tok-1' }),
    );

    expect(result.session).toEqual({
      userId: SESSION_USER_ID,
      handle: SESSION_HANDLE,
      via: 'app_token',
    });
  });

  describe('sessionFromAppToken (app token → session exchange)', () => {
    const createNewSessionMock = Session.createNewSession as jest.Mock;
    const limitMock = mockDb.limit as jest.Mock;
    const RAW_TOKEN = 'bfat_' + 'a'.repeat(64);
    const res = {} as Response;

    const tokenRow = (over: Partial<Record<string, unknown>> = {}) => ({
      id: 'tok-1',
      userId: SESSION_USER_ID,
      projectId: 'proj-1',
      scopes: ['workflow:read', SESSION_EXCHANGE_SCOPE],
      kind: 'personal',
      clientId: null,
      expiresAt: null,
      revokedAt: null,
      ...over,
    });
    const userRow = { id: SESSION_USER_ID, email: dbUser.email, role: 'member', disabled: false };

    /** The resolver reads the token row, then its user row. */
    const storedToken = (row: ReturnType<typeof tokenRow>) => {
      limitMock.mockResolvedValueOnce([row]).mockResolvedValueOnce([userRow]);
    };
    const bearerReq = (
      host = 'admin.bffless.app',
      authorization: string | null = `Bearer ${RAW_TOKEN}`,
    ) => ({ headers: { host, ...(authorization ? { authorization } : {}) } }) as unknown as Request;
    const rejection = async (req: Request) =>
      controller.sessionFromAppToken(req, res).then(
        () => {
          throw new Error('expected the exchange to be refused');
        },
        (e) => e,
      );

    beforeEach(() => {
      resetLastUsedThrottle();
      limitMock.mockReset().mockResolvedValue([]);
      featureFlags.isEnabled.mockResolvedValue(false);
      projectResolver.resolveProjectFromRequest.mockResolvedValue(null);
      createNewSessionMock.mockResolvedValue({
        getUserId: () => SESSION_USER_ID,
        getHandle: () => SESSION_HANDLE,
      });
    });

    it('401 without a bfat_ bearer (no header, or a non-app-token bearer)', async () => {
      const noHeader = await rejection(bearerReq('admin.bffless.app', null));
      expect(noHeader).toBeInstanceOf(UnauthorizedException);
      expect(noHeader.getResponse()).toMatchObject({ code: 'unauthorized' });

      const jwtBearer = await rejection(bearerReq('admin.bffless.app', 'Bearer eyJhbGciOi'));
      expect(jwtBearer).toBeInstanceOf(UnauthorizedException);
      expect(limitMock).not.toHaveBeenCalled();
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('401 for an unknown token', async () => {
      const err = await rejection(bearerReq());
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.getResponse()).toMatchObject({ code: 'unauthorized' });
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('401 for a revoked token', async () => {
      storedToken(tokenRow({ revokedAt: new Date() }));
      const err = await rejection(bearerReq());
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('401 for an expired token', async () => {
      storedToken(tokenRow({ expiresAt: new Date(Date.now() - 1000) }));
      const err = await rejection(bearerReq());
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('403 insufficient_scope naming auth:session when the token lacks it', async () => {
      storedToken(tokenRow({ scopes: ['workflow:read', 'workflow:run'] }));
      const err = await rejection(bearerReq());
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        code: 'insufficient_scope',
        missingScopes: ['auth:session'],
      });
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('403 token_project_mismatch when the request host resolves to another project', async () => {
      storedToken(tokenRow({ projectId: 'proj-1' }));
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-2' } as any);
      const err = await rejection(bearerReq('other.sites.bffless.app'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'token_project_mismatch' });
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('401 when REQUIRE_PROJECT_MEMBERSHIP is on and the member has no role on the project', async () => {
      storedToken(tokenRow({ projectId: 'proj-1' }));
      featureFlags.isEnabled.mockImplementation(
        async (flag: string) => flag === 'REQUIRE_PROJECT_MEMBERSHIP',
      );
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      permissions.getUserProjectRole.mockResolvedValue(null);

      const err = await rejection(bearerReq('foo.sites.bffless.app'));
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.getResponse()).toMatchObject({ code: 'unauthorized' });
      expect(permissions.getUserProjectRole).toHaveBeenCalledWith(SESSION_USER_ID, 'proj-1');
      expect(createNewSessionMock).not.toHaveBeenCalled();
    });

    it('409 user_not_exchangeable when SuperTokens does not know the user id', async () => {
      storedToken(tokenRow());
      createNewSessionMock.mockRejectedValueOnce(
        new Error(
          "SuperTokens core threw an error for a POST request to path: '/public/recipe/session' with status code: 400 and message: UNKNOWN_USER_ID",
        ),
      );
      const err = await rejection(bearerReq());
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'user_not_exchangeable' });
    });

    it('mints the session for the token’s user with the via/appTokenId claims and answers like signin', async () => {
      storedToken(tokenRow());
      const req = bearerReq();

      const result: any = await controller.sessionFromAppToken(req, res);

      expect(result).toEqual({
        message: 'Signed in successfully',
        user: { id: SESSION_USER_ID, email: dbUser.email, role: 'member' },
      });
      expect(createNewSessionMock).toHaveBeenCalledTimes(1);
      const [calledReq, calledRes, tenantId, recipeUserId, payload] =
        createNewSessionMock.mock.calls[0];
      expect(calledReq).toBe(req);
      expect(calledRes).toBe(res);
      expect(tenantId).toBe('public');
      expect(recipeUserId.getAsString()).toBe(SESSION_USER_ID);
      expect(payload).toEqual({ role: 'member', via: 'app_token', appTokenId: 'tok-1' });
      // resolveAppToken's advisory last_used_at touch ran.
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(mockDb.set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
    });

    it('lets an OAuth-issued token exchange too — the scope is the gate, not the kind', async () => {
      storedToken(tokenRow({ kind: 'oauth', clientId: 'client-1' }));
      const result: any = await controller.sessionFromAppToken(bearerReq(), res);
      expect(result.user.id).toBe(SESSION_USER_ID);
      expect(createNewSessionMock).toHaveBeenCalledTimes(1);
    });

    it('exchanges on a project host when the token is bound to that project', async () => {
      storedToken(tokenRow({ projectId: 'proj-1' }));
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      const result: any = await controller.sessionFromAppToken(
        bearerReq('foo.sites.bffless.app'),
        res,
      );
      expect(result.user.id).toBe(SESSION_USER_ID);
      expect(createNewSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the SuperTokens session userId for the membership check (works even if DB user is missing)', async () => {
    // Pending-invitation-style scenario: signed-in via SuperTokens but no DB user yet.
    // The gate must still trip before falling into the invitation branch when the
    // request hits a project subdomain. The session userId is the unified ID.
    featureFlags.isEnabled.mockResolvedValue(true);
    projectResolver.resolveProjectFromRequest.mockResolvedValue({
      id: 'proj-1',
      allowPublicSignup: false,
    } as any);
    permissions.getUserProjectRole.mockResolvedValue(null);
    authService.getUserById.mockResolvedValue(null);

    const result: any = await controller.getSession(reqWithSession());

    expect(result.user).toBeNull();
    expect(permissions.getUserProjectRole).toHaveBeenCalledWith(SESSION_USER_ID, 'proj-1');
    expect(authService.getUserById).not.toHaveBeenCalled();
  });
});
