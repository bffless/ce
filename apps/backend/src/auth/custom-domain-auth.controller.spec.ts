import { Request, Response } from 'express';

// ApiKeyGuard (imported transitively via the controller's @UseGuards) pulls in
// bcrypt's native binding; replace it with a factory mock so the suite loads
// without requiring the native module. The guard itself is never executed here
// — sessionFromKey is called directly.
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  genSalt: jest.fn(),
}));

// Mock the database client used by trySupertokensSession's user lookup.
const dbLimitMock = jest.fn();
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: () => dbLimitMock(),
  },
}));

// Mock the SuperTokens fallback path used when no bffless_access cookie is present.
const getSessionMock = jest.fn();
jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  getSession: (...args: any[]) => getSessionMock(...args),
}));

// Mock EmailPassword recipe used by signUp / signIn paths.
const stSignUpMock = jest.fn();
const stSignInMock = jest.fn();
jest.mock('supertokens-node/recipe/emailpassword', () => ({
  __esModule: true,
  default: {
    signUp: (...args: any[]) => stSignUpMock(...args),
    signIn: (...args: any[]) => stSignInMock(...args),
  },
}));

import { CustomDomainAuthController } from './custom-domain-auth.controller';
import { CustomDomainAuthService } from './custom-domain-auth.service';
import { DomainTokenService } from './domain-token.service';
import { AuthService } from './auth.service';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { EmailService } from '../email/email.service';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';

const HOST = 'foo.sites.bffless.app';

const reqWithCookie = (accessToken?: string): Request =>
  ({
    headers: { host: HOST },
    cookies: accessToken ? { [CustomDomainAuthService.ACCESS_COOKIE_NAME]: accessToken } : {},
  }) as unknown as Request;

const passthroughRes = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('CustomDomainAuthController.session (project-membership gate, Phase B)', () => {
  let controller: CustomDomainAuthController;
  let customDomainAuthService: jest.Mocked<CustomDomainAuthService>;
  let featureFlags: jest.Mocked<FeatureFlagsService>;
  let projectResolver: jest.Mocked<ProjectResolverService>;
  let permissions: jest.Mocked<PermissionsService>;

  const validPayload = {
    sub: 'user-1',
    email: 'a@example.com',
    role: 'member',
    domain: HOST,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dbLimitMock.mockReset();

    customDomainAuthService = {
      validateAccessToken: jest.fn().mockReturnValue(validPayload),
      isAccessTokenExpired: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<CustomDomainAuthService>;

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    projectResolver = {
      resolveProjectFromRequest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProjectResolverService>;

    permissions = {
      getUserProjectRole: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PermissionsService>;

    controller = new CustomDomainAuthController(
      {} as DomainTokenService,
      customDomainAuthService,
      {} as AuthService,
      {} as SetupService,
      featureFlags,
      {} as EmailService,
      projectResolver,
      permissions,
      {} as never, // OidcProvidersService — not exercised here
    );
  });

  describe('JWT cookie path (bffless_access)', () => {
    it('returns authenticated when the master switch is OFF (no resolver call)', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      const result = await controller.session(reqWithCookie('valid'), passthroughRes());

      expect(result).toEqual({
        authenticated: true,
        user: { id: validPayload.sub, email: validPayload.email, role: validPayload.role },
      });
      expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
    });

    it('returns authenticated on admin domain (resolver returns null)', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      projectResolver.resolveProjectFromRequest.mockResolvedValue(null);

      const result = await controller.session(reqWithCookie('valid'), passthroughRes());

      expect(result).toEqual({
        authenticated: true,
        user: { id: validPayload.sub, email: validPayload.email, role: validPayload.role },
      });
      expect(permissions.getUserProjectRole).not.toHaveBeenCalled();
    });

    it('returns { authenticated: false, user: null } when project resolves and user is not a member', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      permissions.getUserProjectRole.mockResolvedValue(null);

      const result = await controller.session(reqWithCookie('valid'), passthroughRes());

      expect(result).toEqual({ authenticated: false, user: null });
      expect(permissions.getUserProjectRole).toHaveBeenCalledWith(validPayload.sub, 'proj-1');
    });

    it('returns authenticated when project resolves and user IS a member', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      permissions.getUserProjectRole.mockResolvedValue('guest');

      const result = await controller.session(reqWithCookie('valid'), passthroughRes());

      expect(result).toEqual({
        authenticated: true,
        user: { id: validPayload.sub, email: validPayload.email, role: validPayload.role },
      });
    });
  });

  describe('SuperTokens fallback path (no bffless_access cookie)', () => {
    const stUser = { id: 'user-1', email: 'a@example.com', role: 'member' };

    beforeEach(() => {
      getSessionMock.mockResolvedValue({ getUserId: () => stUser.id });
      dbLimitMock.mockResolvedValue([stUser]);
    });

    it('returns authenticated when the master switch is OFF', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      const result = await controller.session(reqWithCookie(undefined), passthroughRes());

      expect(result).toEqual({ authenticated: true, user: stUser });
      expect(projectResolver.resolveProjectFromRequest).not.toHaveBeenCalled();
    });

    it('returns { authenticated: false, user: null } when project resolves and no membership', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      permissions.getUserProjectRole.mockResolvedValue(null);

      const result = await controller.session(reqWithCookie(undefined), passthroughRes());

      expect(result).toEqual({ authenticated: false, user: null });
      expect(permissions.getUserProjectRole).toHaveBeenCalledWith(stUser.id, 'proj-1');
    });

    it('returns authenticated when project resolves and user IS a member', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-1' } as any);
      permissions.getUserProjectRole.mockResolvedValue('viewer');

      const result = await controller.session(reqWithCookie(undefined), passthroughRes());

      expect(result).toEqual({ authenticated: true, user: stUser });
    });
  });
});

describe('CustomDomainAuthController.signUp (existing-email orphan re-create)', () => {
  let controller: CustomDomainAuthController;
  let customDomainAuthService: jest.Mocked<CustomDomainAuthService>;
  let authService: jest.Mocked<AuthService>;
  let setupService: jest.Mocked<SetupService>;
  let featureFlags: jest.Mocked<FeatureFlagsService>;
  let projectResolver: jest.Mocked<ProjectResolverService>;
  let permissions: jest.Mocked<PermissionsService>;

  const EMAIL = 'orphan@example.com';
  const PASSWORD = 'correct-horse-battery';
  const ST_USER_ID = 'st-user-123';
  const PROJECT = { id: 'proj-1', allowPublicSignup: true } as any;

  const reqForSignup = (): Request =>
    ({
      headers: { host: 'www.bellacharlesworth.com' },
      cookies: {},
    }) as unknown as Request;

  const resForSignup = (): Response =>
    ({
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    stSignUpMock.mockReset();
    stSignInMock.mockReset();

    customDomainAuthService = {
      createAccessToken: jest.fn().mockReturnValue('access-token'),
      createRefreshToken: jest.fn().mockReturnValue('refresh-token'),
      setAuthCookies: jest.fn(),
    } as unknown as jest.Mocked<CustomDomainAuthService>;

    authService = {
      getUserByEmail: jest.fn(),
      getUserById: jest.fn(),
      createUser: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    setupService = {
      isRegistrationFeatureEnabled: jest.fn().mockResolvedValue(true),
      canPublicSignup: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SetupService>;

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    projectResolver = {
      resolveProjectFromRequest: jest.fn().mockResolvedValue(PROJECT),
    } as unknown as jest.Mocked<ProjectResolverService>;

    permissions = {
      grantSystemPermission: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PermissionsService>;

    controller = new CustomDomainAuthController(
      {} as DomainTokenService,
      customDomainAuthService,
      authService,
      setupService,
      featureFlags,
      {} as EmailService,
      projectResolver,
      permissions,
      {} as never, // OidcProvidersService — not exercised here
    );
  });

  it('backfills the workspace user row when SuperTokens has the identity but the local users table does not', async () => {
    stSignUpMock.mockResolvedValue({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
    stSignInMock.mockResolvedValue({
      status: 'OK',
      recipeUserId: { getAsString: () => ST_USER_ID },
    });
    authService.getUserByEmail.mockResolvedValue(null);
    authService.getUserById.mockResolvedValue(null);
    const created = { id: ST_USER_ID, email: EMAIL, role: 'member', disabled: false } as any;
    authService.createUser.mockResolvedValue(created);

    const result = await controller.signUp(
      { email: EMAIL, password: PASSWORD },
      reqForSignup(),
      resForSignup(),
    );

    expect(authService.createUser).toHaveBeenCalledWith(EMAIL, 'member', ST_USER_ID);
    expect(permissions.grantSystemPermission).toHaveBeenCalledWith(PROJECT.id, ST_USER_ID, 'guest');
    expect(customDomainAuthService.setAuthCookies).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'OK',
      user: { id: ST_USER_ID, email: EMAIL, role: 'member' },
      emailVerificationRequired: false,
    });
  });

  it('grants admin role to the orphan re-create when the email matches ADMIN_EMAIL', async () => {
    const prevAdmin = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = EMAIL;
    try {
      stSignUpMock.mockResolvedValue({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
      stSignInMock.mockResolvedValue({
        status: 'OK',
        recipeUserId: { getAsString: () => ST_USER_ID },
      });
      authService.getUserByEmail.mockResolvedValue(null);
      authService.getUserById.mockResolvedValue(null);
      authService.createUser.mockResolvedValue({
        id: ST_USER_ID,
        email: EMAIL,
        role: 'admin',
        disabled: false,
      } as any);

      await controller.signUp({ email: EMAIL, password: PASSWORD }, reqForSignup(), resForSignup());

      expect(authService.createUser).toHaveBeenCalledWith(EMAIL, 'admin', ST_USER_ID);
    } finally {
      process.env.ADMIN_EMAIL = prevAdmin;
    }
  });

  it('does not call createUser when the workspace user already exists (non-orphan)', async () => {
    const existing = { id: ST_USER_ID, email: EMAIL, role: 'member', disabled: false } as any;
    stSignUpMock.mockResolvedValue({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
    stSignInMock.mockResolvedValue({
      status: 'OK',
      recipeUserId: { getAsString: () => ST_USER_ID },
    });
    authService.getUserByEmail.mockResolvedValue(existing);

    const result = await controller.signUp(
      { email: EMAIL, password: PASSWORD },
      reqForSignup(),
      resForSignup(),
    );

    expect(authService.createUser).not.toHaveBeenCalled();
    expect(permissions.grantSystemPermission).toHaveBeenCalledWith(PROJECT.id, ST_USER_ID, 'guest');
    expect(result).toEqual({
      status: 'OK',
      user: { id: ST_USER_ID, email: EMAIL, role: 'member' },
      emailVerificationRequired: false,
    });
  });

  it('still returns EMAIL_ALREADY_EXISTS_ERROR when the password is wrong (no orphan re-create)', async () => {
    stSignUpMock.mockResolvedValue({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
    stSignInMock.mockResolvedValue({ status: 'WRONG_CREDENTIALS_ERROR' });
    authService.getUserByEmail.mockResolvedValue(null);
    authService.getUserById.mockResolvedValue(null);

    const result = await controller.signUp(
      { email: EMAIL, password: 'wrong-but-long-enough' },
      reqForSignup(),
      resForSignup(),
    );

    expect(authService.createUser).not.toHaveBeenCalled();
    expect(permissions.grantSystemPermission).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
  });

  it('does not orphan-re-create when the request resolves to no project (admin domain)', async () => {
    projectResolver.resolveProjectFromRequest.mockResolvedValue(null);
    stSignUpMock.mockResolvedValue({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
    authService.getUserByEmail.mockResolvedValue(null);
    authService.getUserById.mockResolvedValue(null);

    const result = await controller.signUp(
      { email: EMAIL, password: PASSWORD },
      reqForSignup(),
      resForSignup(),
    );

    expect(stSignInMock).not.toHaveBeenCalled();
    expect(authService.createUser).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });
  });
});

describe('CustomDomainAuthController.sessionFromKey (API key → session)', () => {
  let controller: CustomDomainAuthController;
  let authService: jest.Mocked<AuthService>;
  let customDomainAuthService: jest.Mocked<CustomDomainAuthService>;
  let featureFlags: jest.Mocked<FeatureFlagsService>;
  let projectResolver: jest.Mocked<ProjectResolverService>;
  let permissions: jest.Mocked<PermissionsService>;

  // The key owner's real workspace role is 'admin'. ApiKeyGuard hardcodes the
  // request role to 'user', so this asserts we mint with the *owner's* role.
  const keyOwner = { id: 'user-1', email: 'owner@example.com', role: 'admin', disabled: false };

  const reqWithKeyUser = (user: unknown, host = HOST): Request =>
    ({ headers: { host }, user }) as unknown as Request;

  const cookieRes = (): Response =>
    ({
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();

    authService = {
      getUserById: jest.fn().mockResolvedValue(keyOwner),
    } as unknown as jest.Mocked<AuthService>;

    customDomainAuthService = {
      createAccessToken: jest.fn().mockReturnValue('access-jwt'),
      createRefreshToken: jest.fn().mockReturnValue('refresh-jwt'),
      setAuthCookies: jest.fn(),
    } as unknown as jest.Mocked<CustomDomainAuthService>;

    featureFlags = {
      isEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    projectResolver = {
      resolveProjectFromRequest: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProjectResolverService>;

    permissions = {
      getUserProjectRole: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PermissionsService>;

    controller = new CustomDomainAuthController(
      {} as DomainTokenService,
      customDomainAuthService,
      authService,
      {} as SetupService,
      featureFlags,
      {} as EmailService,
      projectResolver,
      permissions,
      {} as never,
    );
  });

  const apiKeyUser = {
    id: 'user-1',
    apiKeyId: 'key-1',
    apiKeyProjectId: 'proj-1',
    role: 'user',
  };

  it('mints the access+refresh pair for the key owner and returns OK', async () => {
    const res = cookieRes();

    const result = await controller.sessionFromKey(reqWithKeyUser(apiKeyUser), res);

    expect(authService.getUserById).toHaveBeenCalledWith('user-1');
    // Signs the owner's real role ('admin'), not the API-key hardcoded 'user'.
    expect(customDomainAuthService.createAccessToken).toHaveBeenCalledWith(
      'user-1',
      'owner@example.com',
      'admin',
      HOST,
    );
    expect(customDomainAuthService.createRefreshToken).toHaveBeenCalledWith('user-1', HOST);
    expect(customDomainAuthService.setAuthCookies).toHaveBeenCalledWith(
      res,
      'access-jwt',
      'refresh-jwt',
      true,
    );
    expect(result).toEqual({
      status: 'OK',
      user: { id: 'user-1', email: 'owner@example.com', role: 'admin' },
    });
  });

  it('rejects when no API key was used (session fallback / missing apiKeyId)', async () => {
    await expect(
      controller.sessionFromKey(reqWithKeyUser({ id: 'user-1' }), cookieRes()),
    ).rejects.toThrow('A valid X-API-Key is required');
    expect(customDomainAuthService.setAuthCookies).not.toHaveBeenCalled();
  });

  it('rejects when the key owner is not a member of the resolved site', async () => {
    featureFlags.isEnabled.mockResolvedValue(true);
    projectResolver.resolveProjectFromRequest.mockResolvedValue({ id: 'proj-9' } as never);
    permissions.getUserProjectRole.mockResolvedValue(null);

    await expect(
      controller.sessionFromKey(reqWithKeyUser(apiKeyUser), cookieRes()),
    ).rejects.toThrow('not a member of this site');
    expect(permissions.getUserProjectRole).toHaveBeenCalledWith('user-1', 'proj-9');
    expect(customDomainAuthService.setAuthCookies).not.toHaveBeenCalled();
  });
});
