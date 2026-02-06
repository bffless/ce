import { Test, TestingModule } from '@nestjs/testing';
import { RepoBrowserController } from './repo-browser.controller';
import { RepoBrowserService } from './repo-browser.service';
import { DeploymentSortBy, SortOrder } from './repo-browser.dto';

describe('RepoBrowserController', () => {
  let controller: RepoBrowserController;
  let mockRepoBrowserService: jest.Mocked<RepoBrowserService>;

  const mockOwner = 'testuser';
  const mockRepo = 'test-repo';
  const mockCommitSha = 'abc123def456';
  const mockRepository = `${mockOwner}/${mockRepo}`;

  const mockUser = {
    id: 'user-id-123',
    email: 'test@example.com',
    role: 'user',
  };

  const mockFileTreeResponse = {
    commitSha: mockCommitSha,
    repository: mockRepository,
    branch: 'main',
    files: [
      {
        path: 'index.html',
        fileName: 'index.html',
        size: 1024,
        mimeType: 'text/html',
        isPublic: true,
        createdAt: '2024-01-15T10:30:00Z',
      },
      {
        path: 'css/style.css',
        fileName: 'style.css',
        size: 512,
        mimeType: 'text/css',
        isPublic: true,
        createdAt: '2024-01-15T10:30:00Z',
      },
    ],
  };

  const mockRefsResponse = {
    aliases: [
      {
        name: 'production',
        commitSha: mockCommitSha,
        updatedAt: '2024-01-15T10:30:00Z',
      },
    ],
    branches: [
      {
        name: 'main',
        latestCommit: mockCommitSha,
        latestDeployedAt: '2024-01-15T10:30:00Z',
        fileCount: 2,
      },
    ],
    recentCommits: [
      {
        sha: mockCommitSha,
        shortSha: 'abc123d',
        branch: 'main',
        workflowName: 'Deploy',
        deployedAt: '2024-01-15T10:30:00Z',
      },
    ],
    pagination: {
      hasMore: false,
      total: 1,
    },
  };

  const mockDeploymentsResponse = {
    repository: mockRepository,
    page: 1,
    limit: 20,
    total: 2,
    deployments: [
      {
        id: 'deploy-1',
        commitSha: mockCommitSha,
        shortSha: 'abc123d',
        branch: 'main',
        workflowName: 'CI/CD',
        deployedAt: '2024-01-15T10:00:00Z',
        fileCount: 5,
        totalSize: 5120,
        isPublic: true,
      },
      {
        id: 'deploy-2',
        commitSha: 'def456789',
        shortSha: 'def4567',
        branch: 'develop',
        workflowName: 'Test Deploy',
        deployedAt: '2024-01-14T09:00:00Z',
        fileCount: 3,
        totalSize: 3072,
        isPublic: false,
      },
    ],
  };

  const mockStatsResponse = {
    repository: mockRepository,
    totalDeployments: 10,
    totalStorageBytes: 10485760,
    totalStorageMB: 10,
    lastDeployedAt: '2024-01-15T10:00:00Z',
    branchCount: 3,
    aliasCount: 2,
    isPublic: true,
  };

  const mockAliasesResponse = {
    repository: mockRepository,
    aliases: [
      {
        id: 'alias-1',
        name: 'production',
        commitSha: mockCommitSha,
        shortSha: 'abc123d',
        branch: 'main',
        deploymentId: 'deploy-1',
        createdAt: '2024-01-10T08:00:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
      },
      {
        id: 'alias-2',
        name: 'staging',
        commitSha: 'xyz789abc456',
        shortSha: 'xyz789a',
        branch: 'develop',
        deploymentId: 'deploy-2',
        createdAt: '2024-01-12T09:00:00Z',
        updatedAt: '2024-01-14T11:00:00Z',
      },
    ],
  };

  const mockAliasCreatedResponse = {
    id: 'alias-3',
    repository: mockRepository,
    name: 'qa',
    commitSha: mockCommitSha,
    deploymentId: 'deploy-1',
    createdAt: '2024-01-16T10:00:00Z',
    updatedAt: '2024-01-16T10:00:00Z',
  };

  beforeEach(async () => {
    mockRepoBrowserService = {
      getFileTree: jest.fn().mockResolvedValue(mockFileTreeResponse),
      getRepositoryRefs: jest.fn().mockResolvedValue(mockRefsResponse),
      getDeployments: jest.fn().mockResolvedValue(mockDeploymentsResponse),
      getRepositoryStats: jest.fn().mockResolvedValue(mockStatsResponse),
      getAliases: jest.fn().mockResolvedValue(mockAliasesResponse),
      createRepositoryAlias: jest.fn().mockResolvedValue(mockAliasCreatedResponse),
      updateRepositoryAlias: jest.fn().mockResolvedValue(mockAliasCreatedResponse),
      deleteRepositoryAlias: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RepoBrowserController],
      providers: [
        {
          provide: RepoBrowserService,
          useValue: mockRepoBrowserService,
        },
      ],
    }).compile();

    controller = module.get<RepoBrowserController>(RepoBrowserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFileTree', () => {
    it('should return file tree for a deployment', async () => {
      const result = await controller.getFileTree(mockOwner, mockRepo, mockCommitSha, mockUser);

      expect(result).toEqual(mockFileTreeResponse);
      expect(mockRepoBrowserService.getFileTree).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        mockCommitSha,
        mockUser.id,
      );
    });

    it('should work without authentication for public repos', async () => {
      const result = await controller.getFileTree(mockOwner, mockRepo, mockCommitSha, undefined);

      expect(result).toEqual(mockFileTreeResponse);
      expect(mockRepoBrowserService.getFileTree).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        mockCommitSha,
        null,
      );
    });
  });

  describe('getRepositoryRefs', () => {
    it('should return repository refs metadata', async () => {
      const query = {};
      const result = await controller.getRepositoryRefs(mockOwner, mockRepo, query);

      expect(result).toEqual(mockRefsResponse);
      expect(mockRepoBrowserService.getRepositoryRefs).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
      );
    });
  });

  describe('getDeployments', () => {
    it('should return paginated deployments list with default parameters', async () => {
      const query = { page: 1, limit: 20 };
      const result = await controller.getDeployments(mockOwner, mockRepo, query as any, mockUser);

      expect(result).toEqual(mockDeploymentsResponse);
      expect(mockRepoBrowserService.getDeployments).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
        mockUser.id,
      );
    });

    it('should work without authentication for public repos', async () => {
      const query = { page: 1, limit: 20 };
      const result = await controller.getDeployments(mockOwner, mockRepo, query as any, undefined);

      expect(result).toEqual(mockDeploymentsResponse);
      expect(mockRepoBrowserService.getDeployments).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
        null,
      );
    });

    it('should pass query parameters to service', async () => {
      const query = {
        page: 2,
        limit: 50,
        branch: 'main',
        sortBy: DeploymentSortBy.DATE,
        order: SortOrder.ASC,
      };
      await controller.getDeployments(mockOwner, mockRepo, query, mockUser);

      expect(mockRepoBrowserService.getDeployments).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
        mockUser.id,
      );
    });

    it('should filter deployments by branch', async () => {
      const query = { page: 1, limit: 20, branch: 'develop' };
      await controller.getDeployments(mockOwner, mockRepo, query as any, mockUser);

      expect(mockRepoBrowserService.getDeployments).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
        mockUser.id,
      );
    });

    it('should support different sort orders', async () => {
      const query = {
        page: 1,
        limit: 20,
        sortBy: DeploymentSortBy.BRANCH,
        order: SortOrder.ASC,
      };
      await controller.getDeployments(mockOwner, mockRepo, query, mockUser);

      expect(mockRepoBrowserService.getDeployments).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        query,
        mockUser.id,
      );
    });
  });

  describe('getRepositoryStats', () => {
    it('should return repository statistics', async () => {
      const result = await controller.getRepositoryStats(mockOwner, mockRepo, mockUser);

      expect(result).toEqual(mockStatsResponse);
      expect(mockRepoBrowserService.getRepositoryStats).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        mockUser.id,
      );
    });

    it('should work without authentication for public repos', async () => {
      const result = await controller.getRepositoryStats(mockOwner, mockRepo, undefined);

      expect(result).toEqual(mockStatsResponse);
      expect(mockRepoBrowserService.getRepositoryStats).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        null,
      );
    });

    it('should pass owner and repo parameters correctly', async () => {
      const differentOwner = 'anotheruser';
      const differentRepo = 'another-repo';

      await controller.getRepositoryStats(differentOwner, differentRepo, mockUser);

      expect(mockRepoBrowserService.getRepositoryStats).toHaveBeenCalledWith(
        differentOwner,
        differentRepo,
        mockUser.id,
      );
    });
  });

  describe('getAliases (Phase 2J)', () => {
    const defaultQuery = { includeAutoPreview: false };

    it('should return all aliases for a repository', async () => {
      const result = await controller.getAliases(mockOwner, mockRepo, defaultQuery);

      expect(result).toEqual(mockAliasesResponse);
      expect(mockRepoBrowserService.getAliases).toHaveBeenCalledWith(mockOwner, mockRepo, false);
    });

    it('should work without authentication for public repos', async () => {
      const result = await controller.getAliases(mockOwner, mockRepo, defaultQuery);

      expect(result).toEqual(mockAliasesResponse);
      expect(mockRepoBrowserService.getAliases).toHaveBeenCalledWith(mockOwner, mockRepo, false);
    });

    it('should return empty aliases list when no aliases exist', async () => {
      const emptyResponse = { repository: mockRepository, aliases: [] };
      mockRepoBrowserService.getAliases.mockResolvedValueOnce(emptyResponse);

      const result = await controller.getAliases(mockOwner, mockRepo, defaultQuery);

      expect(result).toEqual(emptyResponse);
      expect(result.aliases).toHaveLength(0);
    });

    it('should include alias details like branch and timestamps', async () => {
      const result = await controller.getAliases(mockOwner, mockRepo, defaultQuery);

      expect(result.aliases[0]).toHaveProperty('id');
      expect(result.aliases[0]).toHaveProperty('name');
      expect(result.aliases[0]).toHaveProperty('commitSha');
      expect(result.aliases[0]).toHaveProperty('shortSha');
      expect(result.aliases[0]).toHaveProperty('branch');
      expect(result.aliases[0]).toHaveProperty('deploymentId');
      expect(result.aliases[0]).toHaveProperty('createdAt');
      expect(result.aliases[0]).toHaveProperty('updatedAt');
    });

    it('should pass includeAutoPreview=true to service when requested', async () => {
      const queryWithAutoPreview = { includeAutoPreview: true };
      await controller.getAliases(mockOwner, mockRepo, queryWithAutoPreview);

      expect(mockRepoBrowserService.getAliases).toHaveBeenCalledWith(mockOwner, mockRepo, true);
    });
  });

  describe('createAlias (Phase 2J)', () => {
    const createDto = {
      name: 'qa',
      commitSha: mockCommitSha,
    };

    it('should create a new alias', async () => {
      const result = await controller.createAlias(mockOwner, mockRepo, createDto, mockUser);

      expect(result).toEqual(mockAliasCreatedResponse);
      expect(mockRepoBrowserService.createRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        createDto,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should require authentication', async () => {
      // In real scenario, ApiKeyGuard would prevent this, but we test service is called correctly
      await controller.createAlias(mockOwner, mockRepo, createDto, mockUser);

      expect(mockRepoBrowserService.createRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        createDto,
        mockUser.id,
        'user',
      );
    });

    it('should pass allowed repositories for authorization', async () => {
      await controller.createAlias(mockOwner, mockRepo, createDto, mockUser);

      // Phase 3H.7: allowedRepositories parameter removed
      expect(mockRepoBrowserService.createRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        createDto,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should create alias with valid name format', async () => {
      const validNames = ['production', 'staging-v2', 'qa_test', 'release-1-0'];

      for (const name of validNames) {
        await controller.createAlias(
          mockOwner,
          mockRepo,
          { name, commitSha: mockCommitSha },
          mockUser,
        );
      }

      expect(mockRepoBrowserService.createRepositoryAlias).toHaveBeenCalledTimes(validNames.length);
    });

    it('should return created alias with timestamps', async () => {
      const result = await controller.createAlias(mockOwner, mockRepo, createDto, mockUser);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
      expect(result.name).toBe(createDto.name);
      expect(result.commitSha).toBe(createDto.commitSha);
    });
  });

  describe('updateAlias (Phase 2J)', () => {
    const updateDto = {
      commitSha: 'newsha123456',
    };
    const aliasName = 'production';

    it('should update an existing alias', async () => {
      const result = await controller.updateAlias(
        mockOwner,
        mockRepo,
        aliasName,
        updateDto,
        mockUser,
      );

      expect(result).toEqual(mockAliasCreatedResponse);
      expect(mockRepoBrowserService.updateRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        updateDto,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should require authentication', async () => {
      await controller.updateAlias(mockOwner, mockRepo, aliasName, updateDto, mockUser);

      expect(mockRepoBrowserService.updateRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        updateDto,
        mockUser.id,
        'user',
      );
    });

    it('should update alias to point to different commit', async () => {
      const differentCommit = 'xyz789def123';
      await controller.updateAlias(
        mockOwner,
        mockRepo,
        aliasName,
        { commitSha: differentCommit },
        mockUser,
      );

      expect(mockRepoBrowserService.updateRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        { commitSha: differentCommit },
        mockUser.id,
        mockUser.role,
      );
    });

    it('should pass allowed repositories for authorization', async () => {
      await controller.updateAlias(mockOwner, mockRepo, aliasName, updateDto, mockUser);

      // Phase 3H.7: allowedRepositories parameter removed
      expect(mockRepoBrowserService.updateRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        updateDto,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should return updated alias response', async () => {
      const result = await controller.updateAlias(
        mockOwner,
        mockRepo,
        aliasName,
        updateDto,
        mockUser,
      );

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('updatedAt');
      expect(result).toHaveProperty('commitSha');
    });
  });

  describe('deleteAlias (Phase 2J)', () => {
    const aliasName = 'staging';

    it('should delete an alias', async () => {
      const result = await controller.deleteAlias(mockOwner, mockRepo, aliasName, mockUser);

      expect(result).toBeUndefined();
      expect(mockRepoBrowserService.deleteRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should require authentication', async () => {
      await controller.deleteAlias(mockOwner, mockRepo, aliasName, mockUser);

      expect(mockRepoBrowserService.deleteRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        mockUser.id,
        'user',
      );
    });

    it('should pass allowed repositories for authorization', async () => {
      await controller.deleteAlias(mockOwner, mockRepo, aliasName, mockUser);

      // Phase 3H.7: allowedRepositories parameter removed
      expect(mockRepoBrowserService.deleteRepositoryAlias).toHaveBeenCalledWith(
        mockOwner,
        mockRepo,
        aliasName,
        mockUser.id,
        mockUser.role,
      );
    });

    it('should delete different aliases', async () => {
      const aliasesToDelete = ['production', 'staging', 'qa', 'dev'];

      for (const alias of aliasesToDelete) {
        await controller.deleteAlias(mockOwner, mockRepo, alias, mockUser);
      }

      expect(mockRepoBrowserService.deleteRepositoryAlias).toHaveBeenCalledTimes(
        aliasesToDelete.length,
      );
    });

    it('should return void on successful deletion', async () => {
      const result = await controller.deleteAlias(mockOwner, mockRepo, aliasName, mockUser);

      expect(result).toBeUndefined();
    });
  });
});
