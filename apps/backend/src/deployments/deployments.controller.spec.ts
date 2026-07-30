import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentsController, AliasesController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { VisibilityService } from '../domains/visibility.service';
import { ProjectsService } from '../projects/projects.service';
import { PendingUploadsService } from './pending-uploads.service';
import { STORAGE_ADAPTER } from '../storage/storage.interface';

// prepareBatchDownload queries `db` directly (not through a mockable
// service), so it needs its own chainable mock -- same pattern as
// assets.service.spec.ts. Every method returns the mock itself except the
// terminal one(s) each test overrides with mockResolvedValueOnce.
jest.mock('../db/client', () => {
  const mockDb = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    orderBy: jest.fn(),
  };
  Object.keys(mockDb).forEach((key) => {
    (mockDb as any)[key].mockReturnValue(mockDb);
  });
  return { db: mockDb };
});
const { db: mockDb } = jest.requireMock('../db/client');

describe('DeploymentsController', () => {
  let controller: DeploymentsController;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockPendingUploadsService: jest.Mocked<PendingUploadsService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockVisibilityService: jest.Mocked<VisibilityService>;
  let mockStorageAdapter: any;

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
      sha: `http://localhost:3000/repo/${mockRepository}/${mockCommitSha}`,
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
      generateStorageKeyPublic: jest
        .fn()
        .mockImplementation(
          (repository: string, commitSha: string, publicPath: string) =>
            `${repository}/${commitSha}/${publicPath}`,
        ),
    } as any;

    mockPendingUploadsService = {
      create: jest.fn(),
      findByToken: jest.fn(),
      delete: jest.fn(),
      findExpired: jest.fn(),
      deleteMany: jest.fn(),
      getStorageKeysFromUpload: jest.fn(),
    } as any;

    mockProjectsService = {
      getProjectByOwnerName: jest.fn().mockResolvedValue({
        id: 'project-123',
        owner: 'owner',
        name: 'repo',
        isPublic: true,
      }),
      findOrCreateProject: jest.fn(),
      getOrCreateProjectIdForRepository: jest.fn(),
    } as any;

    mockStorageAdapter = {
      supportsPresignedUrls: jest.fn().mockReturnValue(false),
      getPresignedUploadUrl: jest.fn(),
      getUrl: jest.fn(),
      exists: jest.fn(),
    };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeploymentsController],
      providers: [
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
        },
        {
          provide: PendingUploadsService,
          useValue: mockPendingUploadsService,
        },
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
        {
          provide: VisibilityService,
          useValue: mockVisibilityService,
        },
        {
          provide: STORAGE_ADAPTER,
          useValue: mockStorageAdapter,
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

  describe('prepareBatchUpload', () => {
    const mockDto = {
      repository: mockRepository,
      commitSha: mockCommitSha,
      files: [{ path: 'index.html', size: 100, contentType: 'text/html' }],
    } as any;

    // Local storage's presigned route is for browser uploads (same-origin
    // relative URLs). Neither of this endpoint's callers (CI/Node clients,
    // or the admin SPA) has a page origin to resolve a relative URL
    // against, and presigning buys nothing over the ZIP fallback on local
    // storage anyway -- see the comment on prepareBatchUpload in
    // deployments.controller.ts.
    it('reports presigned unsupported when the active adapter is the local one, even if supportsPresignedUrls() is true', async () => {
      mockStorageAdapter.isLocalAdapter = true;
      mockStorageAdapter.supportsPresignedUrls.mockReturnValue(true);

      const result = await controller.prepareBatchUpload(mockDto, mockUser);

      expect(result).toEqual({ presignedUrlsSupported: false });
      // Must not attempt to mint a URL (and must not touch pending-upload
      // bookkeeping) once the endpoint has already decided to fall back.
      expect(mockStorageAdapter.getPresignedUploadUrl).not.toHaveBeenCalled();
      expect(mockPendingUploadsService.create).not.toHaveBeenCalled();
    });

    it('still returns presigned URLs for a non-local adapter that supports them', async () => {
      mockStorageAdapter.isLocalAdapter = false;
      mockStorageAdapter.supportsPresignedUrls.mockReturnValue(true);
      mockStorageAdapter.getPresignedUploadUrl.mockResolvedValue('https://bucket.example/signed');
      mockProjectsService.findOrCreateProject.mockResolvedValue({
        id: 'project-123',
        owner: 'owner',
        name: 'repo',
      } as any);
      mockPendingUploadsService.create.mockResolvedValue({
        uploadToken: 'token-123',
      } as any);

      const result = await controller.prepareBatchUpload(mockDto, mockUser);

      expect(result.presignedUrlsSupported).toBe(true);
      expect(mockStorageAdapter.getPresignedUploadUrl).toHaveBeenCalled();
    });
  });

  describe('prepareBatchDownload', () => {
    const mockDownloadDto = {
      repository: mockRepository,
      path: '',
      commitSha: mockCommitSha,
    } as any;

    const mockAssetRow = {
      id: 'asset-1',
      projectId: 'project-123',
      commitSha: mockCommitSha,
      publicPath: 'index.html',
      fileName: 'index.html',
      size: 123,
      storageKey: `${mockRepository}/${mockCommitSha}/index.html`,
      branch: 'main',
    };

    beforeEach(() => {
      // Reset the terminal query methods so mockResolvedValueOnce from a
      // prior test in this block can't leak into the next one.
      mockDb.where.mockReset().mockReturnValue(mockDb);
      mockDb.limit.mockReset().mockReturnValue(mockDb);
    });

    // Regression test for the finding that supportsPresignedUrls() now
    // returning true for local storage made this endpoint take the
    // presigned branch and call getUrl(), whose local implementation
    // ignores the expiry argument and returns `${baseUrl}/${key}` with
    // baseUrl defaulting to the vestigial 'http://localhost:3000/files' --
    // leaking localhost into download URLs on a real install. See the
    // comment on prepareBatchDownload in deployments.controller.ts.
    it('returns /api/files/... fallback URLs, NOT localhost:3000/files, when the active adapter is local', async () => {
      mockStorageAdapter.isLocalAdapter = true;
      mockStorageAdapter.supportsPresignedUrls.mockReturnValue(true);
      // Matching-assets query: db.select().from(assets).where(...) — no
      // trailing .limit(), so .where() is the terminal call to resolve.
      mockDb.where.mockResolvedValueOnce([mockAssetRow]);

      const result = await controller.prepareBatchDownload(mockDownloadDto, mockUser);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].downloadUrl).toContain('/api/files/');
      // The specific signature of this bug: a leaked localhost URL.
      expect(result.files[0].downloadUrl).not.toContain('localhost:3000/files');
      expect(mockStorageAdapter.getUrl).not.toHaveBeenCalled();
    });

    it('still returns presigned URLs from getUrl() for a non-local adapter that supports them', async () => {
      mockStorageAdapter.isLocalAdapter = false;
      mockStorageAdapter.supportsPresignedUrls.mockReturnValue(true);
      mockStorageAdapter.getUrl.mockResolvedValue('https://bucket.example/signed-download');
      mockDb.where.mockResolvedValueOnce([mockAssetRow]);

      const result = await controller.prepareBatchDownload(mockDownloadDto, mockUser);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].downloadUrl).toBe('https://bucket.example/signed-download');
      expect(mockStorageAdapter.getUrl).toHaveBeenCalledWith(mockAssetRow.storageKey, 3600);
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
