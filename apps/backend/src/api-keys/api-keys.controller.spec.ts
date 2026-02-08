import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto, UpdateApiKeyDto, ListApiKeysQueryDto } from './api-keys.dto';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let service: ApiKeysService;

  const mockUser: CurrentUserData = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    email: 'test@example.com',
    role: 'user',
  };

  const mockApiKeyId = '550e8400-e29b-41d4-a716-446655440000';

  const mockApiKeyResponse = {
    id: mockApiKeyId,
    name: 'Test API Key',
    userId: mockUser.id,
    allowedRepositories: ['owner/repo1', 'owner/repo2'],
    expiresAt: '2025-12-31T23:59:59.000Z',
    lastUsedAt: '2025-01-15T10:30:00.000Z',
    isExpired: false,
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  const mockApiKeysService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  // Mock guards
  const mockSessionAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const mockRolesGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        {
          provide: ApiKeysService,
          useValue: mockApiKeysService,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue(mockSessionAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
    service = module.get<ApiKeysService>(ApiKeysService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new API key', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Test API Key',
        allowedRepositories: ['owner/repo1', 'owner/repo2'],
        expiresAt: '2025-12-31T23:59:59Z',
      };

      const rawKey = 'wsa_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

      mockApiKeysService.create.mockResolvedValue({
        apiKey: mockApiKeyResponse,
        rawKey,
      });

      const result = await controller.create(mockUser, createDto);

      expect(result.message).toBe('API key created successfully');
      expect(result.data).toEqual(mockApiKeyResponse);
      expect(result.key).toBe(rawKey);
      expect(service.create).toHaveBeenCalledWith(mockUser.id, createDto, mockUser.role);
    });

    it('should create API key without optional fields', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Simple Key',
      };

      const simpleApiKey = {
        ...mockApiKeyResponse,
        name: 'Simple Key',
        allowedRepositories: null,
        expiresAt: null,
      };

      mockApiKeysService.create.mockResolvedValue({
        apiKey: simpleApiKey,
        rawKey: 'wsa_xyz',
      });

      const result = await controller.create(mockUser, createDto);

      expect(result.data.allowedRepositories).toBeNull();
      expect(result.data.expiresAt).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return paginated list of API keys', async () => {
      const query: ListApiKeysQueryDto = {
        page: 1,
        limit: 10,
      };

      const paginatedResult = {
        data: [mockApiKeyResponse],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      mockApiKeysService.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.findAll(mockUser, query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(service.findAll).toHaveBeenCalledWith(mockUser.id, query);
    });

    it('should pass search and sort parameters', async () => {
      const query: ListApiKeysQueryDto = {
        page: 1,
        limit: 10,
        search: 'production',
      };

      mockApiKeysService.findAll.mockResolvedValue({
        data: [],
        meta: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      await controller.findAll(mockUser, query);

      expect(service.findAll).toHaveBeenCalledWith(mockUser.id, query);
    });
  });

  describe('findOne', () => {
    it('should return API key details', async () => {
      mockApiKeysService.findOne.mockResolvedValue(mockApiKeyResponse);

      const result = await controller.findOne(mockUser, mockApiKeyId);

      expect(result.data).toEqual(mockApiKeyResponse);
      expect(service.findOne).toHaveBeenCalledWith(mockApiKeyId, mockUser.id);
    });

    it('should throw NotFoundException when API key not found', async () => {
      mockApiKeysService.findOne.mockRejectedValue(new NotFoundException('API key not found'));

      await expect(controller.findOne(mockUser, 'non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when accessing another user API key', async () => {
      mockApiKeysService.findOne.mockRejectedValue(
        new ForbiddenException('You do not have access to this API key'),
      );

      await expect(controller.findOne(mockUser, mockApiKeyId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update API key name', async () => {
      const updateDto: UpdateApiKeyDto = {
        name: 'Updated Key Name',
      };

      const updatedApiKey = {
        ...mockApiKeyResponse,
        name: 'Updated Key Name',
      };

      mockApiKeysService.update.mockResolvedValue(updatedApiKey);

      const result = await controller.update(mockUser, mockApiKeyId, updateDto);

      expect(result.message).toBe('API key updated successfully');
      expect(result.data.name).toBe('Updated Key Name');
      expect(service.update).toHaveBeenCalledWith(mockApiKeyId, mockUser.id, updateDto);
    });

    it('should update allowed repositories', async () => {
      const updateDto: UpdateApiKeyDto = {
        allowedRepositories: ['owner/new-repo'],
      };

      const updatedApiKey = {
        ...mockApiKeyResponse,
        allowedRepositories: ['owner/new-repo'],
      };

      mockApiKeysService.update.mockResolvedValue(updatedApiKey);

      const result = await controller.update(mockUser, mockApiKeyId, updateDto);

      expect(result.data.allowedRepositories).toEqual(['owner/new-repo']);
    });

    it('should throw NotFoundException when API key not found', async () => {
      mockApiKeysService.update.mockRejectedValue(new NotFoundException('API key not found'));

      await expect(
        controller.update(mockUser, 'non-existent-id', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when updating another user API key', async () => {
      mockApiKeysService.update.mockRejectedValue(
        new ForbiddenException('You do not have access to this API key'),
      );

      await expect(controller.update(mockUser, mockApiKeyId, { name: 'New Name' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('should delete API key', async () => {
      mockApiKeysService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockUser, mockApiKeyId);

      expect(result.message).toBe('API key revoked successfully');
      expect(service.remove).toHaveBeenCalledWith(mockApiKeyId, mockUser.id);
    });

    it('should throw NotFoundException when API key not found', async () => {
      mockApiKeysService.remove.mockRejectedValue(new NotFoundException('API key not found'));

      await expect(controller.remove(mockUser, 'non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when deleting another user API key', async () => {
      mockApiKeysService.remove.mockRejectedValue(
        new ForbiddenException('You do not have access to this API key'),
      );

      await expect(controller.remove(mockUser, mockApiKeyId)).rejects.toThrow(ForbiddenException);
    });
  });
});
