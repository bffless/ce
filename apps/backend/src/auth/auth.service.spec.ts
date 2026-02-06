import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';

// Mock the database
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  },
}));

jest.mock('supertokens-node/recipe/session', () => ({
  __esModule: true,
  default: {
    getSessionInformation: jest.fn(),
    revokeSession: jest.fn(),
  },
}));

// Import mocked modules
import { db } from '../db/client';
import Session from 'supertokens-node/recipe/session';

// Type the mocked modules
const mockedDb = db as any;
const mockedSession = Session as any;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUser', () => {
    it('should create a new user with default role', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockedDb.returning.mockResolvedValue([mockUser]);

      const result = await service.createUser('test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockedDb.insert).toHaveBeenCalled();
    });

    it('should create a new admin user', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockedDb.returning.mockResolvedValue([mockUser]);

      const result = await service.createUser('admin@example.com', 'admin');

      expect(result).toEqual(mockUser);
      expect(result.role).toBe('admin');
    });
  });

  describe('getUserByEmail', () => {
    it('should return a user by email', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockedDb.limit.mockResolvedValue([mockUser]);

      const result = await service.getUserByEmail('test@example.com');

      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      mockedDb.limit.mockResolvedValue([]);

      const result = await service.getUserByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('should return a user by ID', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'test@example.com',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockedDb.limit.mockResolvedValue([mockUser]);

      const result = await service.getUserById('test-id');

      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      mockedDb.limit.mockResolvedValue([]);

      const result = await service.getUserById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'test@example.com',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockedDb.returning.mockResolvedValue([mockUser]);

      const result = await service.updateUserRole('test-id', 'admin');

      expect(result).toEqual(mockUser);
      expect(result.role).toBe('admin');
      expect(mockedDb.update).toHaveBeenCalled();
    });
  });

  describe('signOut', () => {
    it('should revoke session successfully', async () => {
      mockedSession.revokeSession.mockResolvedValue(true);

      const result = await service.signOut('test-session-handle');

      expect(result).toBe(true);
      expect(mockedSession.revokeSession).toHaveBeenCalledWith('test-session-handle');
    });

    it('should return false on error', async () => {
      mockedSession.revokeSession.mockRejectedValue(new Error('Test error'));

      const result = await service.signOut('invalid-session');

      expect(result).toBe(false);
    });
  });
});
