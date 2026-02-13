import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import {
  CreateApiKeyDto,
  UpdateApiKeyDto,
  ListApiKeysQueryDto,
  ApiKeySortField,
  SortOrder,
} from './api-keys.dto';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';

// Mock the database module
jest.mock('../db/client', () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_key'),
}));

// Mock crypto.randomBytes
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: jest
      .fn()
      .mockReturnValue(
        Buffer.from('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', 'hex'),
      ),
  };
});

import { db } from '../db/client';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let projectsService: jest.Mocked<ProjectsService>;
  let permissionsService: jest.Mocked<PermissionsService>;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440001';
  const mockApiKeyId = '550e8400-e29b-41d4-a716-446655440000';
  const mockProjectId = '550e8400-e29b-41d4-a716-446655440002';

  const mockProject = {
    id: mockProjectId,
    owner: 'owner',
    name: 'repo1',
    displayName: 'repo1',
    description: null,
    isPublic: false,
    settings: {},
    createdBy: mockUserId,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const mockApiKey = {
    id: mockApiKeyId,
    name: 'Test API Key',
    key: 'hashed_key',
    userId: mockUserId,
    projectId: mockProjectId,
    allowedRepositories: JSON.stringify(['owner/repo1']),
    expiresAt: new Date('2025-12-31T23:59:59Z'),
    lastUsedAt: new Date('2025-01-15T10:30:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    const mockProjectsService = {
      getProjectByOwnerName: jest.fn(),
    };

    const mockPermissionsService = {
      getUserProjectRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    projectsService = module.get(ProjectsService);
    permissionsService = module.get(PermissionsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new API key and return the raw key', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Test API Key',
        repository: 'owner/repo1',
        expiresAt: '2025-12-31T23:59:59Z',
      };

      projectsService.getProjectByOwnerName.mockResolvedValue(mockProject as any);
      permissionsService.getUserProjectRole.mockResolvedValue('contributor');

      const mockInsert = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.insert as jest.Mock).mockReturnValue(mockInsert);

      const result = await service.create(mockUserId, createDto);

      expect(result.rawKey).toMatch(/^wsa_/);
      expect(result.apiKey.id).toBe(mockApiKeyId);
      expect(result.apiKey.name).toBe('Test API Key');
      expect(result.apiKey.projectId).toBe(mockProjectId);
      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith('owner', 'repo1');
      expect(permissionsService.getUserProjectRole).toHaveBeenCalledWith(mockUserId, mockProjectId);
      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw BadRequestException if repository is missing', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Invalid Key',
      } as any;

      await expect(service.create(mockUserId, createDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if repository format is invalid', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Invalid Key',
        repository: 'invalid-format',
      };

      await expect(service.create(mockUserId, createDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if user does not have contributor+ role', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Test API Key',
        repository: 'owner/repo1',
      };

      projectsService.getProjectByOwnerName.mockResolvedValue(mockProject as any);
      permissionsService.getUserProjectRole.mockResolvedValue('viewer');

      await expect(service.create(mockUserId, createDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if user has no role on project', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Test API Key',
        repository: 'owner/repo1',
      };

      projectsService.getProjectByOwnerName.mockResolvedValue(mockProject as any);
      permissionsService.getUserProjectRole.mockResolvedValue(null);

      await expect(service.create(mockUserId, createDto)).rejects.toThrow(ForbiddenException);
    });

    it('should support legacy allowedRepositories field', async () => {
      const createDto: CreateApiKeyDto = {
        name: 'Legacy Key',
        allowedRepositories: ['owner/repo1'],
      };

      projectsService.getProjectByOwnerName.mockResolvedValue(mockProject as any);
      permissionsService.getUserProjectRole.mockResolvedValue('owner');

      const mockInsert = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.insert as jest.Mock).mockReturnValue(mockInsert);

      const result = await service.create(mockUserId, createDto);

      expect(result.rawKey).toMatch(/^wsa_/);
      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith('owner', 'repo1');
    });
  });

  describe('findAll', () => {
    it('should return paginated list of API keys', async () => {
      const query: ListApiKeysQueryDto = {
        page: 1,
        limit: 10,
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([{ apiKey: mockApiKey, project: mockProject }]),
      };

      const mockCountSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ value: 1 }]),
      };

      (db.select as jest.Mock).mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockSelect);

      const result = await service.findAll(mockUserId, query);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
    });

    it('should apply search filter', async () => {
      const query: ListApiKeysQueryDto = {
        page: 1,
        limit: 10,
        search: 'production',
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([]),
      };

      const mockCountSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ value: 0 }]),
      };

      (db.select as jest.Mock).mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockSelect);

      const result = await service.findAll(mockUserId, query);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('should apply sorting', async () => {
      const query: ListApiKeysQueryDto = {
        page: 1,
        limit: 10,
        sortBy: ApiKeySortField.NAME,
        sortOrder: SortOrder.ASC,
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([{ apiKey: mockApiKey, project: mockProject }]),
      };

      const mockCountSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ value: 1 }]),
      };

      (db.select as jest.Mock).mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockSelect);

      const result = await service.findAll(mockUserId, query);

      expect(result.data).toHaveLength(1);
      expect(mockSelect.orderBy).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return API key details', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const result = await service.findOne(mockApiKeyId, mockUserId);

      expect(result.id).toBe(mockApiKeyId);
      expect(result.name).toBe('Test API Key');
    });

    it('should throw NotFoundException if API key not found', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(service.findOne('non-existent-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own API key', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(service.findOne(mockApiKeyId, 'different-user-id')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('should update API key name', async () => {
      const updateDto: UpdateApiKeyDto = {
        name: 'Updated Key Name',
      };

      const updatedApiKey = { ...mockApiKey, name: 'Updated Key Name' };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const mockUpdate = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedApiKey]),
      };
      (db.update as jest.Mock).mockReturnValue(mockUpdate);

      const result = await service.update(mockApiKeyId, mockUserId, updateDto);

      expect(result.name).toBe('Updated Key Name');
      expect(db.update).toHaveBeenCalled();
    });

    it('should update allowed repositories', async () => {
      const updateDto: UpdateApiKeyDto = {
        allowedRepositories: ['owner/new-repo'],
      };

      const updatedApiKey = {
        ...mockApiKey,
        allowedRepositories: JSON.stringify(['owner/new-repo']),
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const mockUpdate = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedApiKey]),
      };
      (db.update as jest.Mock).mockReturnValue(mockUpdate);

      const result = await service.update(mockApiKeyId, mockUserId, updateDto);

      // Phase 3H.7: allowedRepositories removed, now returns null for backward compatibility
      expect(result.allowedRepositories).toBeNull();
    });

    it('should throw NotFoundException if API key not found', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(
        service.update('non-existent-id', mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user does not own API key', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(
        service.update(mockApiKeyId, 'different-user-id', { name: 'New Name' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return unchanged API key if no updates provided', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const result = await service.update(mockApiKeyId, mockUserId, {});

      expect(result.id).toBe(mockApiKeyId);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete API key', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const mockDelete = {
        where: jest.fn().mockResolvedValue(undefined),
      };
      (db.delete as jest.Mock).mockReturnValue(mockDelete);

      await service.remove(mockApiKeyId, mockUserId);

      expect(db.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if API key not found', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(service.remove('non-existent-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own API key', async () => {
      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      await expect(service.remove(mockApiKeyId, 'different-user-id')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('isExpired', () => {
    it('should correctly identify expired API keys', async () => {
      const expiredApiKey = {
        ...mockApiKey,
        expiresAt: new Date('2020-01-01T00:00:00Z'), // Past date
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([expiredApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const result = await service.findOne(mockApiKeyId, mockUserId);

      expect(result.isExpired).toBe(true);
    });

    it('should correctly identify non-expired API keys', async () => {
      const futureApiKey = {
        ...mockApiKey,
        expiresAt: new Date('2030-01-01T00:00:00Z'), // Future date
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([futureApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const result = await service.findOne(mockApiKeyId, mockUserId);

      expect(result.isExpired).toBe(false);
    });

    it('should not mark API key without expiration as expired', async () => {
      const noExpirationApiKey = {
        ...mockApiKey,
        expiresAt: null,
      };

      const mockSelect = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([noExpirationApiKey]),
      };
      (db.select as jest.Mock).mockReturnValue(mockSelect);

      const result = await service.findOne(mockApiKeyId, mockUserId);

      expect(result.isExpired).toBe(false);
    });
  });
});
