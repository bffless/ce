import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { UserRole } from './users.dto';

// Mock ConfigService
const mockConfigService = {
  get: jest.fn((key: string) => {
    switch (key) {
      case 'SUPERTOKENS_MULTI_TENANT':
        return 'false';
      default:
        return undefined;
    }
  }),
};

// Mock the database
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  },
}));

// Import mocked modules
import { db } from '../db/client';

// Type the mocked db
const mockDb = db as any;

describe('UsersService', () => {
  let service: UsersService;

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      // Mock count query - first call to select
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: 2 }]),
        }),
      });

      // Mock data query - second call to select
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([mockUser, mockAdminUser]),
              }),
            }),
          }),
        }),
      });

      const result = await service.findAll({
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should filter users by search term', async () => {
      // Mock count query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: 1 }]),
        }),
      });

      // Mock data query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([mockUser]),
              }),
            }),
          }),
        }),
      });

      const result = await service.findAll({
        page: 1,
        limit: 10,
        search: 'test',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].email).toBe('test@example.com');
    });

    it('should filter users by role', async () => {
      // Mock count query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: 1 }]),
        }),
      });

      // Mock data query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([mockAdminUser]),
              }),
            }),
          }),
        }),
      });

      const result = await service.findAll({
        page: 1,
        limit: 10,
        role: UserRole.ADMIN,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].role).toBe('admin');
    });
  });

  describe('findById', () => {
    it('should return a user by ID', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });

      const result = await service.findById('test-uuid-1234');

      expect(result).toBeDefined();
      expect(result.id).toBe('test-uuid-1234');
      expect(result.email).toBe('test@example.com');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findById('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });

      const result = await service.findByEmail('test@example.com');

      expect(result).toBeDefined();
      expect(result?.email).toBe('test@example.com');
    });

    it('should return null if user not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update user email', async () => {
      const updatedUser = { ...mockUser, email: 'updated@example.com' };

      // First call: check if user exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });
      // Second call: check for email conflicts
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      // Update returning
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedUser]),
          }),
        }),
      });

      const result = await service.update('test-uuid-1234', {
        email: 'updated@example.com',
      });

      expect(result.email).toBe('updated@example.com');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.update('nonexistent-id', { email: 'new@example.com' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      // First call: check if user exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });
      // Second call: check for email conflicts - returns existing user
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockAdminUser]),
          }),
        }),
      });

      await expect(
        service.update('test-uuid-1234', { email: 'admin@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateRole', () => {
    it('should update user role to admin', async () => {
      const updatedUser = { ...mockUser, role: 'admin' };

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedUser]),
          }),
        }),
      });

      const result = await service.updateRole('test-uuid-1234', {
        role: UserRole.ADMIN,
      });

      expect(result.role).toBe('admin');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.updateRole('nonexistent-id', { role: UserRole.ADMIN })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a user', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockUser]),
          }),
        }),
      });
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });

      await expect(service.delete('test-uuid-1234')).resolves.not.toThrow();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.delete('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when deleting the last admin', async () => {
      // First call: check if user exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockAdminUser]),
          }),
        }),
      });

      // Mock the count of admins - only 1 admin exists
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: 1 }]),
        }),
      });

      await expect(service.delete('admin-uuid-1234')).rejects.toThrow(BadRequestException);
    });
  });

  describe('canModifyUser', () => {
    it('should return true for admin modifying any user', () => {
      const result = service.canModifyUser('admin-id', 'admin', 'any-user-id');
      expect(result).toBe(true);
    });

    it('should return true for user modifying themselves', () => {
      const result = service.canModifyUser('user-id', 'user', 'user-id');
      expect(result).toBe(true);
    });

    it('should return false for user modifying another user', () => {
      const result = service.canModifyUser('user-id', 'user', 'other-user-id');
      expect(result).toBe(false);
    });
  });
});
