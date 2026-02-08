import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { STORAGE_ADAPTER } from '../storage/storage.module';
import { IStorageAdapter } from '../storage/storage.interface';
import { AssetSortField, SortOrder } from './assets.dto';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';
import { UsageReporterService } from '../platform/usage-reporter.service';
import { StorageQuotaService } from '../storage/storage-quota.service';

// Mock the db client - define inline to avoid hoisting issues
jest.mock('../db/client', () => {
  const mockDb = {
    select: jest.fn(),
    from: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    insert: jest.fn(),
    values: jest.fn(),
    returning: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };

  // Chain all methods
  Object.keys(mockDb).forEach((key) => {
    if (key !== 'returning') {
      (mockDb as any)[key].mockReturnValue(mockDb);
    }
  });

  return { db: mockDb };
});

// Get reference to the mocked db for use in tests
const { db: mockDb } = jest.requireMock('../db/client');

describe('AssetsService', () => {
  let service: AssetsService;
  let mockStorageAdapter: jest.Mocked<IStorageAdapter>;
  let mockPermissionsService: any;

  const mockAsset = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    fileName: 'test.png',
    originalPath: 'uploads/test.png',
    storageKey: 'owner/repo/abc123/test.png',
    mimeType: 'image/png',
    size: 1024,
    repository: 'owner/repo',
    projectId: 'project-id-123', // Added in Phase 3H
    branch: 'main',
    commitSha: 'abc123',
    workflowName: 'CI',
    workflowRunId: '123',
    workflowRunNumber: 1,
    uploadedBy: 'user-id-123',
    organizationId: null,
    tags: '["test"]',
    description: 'Test asset',
    deploymentId: null,
    isPublic: false,
    publicPath: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(async () => {
    mockStorageAdapter = {
      upload: jest.fn().mockResolvedValue('owner/repo/abc123/test.png'),
      download: jest.fn().mockResolvedValue(Buffer.from('test data')),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn().mockResolvedValue('https://storage.example.com/test.png'),
      listKeys: jest.fn().mockResolvedValue([]),
      getMetadata: jest.fn().mockResolvedValue({ key: 'test', size: 1024 }),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    };

    const mockProjectsService = {
      findOrCreateProject: jest.fn().mockResolvedValue({
        id: 'project-id-123',
        owner: 'owner',
        name: 'repo',
        displayName: 'repo',
        description: null,
        isPublic: false,
        settings: {},
        createdBy: 'user-id-123',
        createdAt: new Date(),
      }),
      getProjectById: jest.fn(),
      getProjectByOwnerName: jest.fn(),
    };

    mockPermissionsService = {
      getUserProjectRole: jest.fn().mockResolvedValue('contributor'),
      addUserToProject: jest.fn(),
      removeUserFromProject: jest.fn(),
      updateUserProjectRole: jest.fn(),
      getProjectMembers: jest.fn(),
    };

    const mockUsageReporterService = {
      reportUpload: jest.fn().mockResolvedValue(undefined),
      reportDelete: jest.fn().mockResolvedValue(undefined),
      reportUsage: jest.fn().mockResolvedValue(undefined),
      registerUsageCallback: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
    };

    const mockStorageQuotaService = {
      enforceQuota: jest.fn().mockResolvedValue(undefined),
      getQuota: jest.fn().mockResolvedValue({ quotaBytes: null, usedBytes: 0 }),
      isEnabled: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: STORAGE_ADAPTER,
          useValue: mockStorageAdapter,
        },
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: UsageReporterService,
          useValue: mockUsageReporterService,
        },
        {
          provide: StorageQuotaService,
          useValue: mockStorageQuotaService,
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    const mockFile = {
      originalname: 'test.png',
      mimetype: 'image/png',
      buffer: Buffer.from('test data'),
      size: 1024,
    } as Express.Multer.File;

    const mockDto = {
      repository: 'owner/repo',
      branch: 'main',
      commitSha: 'abc123',
      description: 'Test upload',
      tags: 'test',
    };

    it('should upload a file successfully', async () => {
      mockDb.returning.mockResolvedValue([mockAsset]);

      const result = await service.upload(mockFile, mockDto, 'user-id-123');

      expect(mockStorageAdapter.upload).toHaveBeenCalled();
      expect(result.fileName).toBe('test.png');
      expect(result.mimeType).toBe('image/png');
    });

    it('should reject files exceeding size limit', async () => {
      const largeFile = {
        ...mockFile,
        size: 200 * 1024 * 1024, // 200MB
      } as Express.Multer.File;

      await expect(service.upload(largeFile, mockDto, 'user-id-123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject unauthorized repository access', async () => {
      // Phase 3H.7: Mock no access to project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(service.upload(mockFile, mockDto, 'user-id-123', 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow upload to authorized repository', async () => {
      mockDb.returning.mockResolvedValue([mockAsset]);

      const result = await service.upload(mockFile, mockDto, 'user-id-123', 'admin');

      expect(result).toBeDefined();
      expect(mockStorageAdapter.upload).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    const mockQuery = {
      page: 1,
      limit: 10,
      sortBy: AssetSortField.CREATED_AT,
      sortOrder: SortOrder.DESC,
    };

    it('should return paginated assets for admin', async () => {
      // Mock count query first, then data query
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ count: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue([mockAsset]),
                }),
              }),
            }),
          }),
        });

      const result = await service.findAll(mockQuery, 'user-id', 'admin');

      expect(result.data).toHaveLength(1);
      expect(result.meta.page).toBe(1);
    });

    it('should filter by repository for non-admin users', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ count: 0 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        });

      const result = await service.findAll(mockQuery, 'user-id', 'user');

      expect(result.data).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should return asset for owner', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.findById(mockAsset.id, 'user-id-123', 'user');

      expect(result.id).toBe(mockAsset.id);
    });

    it('should return asset for admin regardless of owner', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.findById(mockAsset.id, 'other-user', 'admin');

      expect(result.id).toBe(mockAsset.id);
    });

    it('should throw NotFoundException for non-existent asset', async () => {
      mockDb.limit.mockResolvedValue([]);

      await expect(service.findById('non-existent', 'user-id', 'user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);
      // Phase 3H.7: Mock no access to project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(service.findById(mockAsset.id, 'other-user', 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('download', () => {
    it('should download file successfully', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.download(mockAsset.id, 'user-id-123', 'user');

      expect(result.buffer).toBeDefined();
      expect(result.fileName).toBe('test.png');
      expect(result.mimeType).toBe('image/png');
      expect(mockStorageAdapter.download).toHaveBeenCalledWith(mockAsset.storageKey);
    });
  });

  describe('getUrl', () => {
    it('should return presigned URL with expiration', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.getUrl(mockAsset.id, 'user-id-123', 'user', 3600);

      expect(result.url).toBe('https://storage.example.com/test.png');
      expect(result.expiresAt).toBeDefined();
      expect(mockStorageAdapter.getUrl).toHaveBeenCalled();
    });

    it('should return URL without expiration when expiresIn is not provided', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.getUrl(mockAsset.id, 'user-id-123', 'user');

      expect(result.url).toBe('https://storage.example.com/test.png');
      expect(result.expiresAt).toBeUndefined();
      expect(mockStorageAdapter.getUrl).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update asset metadata', async () => {
      const updatedAsset = { ...mockAsset, description: 'Updated description' };

      mockDb.limit.mockResolvedValueOnce([mockAsset]);
      mockDb.returning.mockResolvedValue([updatedAsset]);

      const result = await service.update(
        mockAsset.id,
        { description: 'Updated description' },
        'user-id-123',
        'user',
      );

      expect(result.description).toBe('Updated description');
    });

    it('should throw ForbiddenException for non-owner update', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);
      // User has no permission on this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(
        service.update(mockAsset.id, { description: 'test' }, 'other-user', 'user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete asset from storage and database', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      await service.delete(mockAsset.id, 'user-id-123', 'user');

      expect(mockStorageAdapter.delete).toHaveBeenCalledWith(mockAsset.storageKey);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw ForbiddenException for non-owner delete', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);
      // User has no permission on this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(service.delete(mockAsset.id, 'other-user', 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('batchDelete', () => {
    it('should delete multiple assets', async () => {
      mockDb.limit.mockResolvedValue([mockAsset]);

      const result = await service.batchDelete([mockAsset.id], 'user-id-123', 'user');

      expect(result).toBe(1);
    });
  });
});
