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
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should deny access without session (API request)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockGetSession.mockResolvedValue(undefined);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Authentication required'),
      );
      expect(mockResponse.redirect).not.toHaveBeenCalled();
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

      it('returns 401 to an API request without redirecting', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers = { accept: 'application/json' };
        mockGetSession.mockRejectedValue(tryRefresh);

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('Authentication required'),
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
