/**
 * Guard → handler contract for `request.session`.
 *
 * SuperTokens' express `verifySession()` middleware set `request.session` as a
 * side effect. `SessionAuthGuard` / `ApiKeyGuard` now read the session with the
 * recipe-level `getSession()` (issue #775), which sets nothing — so the guards
 * must write it back themselves. Downstream code still reads it directly:
 * `AuthController.getSession` (and `change-password`, `login-methods`,
 * `SetupController.adopt-session-user`) 401 without it, and the global
 * `EmailVerificationGuard` treats a missing `request.session` as "unauthenticated,
 * skip" — silently disabling `ENABLE_EMAIL_VERIFICATION`.
 *
 * Guard-level unit tests mock `getSession` and assert `request.user`, so they
 * cannot see this. These tests run a guard and then the consumer on the *same*
 * request object.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

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
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
jest.mock('./app-token.util', () => ({
  ...jest.requireActual('./app-token.util'),
  resolveAppToken: jest.fn().mockResolvedValue(null),
}));
jest.mock('supertokens-node', () => ({
  __esModule: true,
  getUser: jest.fn(),
  listUsersByAccountInfo: jest.fn(),
  RecipeUserId: jest.fn().mockImplementation((id: string) => ({ getAsString: () => id })),
}));
jest.mock('supertokens-node/recipe/emailverification', () => ({
  __esModule: true,
  default: { isEmailVerified: jest.fn() },
}));
jest.mock('supertokens-node/recipe/emailpassword', () => ({
  __esModule: true,
  default: { signIn: jest.fn() },
}));
jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  default: { createNewSession: jest.fn() },
  getSession: jest.fn(),
}));

import EmailVerification from 'supertokens-node/recipe/emailverification';
import { AuthController } from './auth.controller';
import { SessionAuthGuard } from './session-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { EmailVerificationGuard } from './email-verification.guard';
import { AuthService } from './auth.service';
import { SetupService } from '../setup/setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { OnboardingExecutorService } from '../onboarding-rules/onboarding-executor.service';
import { DomainTokenService } from './domain-token.service';
import { ProjectInviteLinksService } from '../project-invite-links/project-invite-links.service';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';

const mockDb = jest.requireMock('../db/client').db;
const { getSession: mockGetSession } = jest.requireMock('supertokens-node/recipe/session');
const mockIsEmailVerified = EmailVerification.isEmailVerified as jest.Mock;

const USER_ID = 'user-1';
const dbUser = { id: USER_ID, email: 'a@example.com', role: 'member' };

const validSession = () => ({
  getUserId: () => USER_ID,
  getHandle: () => 'session-handle-1',
  getAccessTokenPayload: () => ({}),
});

/** A request as it arrives at the guard: session cookie, no `session` yet. */
const freshRequest = (): Request & { session?: any; user?: any } =>
  ({
    headers: { accept: 'application/json', host: 'admin.example.com' },
    cookies: { sAccessToken: 'jwt' },
    originalUrl: '/api/auth/session',
  }) as unknown as Request & { session?: any; user?: any };

const contextFor = (request: unknown, response: unknown = { redirect: jest.fn() }) =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  }) as unknown as ExecutionContext;

const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;

describe('request.session contract after SessionAuthGuard / ApiKeyGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    mockDb.limit.mockResolvedValue([dbUser]);
    mockGetSession.mockResolvedValue(validSession());
    mockIsEmailVerified.mockResolvedValue(true);
  });

  describe('AuthController.getSession on the request the guard mutated', () => {
    let controller: AuthController;

    beforeEach(() => {
      const authService = {
        getUserById: jest.fn().mockResolvedValue(dbUser),
        getUserByEmail: jest.fn().mockResolvedValue(null),
      } as unknown as jest.Mocked<AuthService>;
      const featureFlags = {
        isEnabled: jest.fn().mockResolvedValue(false),
      } as unknown as jest.Mocked<FeatureFlagsService>;
      controller = new AuthController(
        authService,
        {} as SetupService,
        featureFlags,
        {} as OnboardingExecutorService,
        {} as DomainTokenService,
        {} as ProjectInviteLinksService,
        {
          resolveProjectFromRequest: jest.fn().mockResolvedValue(null),
        } as unknown as ProjectResolverService,
        { getUserProjectRole: jest.fn().mockResolvedValue(null) } as unknown as PermissionsService,
        {} as never,
      );
    });

    it('returns the session for a logged-in user (GET /api/auth/session)', async () => {
      const request = freshRequest();

      await expect(new SessionAuthGuard(reflector).canActivate(contextFor(request))).resolves.toBe(
        true,
      );
      expect(request.session).toBeDefined();

      const result: any = await controller.getSession(request);
      expect(result.session).toEqual({ userId: USER_ID, handle: 'session-handle-1' });
      expect(result.user).toMatchObject({ id: USER_ID, email: 'a@example.com' });
    });
  });

  describe('EmailVerificationGuard (global APP_GUARD) on the request the guard mutated', () => {
    const emailVerificationGuard = () =>
      new EmailVerificationGuard(reflector, {
        isEnabled: jest.fn().mockResolvedValue(true),
      } as unknown as FeatureFlagsService);

    it('still blocks an unverified user behind SessionAuthGuard', async () => {
      const request = freshRequest();
      mockIsEmailVerified.mockResolvedValue(false);

      await expect(new SessionAuthGuard(reflector).canActivate(contextFor(request))).resolves.toBe(
        true,
      );
      await expect(emailVerificationGuard().canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('still blocks an unverified user behind the ApiKeyGuard session fallback', async () => {
      const request = freshRequest();
      mockIsEmailVerified.mockResolvedValue(false);

      await expect(new ApiKeyGuard(reflector).canActivate(contextFor(request))).resolves.toBe(true);
      await expect(emailVerificationGuard().canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a verified user through behind SessionAuthGuard', async () => {
      const request = freshRequest();

      await expect(new SessionAuthGuard(reflector).canActivate(contextFor(request))).resolves.toBe(
        true,
      );
      await expect(emailVerificationGuard().canActivate(contextFor(request))).resolves.toBe(true);
      expect(mockIsEmailVerified).toHaveBeenCalledTimes(1);
    });
  });
});
