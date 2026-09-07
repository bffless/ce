import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import * as bcrypt from 'bcrypt';

// Mock the database
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn(),
  },
}));

jest.mock('bcrypt');

// The session fallback must use getSession (never the express verifySession
// middleware, which writes its own 401 on a missing session - issue #775).
jest.mock('supertokens-node/recipe/session', () => ({ getSession: jest.fn() }));
const { getSession: mockGetSession } = jest.requireMock('supertokens-node/recipe/session');

jest.mock('./app-token.util', () => ({
  ...jest.requireActual('./app-token.util'),
  resolveAppToken: jest.fn().mockResolvedValue(null),
}));
const { resolveAppToken: mockResolveAppToken } = jest.requireMock('./app-token.util');

// Get the mocked db
const mockDb = jest.requireMock('../db/client').db;

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(undefined);
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
        headers: {},
      };

      mockResponse = { redirect: jest.fn(), headersSent: false };

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

    it('should throw error if no API key and no valid session', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // When no API key is provided, the guard falls back to session authentication.
      // With no session it throws its own 401 (never a redirect - this guard is for
      // programmatic access) and leaves the response untouched for the filter.
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Authentication required'),
      );
      expect(mockGetSession).toHaveBeenCalledWith(mockRequest, mockResponse, {
        sessionRequired: false,
      });
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    describe('session fallback', () => {
      beforeEach(() => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      });

      it('allows access with a valid session and attaches the user', async () => {
        mockGetSession.mockResolvedValue({
          getUserId: () => 'user-123',
          getHandle: () => 'session-handle',
        });
        mockDb.limit = jest
          .fn()
          .mockResolvedValue([{ id: 'user-123', email: 'test@example.com', role: 'admin' }]);
        mockDb.from.mockReturnThis();
        mockDb.where.mockReturnThis();

        await expect(guard.canActivate(mockExecutionContext)).resolves.toBe(true);
        expect(mockRequest.user).toEqual({
          id: 'user-123',
          sessionHandle: 'session-handle',
          email: 'test@example.com',
          role: 'admin',
        });
      });

      it('throws 401 when getSession rejects (present but invalid token)', async () => {
        mockGetSession.mockRejectedValue(
          Object.assign(new Error('try refresh token'), { type: 'TRY_REFRESH_TOKEN' }),
        );

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('Invalid or expired session'),
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
        expect(mockRequest.user).toBeUndefined();
      });

      it('never redirects, even for a browser-style request', async () => {
        mockRequest.headers = { accept: 'text/html,application/xhtml+xml' };
        mockGetSession.mockResolvedValue(undefined);

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(mockResponse.redirect).not.toHaveBeenCalled();
      });
    });

    it('should allow access with valid API key', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockRequest.headers['x-api-key'] = 'test-api-key';

      const mockApiKey = {
        id: 'key-123',
        key: 'hashed-key',
        userId: 'user-123',
        projectId: 'project-123',
        expiresAt: null,
        lastUsedAt: null,
      };

      mockDb.from.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockImplementation((plain, hash) => {
        return Promise.resolve(hash === 'hashed-key');
      });

      mockDb.where.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.id).toBe('user-123');
      expect(mockRequest.user.role).toBe('user'); // API keys default to 'user' role
      expect(mockRequest.user.apiKeyProjectId).toBe('project-123');
    });

    it('should throw error for invalid API key', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockRequest.headers['x-api-key'] = 'invalid-key';

      mockDb.from.mockResolvedValue([]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw error for expired API key', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockRequest.headers['x-api-key'] = 'expired-key';

      const mockApiKey = {
        id: 'key-123',
        key: 'hashed-key',
        userId: 'user-123',
        projectId: 'project-123',
        expiresAt: new Date('2020-01-01'), // Expired
        lastUsedAt: null,
      };

      mockDb.from.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('API key has expired'),
      );
    });

    describe('Bearer app tokens (project-fenced pseudo-keys)', () => {
      const resolved = {
        user: { id: 'user-9', email: 'm@example.com', role: 'admin' },
        token: {
          id: 'tok-1',
          projectId: 'project-9',
          scopes: ['workflow:read'],
          kind: 'personal',
          clientId: null,
        },
      };

      it('activates on a valid app token, pinned like a project API key', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers.authorization = 'Bearer bfat_valid';
        mockResolveAppToken.mockResolvedValueOnce(resolved);

        await expect(guard.canActivate(mockExecutionContext)).resolves.toBe(true);
        expect(mockRequest.user).toMatchObject({
          id: 'user-9',
          role: 'user', // admin pinned, as API keys are
          apiKeyProjectId: 'project-9',
          appTokenId: 'tok-1',
          credential: { kind: 'app_token', scopes: ['workflow:read'] },
        });
      });

      it('falls through to the session path when the bearer is not an app token', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers.authorization = 'Bearer eyJhbGciOi.jwt';
        mockResolveAppToken.mockResolvedValueOnce(null);

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
          new UnauthorizedException('Authentication required'),
        );
        expect(mockResolveAppToken).toHaveBeenCalledWith('Bearer eyJhbGciOi.jwt');
      });

      it('prefers X-API-Key when both are present', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        mockRequest.headers['x-api-key'] = 'test-api-key';
        mockRequest.headers.authorization = 'Bearer bfat_valid';
        mockDb.from.mockResolvedValue([
          { id: 'key-1', key: 'hashed-key', userId: 'user-1', projectId: 'p-1', expiresAt: null },
        ]);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        mockDb.where.mockResolvedValue(undefined);

        await expect(guard.canActivate(mockExecutionContext)).resolves.toBe(true);
        expect(mockRequest.user.apiKeyId).toBe('key-1');
        expect(mockResolveAppToken).not.toHaveBeenCalled();
      });
    });
  });
});
