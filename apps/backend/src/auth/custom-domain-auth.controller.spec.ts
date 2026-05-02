import { Request, Response } from 'express';

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
