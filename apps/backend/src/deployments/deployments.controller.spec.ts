import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentsController, AliasesController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { VisibilityService } from '../domains/visibility.service';
import { ProjectsService } from '../projects/projects.service';

describe('DeploymentsController', () => {
  let controller: DeploymentsController;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;

  const mockDeploymentId = '550e8400-e29b-41d4-a716-446655440000';
  const mockUserId = 'user-id-123';
  const mockRepository = 'owner/repo';
  const mockCommitSha = 'abc123def456';

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    role: 'user',
  };

  const mockDeploymentResponse = {
    deploymentId: mockDeploymentId,
    repository: mockRepository,
    commitSha: mockCommitSha,
    branch: 'main',
    isPublic: true,
    fileCount: 2,
    totalSize: 1536,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    urls: {
      sha: `http://localhost:3000/public/${mockRepository}/commits/${mockCommitSha}/`,
      branch: `http://localhost:3000/public/${mockRepository}/alias/main/`,
      default: `http://localhost:3000/public/${mockRepository}/`,
    },
    aliases: ['main'],
  };

  const mockCreateResponse = {
    deploymentId: mockDeploymentId,
    commitSha: mockCommitSha,
    fileCount: 2,
    totalSize: 1536,
    urls: mockDeploymentResponse.urls,
    aliases: ['main'],
  };

  beforeEach(async () => {
    mockDeploymentsService = {
      createDeployment: jest.fn().mockResolvedValue(mockCreateResponse),
      listDeployments: jest.fn().mockResolvedValue({
        data: [mockDeploymentResponse],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      getDeployment: jest.fn().mockResolvedValue({
        ...mockDeploymentResponse,
        files: [
          {
            id: '1',
            fileName: 'index.html',
            publicPath: 'index.html',
            mimeType: 'text/html',
            size: 1024,
          },
        ],
      }),
      deleteDeployment: jest.fn().mockResolvedValue(undefined),
      createAlias: jest.fn().mockResolvedValue({
        id: '1',
        repository: mockRepository,
        alias: 'production',
        commitSha: mockCommitSha,
        deploymentId: mockDeploymentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateAlias: jest.fn(),
      deleteAlias: jest.fn(),
      listAliases: jest.fn(),
      resolveAlias: jest.fn(),
      getDefaultAlias: jest.fn(),
      createOrUpdateAlias: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeploymentsController],
      providers: [
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
        },
      ],
    }).compile();

    controller = module.get<DeploymentsController>(DeploymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createDeployment', () => {
    it('should create a deployment', async () => {
      const mockFiles = [
        { originalname: 'index.html', mimetype: 'text/html', size: 1024, buffer: Buffer.from('') },
      ] as Express.Multer.File[];

      const dto = {
        repository: mockRepository,
        commitSha: mockCommitSha,
        branch: 'main',
        isPublic: true,
      };

      const result = await controller.createDeployment(mockFiles, dto, mockUser);

      expect(result).toEqual(mockCreateResponse);
      expect(mockDeploymentsService.createDeployment).toHaveBeenCalledWith(
        mockFiles,
        dto,
        mockUserId,
        mockUser.role,
      );
    });
  });

  describe('listDeployments', () => {
    it('should list deployments', async () => {
      const query = { page: 1, limit: 20 };

      const result = await controller.listDeployments(query, mockUser);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(mockDeploymentsService.listDeployments).toHaveBeenCalledWith(
        query,
        mockUserId,
        'user',
      );
    });
  });

  describe('getDeployment', () => {
    it('should get deployment details', async () => {
      const result = await controller.getDeployment(mockDeploymentId, mockUser);

      expect(result.deploymentId).toBe(mockDeploymentId);
      expect(result.files).toHaveLength(1);
      expect(mockDeploymentsService.getDeployment).toHaveBeenCalledWith(
        mockDeploymentId,
        mockUserId,
        'user',
      );
    });
  });

  describe('deleteDeployment', () => {
    it('should delete deployment', async () => {
      await controller.deleteDeployment(mockDeploymentId, mockUser);

      expect(mockDeploymentsService.deleteDeployment).toHaveBeenCalledWith(
        mockDeploymentId,
        mockUserId,
        'user',
      );
    });
  });

  describe('createAlias', () => {
    it('should create an alias', async () => {
      const dto = { alias: 'production', commitSha: mockCommitSha };

      const result = await controller.createAlias(mockDeploymentId, dto, mockUser);

      expect(result.alias).toBe('production');
      expect(mockDeploymentsService.createAlias).toHaveBeenCalledWith(
        mockDeploymentId,
        dto,
        mockUserId,
        'user',
      );
    });
  });

  describe('deleteCommit', () => {
    const mockDeleteResponse = {
      message: 'Commit deleted successfully',
      deletedDeployments: 2,
      deletedFiles: 10,
      freedBytes: 50000,
    };

    beforeEach(() => {
      mockDeploymentsService.deleteCommit = jest.fn().mockResolvedValue(mockDeleteResponse);
    });

    it('should delete commit successfully', async () => {
      const result = await controller.deleteCommit('owner', 'repo', mockCommitSha, mockUser);

      expect(result).toEqual(mockDeleteResponse);
      expect(mockDeploymentsService.deleteCommit).toHaveBeenCalledWith(
        'owner',
        'repo',
        mockCommitSha,
        mockUserId,
        'user',
      );
    });

    it('should pass correct parameters from route', async () => {
      const adminUser = { ...mockUser, role: 'admin' };

      await controller.deleteCommit('testowner', 'testrepo', 'sha123', adminUser);

      expect(mockDeploymentsService.deleteCommit).toHaveBeenCalledWith(
        'testowner',
        'testrepo',
        'sha123',
        mockUserId,
        'admin',
      );
    });
  });
});

describe('AliasesController', () => {
  let controller: AliasesController;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockVisibilityService: jest.Mocked<VisibilityService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;

  const mockUserId = 'user-id-123';
  const mockRepository = 'owner/repo';
  const mockCommitSha = 'abc123def456';
  const mockDeploymentId = '550e8400-e29b-41d4-a716-446655440000';

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    role: 'admin',
  };

  const mockAliasResponse = {
    id: '1',
    repository: mockRepository,
    alias: 'main',
    commitSha: mockCommitSha,
    deploymentId: mockDeploymentId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockDeploymentsService = {
      listAliases: jest.fn().mockResolvedValue({ data: [mockAliasResponse] }),
      updateAlias: jest.fn().mockResolvedValue(mockAliasResponse),
      deleteAlias: jest.fn().mockResolvedValue(undefined),
      updateAliasVisibility: jest.fn().mockResolvedValue(mockAliasResponse),
      getAlias: jest.fn().mockResolvedValue(mockAliasResponse),
    } as any;

    mockVisibilityService = {
      resolveVisibility: jest.fn().mockResolvedValue(true),
      resolveAliasVisibility: jest.fn().mockResolvedValue(true),
      getVisibilityInfo: jest.fn().mockResolvedValue({
        effectiveVisibility: true,
        source: 'project',
        domainOverride: null,
        aliasVisibility: null,
        projectVisibility: true,
      }),
      resolveVisibilityByDomain: jest.fn().mockResolvedValue(true),
    } as any;

    mockProjectsService = {
      getProjectByOwnerName: jest.fn().mockResolvedValue({
        id: 'project-123',
        owner: 'owner',
        name: 'repo',
        isPublic: true,
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AliasesController],
      providers: [
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
        },
        {
          provide: VisibilityService,
          useValue: mockVisibilityService,
        },
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
      ],
    }).compile();

    controller = module.get<AliasesController>(AliasesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listAliases', () => {
    it('should list aliases', async () => {
      const query = { repository: mockRepository };

      const result = await controller.listAliases(query, mockUser);

      expect(result.data).toHaveLength(1);
      expect(mockDeploymentsService.listAliases).toHaveBeenCalledWith(query, mockUserId, 'admin');
    });
  });

  describe('updateAlias', () => {
    it('should update alias', async () => {
      const dto = { commitSha: 'new-sha' };

      const result = await controller.updateAlias(mockRepository, 'main', dto, mockUser);

      expect(result).toEqual(mockAliasResponse);
      expect(mockDeploymentsService.updateAlias).toHaveBeenCalledWith(
        mockRepository,
        'main',
        dto,
        mockUserId,
        'admin',
      );
    });

    it('should decode URL-encoded repository', async () => {
      const dto = { commitSha: 'new-sha' };
      const encodedRepo = 'owner%2Frepo';

      await controller.updateAlias(encodedRepo, 'main', dto, mockUser);

      expect(mockDeploymentsService.updateAlias).toHaveBeenCalledWith(
        mockRepository,
        'main',
        dto,
        mockUserId,
        'admin',
      );
    });
  });

  describe('deleteAlias', () => {
    it('should delete alias', async () => {
      await controller.deleteAlias(mockRepository, 'main', mockUser);

      expect(mockDeploymentsService.deleteAlias).toHaveBeenCalledWith(
        mockRepository,
        'main',
        mockUserId,
        'admin',
      );
    });
  });
});
