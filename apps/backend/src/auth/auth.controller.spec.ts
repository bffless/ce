import { Request } from 'express';
import { UnauthorizedException } from '@nestjs/common';

// Mock the database client used for the pending-invitation lookup branch.
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

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

import { AuthController } from './auth.controller';
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

const reqWithSession = (): Request & { session: any } =>
  ({
    headers: { host: 'foo.sites.bffless.app' },
    session: {
      getUserId: () => SESSION_USER_ID,
      getHandle: () => SESSION_HANDLE,
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
