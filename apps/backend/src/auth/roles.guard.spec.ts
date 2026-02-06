import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthService } from './auth.service';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getUserById: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    let mockExecutionContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        user: { id: 'user-123' },
      };

      mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;
    });

    it('should allow access if no roles required', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow access if user has required role', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

      const mockUser = {
        id: 'user-123',
        email: 'admin@example.com',
        role: 'admin',
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(authService, 'getUserById').mockResolvedValue(mockUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.user.role).toBe('admin');
      expect(mockRequest.user.email).toBe('admin@example.com');
    });

    it('should deny access if user does not have required role', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'user',
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(authService, 'getUserById').mockResolvedValue(mockUser);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(ForbiddenException);
    });

    it('should deny access if user is not authenticated', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

      mockRequest.user = null;

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('User not authenticated'),
      );
    });

    it('should deny access if user not found in database', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

      jest.spyOn(authService, 'getUserById').mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('User not found'),
      );
    });

    it('should allow access if user has any of the required roles', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'moderator']);

      const mockUser = {
        id: 'user-123',
        email: 'moderator@example.com',
        role: 'moderator',
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(authService, 'getUserById').mockResolvedValue(mockUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });
  });
});
