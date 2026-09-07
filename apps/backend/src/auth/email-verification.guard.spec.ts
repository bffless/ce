import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

jest.mock('supertokens-node', () => ({
  __esModule: true,
  RecipeUserId: jest.fn().mockImplementation((id: string) => ({ getAsString: () => id })),
}));
jest.mock('supertokens-node/recipe/emailverification', () => ({
  __esModule: true,
  default: { isEmailVerified: jest.fn() },
}));

import EmailVerification from 'supertokens-node/recipe/emailverification';
import { EmailVerificationGuard } from './email-verification.guard';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const mockIsEmailVerified = EmailVerification.isEmailVerified as jest.Mock;

describe('EmailVerificationGuard', () => {
  let guard: EmailVerificationGuard;
  let reflector: Reflector;
  let featureFlags: { isEnabled: jest.Mock };
  let request: any;
  let response: any;

  const context = (): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    featureFlags = { isEnabled: jest.fn().mockResolvedValue(true) };
    guard = new EmailVerificationGuard(reflector, featureFlags as unknown as FeatureFlagsService);
    request = {
      headers: {},
      session: { getUserId: () => 'user-1' },
      user: { id: 'user-1' },
      originalUrl: '/api/projects',
    };
    response = { redirect: jest.fn() };
    mockIsEmailVerified.mockResolvedValue(false);
  });

  describe('skips', () => {
    it('allows public routes without touching SuperTokens', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValueOnce(true);
      await expect(guard.canActivate(context())).resolves.toBe(true);
      expect(mockIsEmailVerified).not.toHaveBeenCalled();
    });

    it('allows requests with no session (other guards own those)', async () => {
      request.session = undefined;
      await expect(guard.canActivate(context())).resolves.toBe(true);
      expect(mockIsEmailVerified).not.toHaveBeenCalled();
    });

    it('allows API-key authenticated requests', async () => {
      request.user = { id: 'user-1', apiKeyId: 'key-1' };
      await expect(guard.canActivate(context())).resolves.toBe(true);
      expect(mockIsEmailVerified).not.toHaveBeenCalled();
    });

    it('allows everything when ENABLE_EMAIL_VERIFICATION is off', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);
      await expect(guard.canActivate(context())).resolves.toBe(true);
      expect(mockIsEmailVerified).not.toHaveBeenCalled();
    });

    it('allows a verified user', async () => {
      mockIsEmailVerified.mockResolvedValue(true);
      await expect(guard.canActivate(context())).resolves.toBe(true);
    });

    it('does not block the user when the verification lookup itself fails', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockIsEmailVerified.mockRejectedValue(new Error('core down'));
      await expect(guard.canActivate(context())).resolves.toBe(true);
      consoleError.mockRestore();
    });
  });

  describe('unverified user: browser vs. API classification (issue #778)', () => {
    const expectForbiddenJson = async () => {
      let thrown: unknown;
      try {
        await guard.canActivate(context());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect((thrown as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        error: 'EMAIL_NOT_VERIFIED',
      });
      expect(response.redirect).not.toHaveBeenCalled();
    };

    it('answers a request with no Accept header at all with 403 EMAIL_NOT_VERIFIED, not a redirect', async () => {
      // The admin SPA's fetchBaseQuery sets no Accept header. A 302 here would be
      // followed by fetch() into /verify-email's HTML, and the frontend's 403
      // EMAIL_NOT_VERIFIED handling (apps/frontend/src/services/api.ts) would
      // never fire.
      request.headers = {};
      await expectForbiddenJson();
    });

    it("answers the SPA's fetch() profile (Accept: */*, Sec-Fetch-Mode: cors) with 403 EMAIL_NOT_VERIFIED", async () => {
      request.headers = { accept: '*/*', 'sec-fetch-mode': 'cors' };
      await expectForbiddenJson();
    });

    it('answers Accept: application/json with 403 EMAIL_NOT_VERIFIED', async () => {
      request.headers = { accept: 'application/json' };
      await expectForbiddenJson();
    });

    it('redirects a browser navigation (Accept: text/html) to /verify-email', async () => {
      request.headers = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

      await expect(guard.canActivate(context())).rejects.toThrow(ForbiddenException);
      expect(response.redirect).toHaveBeenCalledTimes(1);
      expect(response.redirect).toHaveBeenCalledWith(302, '/verify-email');
    });

    it('redirects a browser navigation (Sec-Fetch-Mode: navigate) to /verify-email', async () => {
      request.headers = { accept: '*/*', 'sec-fetch-mode': 'navigate' };

      await expect(guard.canActivate(context())).rejects.toThrow(ForbiddenException);
      expect(response.redirect).toHaveBeenCalledWith(302, '/verify-email');
    });
  });
});
