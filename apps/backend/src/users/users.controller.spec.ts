import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from './users.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockSessionAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const mockRolesGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const mockUser = {
    id: 'test-uuid-1234',
    email: 'test@example.com',
    role: 'user',
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockAdminUser = {
    id: 'admin-uuid-1234',
    email: 'admin@example.com',
    role: 'admin',
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPaginatedResponse = {
    data: [mockUser, mockAdminUser],
    meta: {
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };

  const mockUsersService = {
    findAll: jest.fn().mockResolvedValue(mockPaginatedResponse),
    findById: jest.fn().mockResolvedValue(mockUser),
    findByEmail: jest.fn().mockResolvedValue(mockUser),
    update: jest.fn().mockResolvedValue(mockUser),
    updateRole: jest.fn().mockResolvedValue({ ...mockUser, role: 'admin' }),
    delete: jest.fn().mockResolvedValue(undefined),
    canModifyUser: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue(mockSessionAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const result = await controller.findAll({ page: 1, limit: 10 });

      expect(result).toEqual(mockPaginatedResponse);
      expect(usersService.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user profile', async () => {
      const currentUser = { id: 'test-uuid-1234', email: 'test@example.com', role: 'user' };

      const result = await controller.getCurrentUser(currentUser);

      expect(result).toEqual(mockUser);
      expect(usersService.findById).toHaveBeenCalledWith('test-uuid-1234');
    });
  });

  describe('findById', () => {
    it('should return a user by ID', async () => {
      const result = await controller.findById('test-uuid-1234');

      expect(result).toEqual(mockUser);
      expect(usersService.findById).toHaveBeenCalledWith('test-uuid-1234');
    });
  });

  describe('update', () => {
    it('should update user when user has permission', async () => {
      const currentUser = { id: 'test-uuid-1234', email: 'test@example.com', role: 'user' };

      const result = await controller.update(
        'test-uuid-1234',
        { email: 'updated@example.com' },
        currentUser,
      );

      expect(result.message).toBe('User updated successfully');
      expect(result.user).toEqual(mockUser);
    });

    it('should throw ForbiddenException when user lacks permission', async () => {
      mockUsersService.canModifyUser.mockReturnValueOnce(false);
      const currentUser = { id: 'other-uuid', email: 'other@example.com', role: 'user' };

      await expect(
        controller.update('test-uuid-1234', { email: 'updated@example.com' }, currentUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateRole', () => {
    it('should update user role', async () => {
      // Current user is a different user than the one being updated
      const currentUser = { id: 'admin-uuid', email: 'admin@example.com', role: 'admin' };
      const result = await controller.updateRole('test-uuid-1234', { role: UserRole.ADMIN }, currentUser);

      expect(result.message).toBe('User role updated successfully');
      expect(result.user.role).toBe('admin');
    });

    it('should not allow changing own role', async () => {
      // Current user trying to change their own role
      const currentUser = { id: 'test-uuid-1234', email: 'self@example.com', role: 'admin' };

      await expect(
        controller.updateRole('test-uuid-1234', { role: UserRole.USER }, currentUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete a user', async () => {
      const result = await controller.delete('test-uuid-1234');

      expect(result.message).toBe('User deleted successfully');
      expect(result.userId).toBe('test-uuid-1234');
      expect(usersService.delete).toHaveBeenCalledWith('test-uuid-1234');
    });
  });
});
