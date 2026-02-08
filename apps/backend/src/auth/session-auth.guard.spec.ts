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

// Mock SuperTokens
jest.mock('supertokens-node/recipe/session/framework/express', () => ({
  verifySession: jest.fn(),
}));

import { verifySession } from 'supertokens-node/recipe/session/framework/express';
import { db } from '../db/client';

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

      mockRequest.session = mockSession;

      (verifySession as jest.Mock).mockReturnValue(
        (req: any, res: any, next: (err?: any) => void) => {
          next();
        },
      );

      // Mock database query to return user with role
      const mockDbChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 'user-123', email: 'test@example.com', role: 'admin' }]),
      };
      (db.select as jest.Mock).mockReturnValue(mockDbChain);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.id).toBe('user-123');
      expect(mockRequest.user.role).toBe('admin');
    });

    it('should deny access without session (API request)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      (verifySession as jest.Mock).mockReturnValue(
        (req: any, res: any, next: (err?: any) => void) => {
          next(new Error('No session'));
        },
      );

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should redirect browser request to login with tryRefresh param', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Simulate browser request (no Accept: application/json, has text/html)
      mockRequest.headers = { accept: 'text/html,application/xhtml+xml' };
      mockRequest.originalUrl = '/dashboard';

      (verifySession as jest.Mock).mockReturnValue(
        (req: any, res: any, next: (err?: any) => void) => {
          next(new Error('No session'));
        },
      );

      // Should throw after redirect, but redirect should be called first
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        302,
        '/login?redirect=%2Fdashboard&tryRefresh=true',
      );
    });

    it('should not redirect API requests (return 401 instead)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Simulate API request (expects JSON response)
      mockRequest.headers = { accept: 'application/json' };
      mockRequest.originalUrl = '/api/users';

      (verifySession as jest.Mock).mockReturnValue(
        (req: any, res: any, next: (err?: any) => void) => {
          next(new Error('No session'));
        },
      );

      // Should throw without redirect (API clients expect 401, not redirect)
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });
});
