import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './session-auth.guard';

// Mock the database module
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
  },
}));

// Mock SuperTokens. The guard must use getSession (never the express verifySession
// middleware, which writes its own 401 on a missing session - issue #775).
jest.mock('supertokens-node/recipe/session', () => ({ getSession: jest.fn() }));

import { getSession } from 'supertokens-node/recipe/session';
import { db } from '../db/client';

const mockGetSession = getSession as jest.Mock;

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionAuthGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<SessionAuthGuard>(SessionAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    let mockExecutionContext: ExecutionContext;
    let mockRequest: any;
    let mockResponse: any;

    beforeEach(() => {
      mockRequest = {
        headers: {
          accept: 'application/json', // Simulate API request (default)
        },
        cookies: {},
        originalUrl: '/api/test',
      };
      mockResponse = {
        redirect: jest.fn(),
        headersSent: false,
      };

      mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;
    });

    it('should allow access to public routes', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow access with valid session', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const mockSession = {
        getUserId: jest.fn().mockReturnValue('user-123'),
        getHandle: jest.fn().mockReturnValue('session-handle'),
      };

      mockGetSession.mockResolvedValue(mockSession);

      // Mock database query to return user with role
      const mockDbChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValue([{ id: 'user-123', email: 'test@example.com', role: 'admin' }]),
      };
      (db.select as jest.Mock).mockReturnValue(mockDbChain);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({
        id: 'user-123',
        sessionHandle: 'session-handle',
        email: 'test@example.com',
        role: 'admin',
      });
      expect(mockGetSession).toHaveBeenCalledWith(mockRequest, mockResponse, {
        sessionRequired: false,
      });
      // verifySession() used to set this; handlers and EmailVerificationGuard read it.
      expect(mockRequest.session).toBe(mockSession);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should deny access without session (API request)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockGetSession.mockResolvedValue(undefined);

      // "unauthorised" is the body SuperTokens used to write for no session; the
      // frontend's baseQueryWithReauth reads it as "skip refresh, go to /login".
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('unauthorised'),
      );
      expect(mockResponse.redirect).not.toHaveBeenCalled();
      expect(mockRequest.session).toBeUndefined();
      expect(mockRequest.user).toBeUndefined();
    });

    it('should redirect browser request to login with tryRefresh param', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Simulate browser request (no Accept: application/json, has text/html)
      mockRequest.headers = { accept: 'text/html,application/xhtml+xml' };
      mockRequest.originalUrl = '/dashboard';

      mockGetSession.mockResolvedValue(undefined);

      // Should throw after redirect, but redirect should be called first
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        302,
        '/login?redirect=%2Fdashboard&tryRefresh=true',
      );
    });

    describe('present-but-invalid session (getSession rejects, e.g. TRY_REFRESH_TOKEN)', () => {
      const tryRefresh = Object.assign(new Error('try refresh token'), {
        type: 'TRY_REFRESH_TOKEN',
      });

      it('returns 401 "try refresh token" to an API request without redirecting', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers = { accept: 'application/json' };
        mockGetSession.mockRejectedValue(tryRefresh);

        // The body SuperTokens used to write; the frontend attempts a silent refresh on it.
        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('try refresh token'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });

      it('maps any other getSession error to a plain 401 "unauthorised"', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers = { accept: 'application/json' };
        mockGetSession.mockRejectedValue(
          Object.assign(new Error('token theft'), { type: 'TOKEN_THEFT_DETECTED' }),
        );

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('unauthorised'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });

      it('redirects a browser request to /login exactly once, then throws', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers = { accept: 'text/html,application/xhtml+xml' };
        mockRequest.originalUrl = '/dashboard';
        mockGetSession.mockRejectedValue(tryRefresh);

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(mockResponse.redirect).toHaveBeenCalledTimes(1);
        expect(mockResponse.redirect).toHaveBeenCalledWith(
          302,
          '/login?redirect=%2Fdashboard&tryRefresh=true',
        );
      });
    });

    describe('browser vs. API classification', () => {
      beforeEach(() => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockGetSession.mockResolvedValue(undefined);
      });

      it('treats a request with no Accept header at all as an API client (401, no redirect)', async () => {
        mockRequest.headers = {};

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('unauthorised'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });

      it("treats the SPA's own fetch() profile (Accept: */*, Sec-Fetch-Mode: cors) as an API client", async () => {
        // This is what apps/frontend/src/services/api.ts actually sends: it sets no
        // Accept header. A redirect here would be followed by fetch() to /login's
        // HTML and the frontend's 401-keyed silent refresh would never run.
        mockRequest.headers = { accept: '*/*', 'sec-fetch-mode': 'cors' };

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('unauthorised'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });

      it('treats Sec-Fetch-Mode: navigate as a browser navigation (redirect)', async () => {
        mockRequest.headers = { accept: '*/*', 'sec-fetch-mode': 'navigate' };
        mockRequest.originalUrl = '/api/auth/session';

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(mockResponse.redirect).toHaveBeenCalledTimes(1);
        expect(mockResponse.redirect).toHaveBeenCalledWith(
          302,
          '/login?redirect=%2Fapi%2Fauth%2Fsession&tryRefresh=true',
        );
      });

      it('treats curl -H "Accept: text/html" (the issue repro) as a browser navigation', async () => {
        mockRequest.headers = { accept: 'text/html' };
        mockRequest.originalUrl = '/api/auth/session';

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(mockResponse.redirect).toHaveBeenCalledTimes(1);
      });

      it('still prefers the explicit API signals over navigation hints', async () => {
        mockRequest.headers = {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'x-requested-with': 'XMLHttpRequest',
        };

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('unauthorised'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });
    });

    it('does not redirect when the response was already sent (no ERR_HTTP_HEADERS_SENT)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      mockRequest.headers = { accept: 'text/html,application/xhtml+xml' };
      mockRequest.originalUrl = '/dashboard';
      mockResponse.headersSent = true;
      mockGetSession.mockResolvedValue(undefined);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should not redirect API requests (return 401 instead)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Simulate API request (expects JSON response)
      mockRequest.headers = { accept: 'application/json' };
      mockRequest.originalUrl = '/api/users';

      mockGetSession.mockResolvedValue(undefined);

      // Should throw without redirect (API clients expect 401, not redirect)
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });
});
