import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import { STORAGE_ADAPTER } from '../storage/storage.module';
import { IStorageAdapter } from '../storage/storage.interface';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { UsageReporterService } from '../platform/usage-reporter.service';

// Mock the db client with proper chaining
jest.mock('../db/client', () => {
  const createChainMock = () => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      // This allows the chain to be awaited directly
      then: jest.fn((resolve) => resolve([])),
    };
    return chain;
  };

  return { db: createChainMock() };
});

// Get reference to the mocked db
const { db: mockDb } = jest.requireMock('../db/client');

describe('DeploymentsService', () => {
  let service: DeploymentsService;
  let mockStorageAdapter: jest.Mocked<IStorageAdapter>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;

  const mockDeploymentId = '550e8400-e29b-41d4-a716-446655440000';
  const mockUserId = 'user-id-123';
  const mockRepository = 'owner/repo';
  const mockCommitSha = 'abc123def456';
  const mockProjectId = 'project-id-123';

  const mockProject = {
    id: mockProjectId,
    owner: 'owner',
    name: 'repo',
    displayName: 'Test Repo',
    description: null,
    isPublic: true, // Changed to true for getDefaultAlias tests
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    settings: {},
    defaultProxyRuleSetId: null,
    createdBy: mockUserId,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockAsset = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    fileName: 'index.html',
    originalPath: 'index.html',
    storageKey: `${mockRepository}/${mockCommitSha}/index.html`,
    mimeType: 'text/html',
    size: 1024,
    projectId: mockProjectId,
    repository: mockRepository,
    branch: 'main',
    commitSha: mockCommitSha,
    workflowName: 'CI',
    workflowRunId: '123',
    workflowRunNumber: 1,
    uploadedBy: mockUserId,
    organizationId: null,
    tags: null,
    description: 'Test deployment',
    deploymentId: mockDeploymentId,
    isPublic: true,
    publicPath: 'index.html',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockAlias = {
    id: '550e8400-e29b-41d4-a716-446655440002',
    repository: mockRepository,
    alias: 'main',
    commitSha: mockCommitSha,
    deploymentId: mockDeploymentId,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  // Helper to set up mock chain result
  const setupMockChain = (results: any[][]) => {
    let callIndex = 0;

    // Reset the mock
    mockDb.then.mockImplementation((resolve: any) => {
      const result = results[callIndex] || [];
      callIndex++;
      return resolve(result);
    });

    mockDb.returning.mockImplementation(() => {
      const result = results[callIndex] || [];
      callIndex++;
      return Promise.resolve(result);
    });
  };

  beforeEach(async () => {
    mockStorageAdapter = {
      upload: jest.fn().mockResolvedValue('storage-key'),
      download: jest.fn().mockResolvedValue(Buffer.from('test data')),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn().mockResolvedValue('https://storage.example.com/file'),
      listKeys: jest.fn().mockResolvedValue([]),
      getMetadata: jest.fn().mockResolvedValue({ key: 'test', size: 1024 }),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    };

    mockProjectsService = {
      findOrCreateProject: jest.fn().mockResolvedValue(mockProject),
      getProjectById: jest.fn().mockResolvedValue(mockProject),
      getProjectByOwnerName: jest.fn().mockResolvedValue(mockProject),
      listUserProjects: jest.fn().mockResolvedValue([mockProject]),
      updateProject: jest.fn().mockResolvedValue(mockProject),
      deleteProject: jest.fn().mockResolvedValue(undefined),
      createProject: jest.fn().mockResolvedValue(mockProject),
      projectExists: jest.fn().mockResolvedValue(true),
    } as any;

    mockPermissionsService = {
      getUserProjectRole: jest.fn().mockResolvedValue('contributor'),
      addUserToProject: jest.fn().mockResolvedValue(undefined),
      removeUserFromProject: jest.fn().mockResolvedValue(undefined),
      updateUserProjectRole: jest.fn().mockResolvedValue(undefined),
      getProjectMembers: jest.fn().mockResolvedValue([]),
    } as any;

    const mockNginxRegenerationService = {
      regenerateForRuleSet: jest.fn().mockResolvedValue(undefined),
      regenerateForAlias: jest.fn().mockResolvedValue(undefined),
    };

    const mockUsageReporterService = {
      reportUpload: jest.fn().mockResolvedValue(undefined),
      reportDelete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentsService,
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
          provide: NginxRegenerationService,
          useValue: mockNginxRegenerationService,
        },
        {
          provide: UsageReporterService,
          useValue: mockUsageReporterService,
        },
      ],
    }).compile();

    service = module.get<DeploymentsService>(DeploymentsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDeployment', () => {
    const mockFiles = [
      {
        originalname: 'index.html',
        mimetype: 'text/html',
        size: 1024,
        buffer: Buffer.from('<html></html>'),
      },
      {
        originalname: 'style.css',
        mimetype: 'text/css',
        size: 512,
        buffer: Buffer.from('body {}'),
      },
    ] as Express.Multer.File[];

    const createDto = {
      repository: mockRepository,
      commitSha: mockCommitSha,
      branch: 'main',
      isPublic: true,
    };

    it('should create a deployment with files', async () => {
      setupMockChain([
        [mockAsset], // First file insert
        [{ ...mockAsset, fileName: 'style.css' }], // Second file insert
        [], // Alias lookup (not found)
        [mockAlias], // Alias insert
      ]);

      const result = await service.createDeployment(mockFiles, createDto, mockUserId);

      expect(result).toBeDefined();
      expect(result.commitSha).toBe(mockCommitSha);
      expect(result.fileCount).toBe(2);
      expect(result.urls.sha).toContain(mockCommitSha);
      expect(mockStorageAdapter.upload).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException when no files provided', async () => {
      await expect(service.createDeployment([], createDto, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException for unauthorized user (no project access)', async () => {
      // Mock user has no access to this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(
        service.createDeployment(mockFiles, createDto, mockUserId, 'user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow deployment with contributor role', async () => {
      // Mock user has contributor role
      mockPermissionsService.getUserProjectRole.mockResolvedValue('contributor');
      setupMockChain([[mockAsset], [{ ...mockAsset, fileName: 'style.css' }], [], [mockAlias]]);

      const result = await service.createDeployment(mockFiles, createDto, mockUserId, 'user');

      expect(result).toBeDefined();
      expect(result.fileCount).toBe(2);
    });

    it('should allow deployment for admin user without project role check', async () => {
      setupMockChain([[mockAsset], [{ ...mockAsset, fileName: 'style.css' }], [], [mockAlias]]);

      const result = await service.createDeployment(mockFiles, createDto, mockUserId, 'admin');

      expect(result).toBeDefined();
      expect(result.fileCount).toBe(2);
      // Admin bypasses permission check
      expect(mockPermissionsService.getUserProjectRole).not.toHaveBeenCalled();
    });
  });

  describe('getDeployment', () => {
    it('should return deployment details', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([
        [{ asset: mockAsset, project: mockProject }], // Get assets with project
        [mockAlias], // Get aliases
      ]);

      const result = await service.getDeployment(mockDeploymentId, mockUserId, 'admin');

      expect(result).toBeDefined();
      expect(result.deploymentId).toBe(mockDeploymentId);
      expect(result.files).toHaveLength(1);
    });

    it('should throw NotFoundException for non-existent deployment', async () => {
      setupMockChain([[]]);

      await expect(service.getDeployment('non-existent', mockUserId, 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([[{ asset: mockAsset, project: mockProject }]]);
      // Mock user has no access to this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(service.getDeployment(mockDeploymentId, 'other-user', 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow admin to access any deployment', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([[{ asset: mockAsset, project: mockProject }], [mockAlias]]);

      const result = await service.getDeployment(mockDeploymentId, 'other-user', 'admin');

      expect(result).toBeDefined();
    });
  });

  describe('deleteDeployment', () => {
    it('should delete deployment and all files', async () => {
      setupMockChain([[mockAsset]]);

      await service.deleteDeployment(mockDeploymentId, mockUserId, 'admin');

      expect(mockStorageAdapter.delete).toHaveBeenCalledWith(mockAsset.storageKey);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent deployment', async () => {
      setupMockChain([[]]);

      await expect(service.deleteDeployment('non-existent', mockUserId, 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for unauthorized deletion', async () => {
      setupMockChain([[mockAsset]]);
      // Mock user has no access to this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(
        service.deleteDeployment(mockDeploymentId, 'other-user', 'user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createOrUpdateAlias', () => {
    it('should create a new alias', async () => {
      setupMockChain([
        [], // Alias lookup (not found)
        [mockAlias], // Alias insert
      ]);

      const result = await service.createOrUpdateAlias(
        mockRepository,
        'production',
        mockCommitSha,
        mockDeploymentId,
      );

      expect(result).toBeDefined();
      expect(result.alias).toBe('main');
      expect(result.commitSha).toBe(mockCommitSha);
    });

    it('should update existing alias', async () => {
      const existingAlias = { ...mockAlias, id: 'existing-id' };
      setupMockChain([
        [existingAlias], // Alias lookup (found)
        [{ ...mockAlias, commitSha: 'new-sha' }], // Alias update
      ]);

      const result = await service.createOrUpdateAlias(
        mockRepository,
        'main',
        'new-sha',
        mockDeploymentId,
      );

      expect(result).toBeDefined();
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('resolveAlias', () => {
    it('should resolve alias to commit SHA', async () => {
      setupMockChain([[mockAlias]]);

      const result = await service.resolveAlias(mockRepository, 'main');

      expect(result).toBe(mockCommitSha);
    });

    it('should return null for non-existent alias', async () => {
      setupMockChain([[]]);

      const result = await service.resolveAlias(mockRepository, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getDefaultAlias', () => {
    it('should return production alias first', async () => {
      setupMockChain([[{ ...mockAlias, alias: 'production' }]]);

      const result = await service.getDefaultAlias(mockRepository);

      expect(result).toBe(mockCommitSha);
    });

    it('should fall back to main if production not found', async () => {
      setupMockChain([
        [], // production not found
        [mockAlias], // main found
      ]);

      const result = await service.getDefaultAlias(mockRepository);

      expect(result).toBe(mockCommitSha);
    });

    it('should return latest public asset if no aliases', async () => {
      setupMockChain([
        [], // production
        [], // main
        [], // master
        [], // latest
        [mockAsset], // fallback to latest asset
      ]);

      const result = await service.getDefaultAlias(mockRepository);

      expect(result).toBe(mockCommitSha);
    });

    it('should return null if no deployments found', async () => {
      setupMockChain([
        [], // production
        [], // main
        [], // master
        [], // latest
        [], // no assets
      ]);

      const result = await service.getDefaultAlias(mockRepository);

      expect(result).toBeNull();
    });
  });

  describe('updateAlias', () => {
    it('should update alias to new commit SHA', async () => {
      const newSha = 'xyz789';
      setupMockChain([
        [mockAlias], // Find existing alias
        [{ ...mockAsset, commitSha: newSha }], // Find target asset
        [{ ...mockAlias, commitSha: newSha }], // Update alias
      ]);

      const result = await service.updateAlias(
        mockRepository,
        'main',
        { commitSha: newSha },
        mockUserId,
        'admin',
      );

      expect(result.commitSha).toBe(newSha);
    });

    it('should throw NotFoundException for non-existent alias', async () => {
      setupMockChain([[]]);

      await expect(
        service.updateAlias(
          mockRepository,
          'non-existent',
          { commitSha: 'xyz789' },
          mockUserId,
          'admin',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized update', async () => {
      setupMockChain([[mockAlias]]);
      // Mock user has no access to this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(
        service.updateAlias(mockRepository, 'main', { commitSha: 'xyz789' }, mockUserId, 'user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteAlias', () => {
    it('should delete alias', async () => {
      setupMockChain([[mockAlias]]);

      await service.deleteAlias(mockRepository, 'main', mockUserId, 'admin');

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent alias', async () => {
      setupMockChain([[]]);

      await expect(
        service.deleteAlias(mockRepository, 'non-existent', mockUserId, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized deletion', async () => {
      setupMockChain([[mockAlias]]);
      // Mock user has no access to this project
      mockPermissionsService.getUserProjectRole.mockResolvedValueOnce(null);

      await expect(service.deleteAlias(mockRepository, 'main', mockUserId, 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listAliases', () => {
    it('should list aliases for repository', async () => {
      setupMockChain([[mockAlias]]);

      const result = await service.listAliases({ repository: mockRepository }, mockUserId, 'admin');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].alias).toBe('main');
    });

    it('should filter by allowed repositories for non-admin', async () => {
      setupMockChain([[mockAlias, { ...mockAlias, repository: 'other/repo' }]]);

      const result = await service.listAliases({}, mockUserId, 'user');

      // Phase 3H.7: allowedRepositories removed - now returns all aliases user has access to
      // This test no longer filters by repository since authorization is project-based
      expect(result.data).toHaveLength(2);
      expect(result.data[0].repository).toBe(mockRepository);
    });
  });

  describe('listDeployments', () => {
    it('should list deployments with pagination', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([
        [{ asset: mockAsset, project: mockProject }], // Get all assets with project
        [], // Get aliases
      ]);

      const result = await service.listDeployments({ page: 1, limit: 10 }, mockUserId, 'admin');

      expect(result.data).toBeDefined();
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
    });

    it('should filter by repository', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([[{ asset: mockAsset, project: mockProject }], []]);
      // Mock getProjectByOwnerName for repository filtering
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);

      const result = await service.listDeployments(
        { repository: mockRepository },
        mockUserId,
        'admin',
      );

      expect(result.data).toBeDefined();
    });

    it('should filter by public status', async () => {
      // Phase 3H.7: Now returns { asset, project } objects from leftJoin
      setupMockChain([[{ asset: mockAsset, project: mockProject }], []]);

      const result = await service.listDeployments({ isPublic: true }, mockUserId, 'admin');

      expect(result.data).toBeDefined();
    });
  });

  describe('deleteCommit', () => {
    const mockOwner = 'owner';
    const mockRepo = 'repo';

    it('should delete commit successfully when no aliases exist', async () => {
      // Setup mocks for successful deletion
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('admin');

      // Mock: no aliases, assets exist
      setupMockChain([
        [], // getAliasesForCommit - no aliases
        [mockAsset, { ...mockAsset, id: 'asset-2', size: 2000 }], // commitAssets
      ]);

      // Mock transaction
      mockDb.transaction = jest.fn().mockImplementation(async (callback) => {
        const txMock = {
          delete: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        return callback(txMock);
      });

      const result = await service.deleteCommit(
        mockOwner,
        mockRepo,
        mockCommitSha,
        mockUserId,
        'admin',
      );

      expect(result.message).toBe('Commit deleted successfully');
      expect(result.deletedFiles).toBe(2);
      expect(mockStorageAdapter.deletePrefix).toHaveBeenCalledWith(
        `${mockOwner}/${mockRepo}/${mockCommitSha}/`,
      );
    });

    it('should throw BadRequestException when aliases exist', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('admin');

      // Mock: aliases exist
      setupMockChain([
        [{ alias: 'production' }, { alias: 'staging' }], // getAliasesForCommit
      ]);

      await expect(
        service.deleteCommit(mockOwner, mockRepo, mockCommitSha, mockUserId, 'admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when commit not found', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('admin');

      // Mock: no aliases, no assets
      setupMockChain([
        [], // getAliasesForCommit
        [], // commitAssets - empty
      ]);

      await expect(
        service.deleteCommit(mockOwner, mockRepo, mockCommitSha, mockUserId, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user lacks access', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue(null);

      await expect(
        service.deleteCommit(mockOwner, mockRepo, mockCommitSha, mockUserId, 'user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should handle storage deletion failure gracefully', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('admin');

      // Mock: no aliases, assets exist
      setupMockChain([
        [], // getAliasesForCommit
        [mockAsset], // commitAssets
      ]);

      // Mock transaction
      mockDb.transaction = jest.fn().mockImplementation(async (callback) => {
        const txMock = {
          delete: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        return callback(txMock);
      });

      // Mock storage failure
      mockStorageAdapter.deletePrefix.mockRejectedValue(new Error('Storage error'));

      // Should not throw - database cleanup succeeded
      const result = await service.deleteCommit(
        mockOwner,
        mockRepo,
        mockCommitSha,
        mockUserId,
        'admin',
      );
      expect(result.message).toBe('Commit deleted successfully');
    });
  });
});
