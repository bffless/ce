import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { PublicController } from './public.controller';
import { DeploymentsService } from './deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { VisibilityService } from '../domains/visibility.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CacheConfigService, CacheConfig } from '../cache-rules/cache-config.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { STORAGE_ADAPTER } from '../storage/storage.module';
import { IStorageAdapter } from '../storage/storage.interface';

// Mock the db client
jest.mock('../db/client', () => {
  const createChainMock = () => {
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      then: jest.fn((resolve) => resolve([])),
    };
    return chain;
  };

  return { db: createChainMock() };
});

import * as dbClient from '../db/client';
const mockDb = (dbClient as any).db;

describe('PublicController', () => {
  let controller: PublicController;
  let mockStorageAdapter: jest.Mocked<IStorageAdapter>;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockVisibilityService: jest.Mocked<VisibilityService>;
  let mockTrafficRoutingService: jest.Mocked<TrafficRoutingService>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCacheConfigService: jest.Mocked<CacheConfigService>;
  let mockShareLinksService: jest.Mocked<ShareLinksService>;

  const mockOwner = 'owner';
  const mockRepo = 'repo';
  const mockRepository = `${mockOwner}/${mockRepo}`;
  const mockCommitSha = 'abc123def456';

  const mockPublicProject = {
    id: 'project-123',
    owner: mockOwner,
    name: mockRepo,
    displayName: 'Test Repo',
    description: null,
    isPublic: true,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    settings: {},
    defaultProxyRuleSetId: null,
    createdBy: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAsset = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    fileName: 'index.html',
    originalPath: 'index.html',
    storageKey: `${mockRepository}/${mockCommitSha}/index.html`,
    mimeType: 'text/html',
    size: 1024,
    repository: mockRepository,
    branch: 'main',
    commitSha: mockCommitSha,
    workflowName: 'CI',
    workflowRunId: '123',
    workflowRunNumber: 1,
    uploadedBy: 'user-123',
    organizationId: null,
    tags: null,
    description: 'Test deployment',
    deploymentId: '550e8400-e29b-41d4-a716-446655440000',
    isPublic: true,
    publicPath: 'index.html',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const createMockRequest = (user?: any, path: string = '/public/owner/repo/abc123def456/index.html') => {
    const req = {
      user,
      headers: {},
      path,
    } as unknown as Request;
    return req;
  };

  const createMockResponse = () => {
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      end: jest.fn(),
      setHeader: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      req: {
        headers: {},
      },
    } as unknown as Response;
    return res;
  };

  beforeEach(async () => {
    mockStorageAdapter = {
      upload: jest.fn().mockResolvedValue('storage-key'),
      download: jest.fn().mockResolvedValue(Buffer.from('<html></html>')),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn().mockResolvedValue('https://storage.example.com/file'),
      listKeys: jest.fn().mockResolvedValue([]),
      getMetadata: jest.fn().mockResolvedValue({ key: 'test', size: 1024 }),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    };

    mockDeploymentsService = {
      getDefaultAlias: jest.fn().mockResolvedValue(mockCommitSha),
      resolveAlias: jest.fn().mockResolvedValue(mockCommitSha),
    } as any;

    mockProjectsService = {
      getProjectByOwnerName: jest.fn().mockResolvedValue(mockPublicProject),
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
      resolveAccessControl: jest.fn().mockResolvedValue({
        isPublic: true,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'project',
      }),
      resolveAccessControlByDomain: jest.fn().mockResolvedValue({
        isPublic: true,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'project',
      }),
      resolveAccessControlForAlias: jest.fn().mockResolvedValue({
        isPublic: true,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'project',
      }),
    } as any;

    mockTrafficRoutingService = {
      selectVariant: jest.fn().mockResolvedValue(null), // No multivariant by default
      getTrafficConfig: jest.fn().mockResolvedValue({ weights: [], stickySessionsEnabled: true, stickySessionDuration: 86400 }),
      setTrafficWeights: jest.fn().mockResolvedValue(undefined),
      clearTrafficWeights: jest.fn().mockResolvedValue(undefined),
      getAvailableAliases: jest.fn().mockResolvedValue([]),
    } as any;

    mockPermissionsService = {
      getUserProjectRole: jest.fn().mockResolvedValue('viewer'),
      meetsRoleRequirement: jest.fn().mockReturnValue(true),
    } as any;

    mockConfigService = {
      get: jest.fn().mockReturnValue('localhost'),
    } as any;

    // Default cache config for immutable (SHA-based) content
    const defaultImmutableConfig: CacheConfig = {
      browserMaxAge: 31536000,
      cdnMaxAge: null,
      staleWhileRevalidate: null,
      immutable: true,
      cacheability: null,
      source: 'default',
    };

    // Default cache config for mutable (alias-based) content
    const defaultMutableConfig: CacheConfig = {
      browserMaxAge: 300,
      cdnMaxAge: null,
      staleWhileRevalidate: null,
      immutable: false,
      cacheability: null,
      source: 'default',
    };

    // Default cache config for mutable HTML content (no browser cache)
    const defaultMutableHtmlConfig: CacheConfig = {
      browserMaxAge: 0,
      cdnMaxAge: null,
      staleWhileRevalidate: null,
      immutable: false,
      cacheability: null,
      source: 'default',
    };

    mockCacheConfigService = {
      getCacheConfig: jest.fn().mockImplementation(
        (_projectId: string, filePath: string, isImmutable: boolean) => {
          if (isImmutable) return Promise.resolve(defaultImmutableConfig);
          const isHtml = /\.html?$/i.test(filePath);
          return Promise.resolve(isHtml ? defaultMutableHtmlConfig : defaultMutableConfig);
        },
      ),
      buildCacheControlHeader: jest.fn().mockImplementation(
        (config: CacheConfig, isPublicContent: boolean) => {
          const cacheability = config.cacheability ?? (isPublicContent ? 'public' : 'private');
          if (config.immutable) {
            return `${cacheability}, max-age=${config.browserMaxAge}, immutable`;
          }
          return `${cacheability}, max-age=${config.browserMaxAge}, must-revalidate`;
        },
      ),
      calculateRedisTtl: jest.fn().mockReturnValue(300),
      invalidateProjectCache: jest.fn(),
      clearAllCache: jest.fn(),
    } as any;

    mockShareLinksService = {
      validateToken: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      getByProjectId: jest.fn().mockResolvedValue([]),
      getByDomainMappingId: jest.fn().mockResolvedValue([]),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      regenerateToken: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        {
          provide: STORAGE_ADAPTER,
          useValue: mockStorageAdapter,
        },
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
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
          provide: TrafficRoutingService,
          useValue: mockTrafficRoutingService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CacheConfigService,
          useValue: mockCacheConfigService,
        },
        {
          provide: ShareLinksService,
          useValue: mockShareLinksService,
        },
      ],
    }).compile();

    controller = module.get<PublicController>(PublicController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('serveDefault', () => {
    const setupDbMock = (results: any[]) => {
      let callIndex = 0;
      mockDb.then.mockImplementation((resolve: any) => {
        const result = results[callIndex] || [];
        callIndex++;
        return resolve(result);
      });
    };

    it('should redirect to commits URL when default alias exists', async () => {
      // Mock the database query that checks for public assets
      setupDbMock([[mockAsset]]);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveDefault(mockOwner, mockRepo, req, res);

      expect(mockDeploymentsService.getDefaultAlias).toHaveBeenCalledWith(mockRepository);
      expect(res.redirect).toHaveBeenCalledWith(301, `/public/${mockRepository}/commits/${mockCommitSha}/`);
    });

    it('should return 404 HTML page when no default deployment found', async () => {
      mockDeploymentsService.getDefaultAlias.mockResolvedValue(null);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveDefault(mockOwner, mockRepo, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();
    });

    it('should return 404 HTML page when alias is private and user not authenticated', async () => {
      // Mock private visibility (Phase B5: now using VisibilityService)
      mockVisibilityService.resolveAliasVisibility.mockResolvedValue(false);
      mockVisibilityService.resolveAccessControlForAlias.mockResolvedValue({
        isPublic: false,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'alias',
      });

      const req = createMockRequest(); // No user
      const res = createMockResponse();

      await controller.serveDefault(mockOwner, mockRepo, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();
    });

    it('should redirect when alias is private but user is authenticated', async () => {
      // Mock private visibility (Phase B5: now using VisibilityService)
      mockVisibilityService.resolveAliasVisibility.mockResolvedValue(false);
      mockVisibilityService.resolveAccessControlForAlias.mockResolvedValue({
        isPublic: false,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'alias',
      });

      const req = createMockRequest({ id: 'user-123' }); // Authenticated user
      const res = createMockResponse();

      await controller.serveDefault(mockOwner, mockRepo, req, res);

      expect(res.redirect).toHaveBeenCalledWith(301, `/public/${mockRepository}/commits/${mockCommitSha}/`);
    });
  });

  describe('serveCommitAsset', () => {
    const setupDbMock = (results: any[]) => {
      let callIndex = 0;
      mockDb.then.mockImplementation((resolve: any) => {
        const result = results[callIndex] || [];
        callIndex++;
        return resolve(result);
      });
    };

    it('should serve file with SHA reference', async () => {
      setupDbMock([[mockAsset]]);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveCommitAsset(mockOwner, mockRepo, mockCommitSha, 'index.html', req, res);

      expect(mockStorageAdapter.download).toHaveBeenCalledWith(mockAsset.storageKey);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalled();
    });

    it('should serve index.html when path is empty', async () => {
      const indexAsset = { ...mockAsset, publicPath: 'index.html' };
      setupDbMock([[indexAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        '',
        createMockRequest(),
        res,
      );

      expect(mockStorageAdapter.download).toHaveBeenCalled();
    });

    it('should serve index.html when path ends with slash', async () => {
      const indexAsset = { ...mockAsset, publicPath: 'docs/index.html' };
      setupDbMock([[indexAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'docs/',
        createMockRequest(),
        res,
      );

      expect(mockStorageAdapter.download).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid SHA format', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await expect(
        controller.serveCommitAsset(mockOwner, mockRepo, 'not-a-sha!', 'index.html', req, res),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for path traversal attempt', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await expect(
        controller.serveCommitAsset(mockOwner, mockRepo, mockCommitSha, '../secret.txt', req, res),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for absolute path', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await expect(
        controller.serveCommitAsset(mockOwner, mockRepo, mockCommitSha, '/etc/passwd', req, res),
      ).rejects.toThrow(BadRequestException);
    });

    it('should serve 404.html when file not found', async () => {
      const notFoundAsset = { ...mockAsset, publicPath: '404.html' };
      setupDbMock([[], [notFoundAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'missing.html',
        createMockRequest(),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 HTML page when file and 404.html not found', async () => {
      setupDbMock([[], []]);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveCommitAsset(mockOwner, mockRepo, mockCommitSha, 'missing.html', req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();
    });

    it('should return 304 when ETag matches', async () => {
      setupDbMock([[mockAsset]]);
      const res = createMockResponse();
      const fileBuffer = Buffer.from('<html></html>');
      mockStorageAdapter.download.mockResolvedValue(fileBuffer);

      // Calculate the expected ETag
      const { createHash } = await import('crypto');
      const expectedEtag = `"${createHash('md5').update(fileBuffer).digest('hex')}"`;
      res.req.headers['if-none-match'] = expectedEtag;

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'index.html',
        createMockRequest(),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(304);
      expect(res.end).toHaveBeenCalled();
    });

    it('should return 404 HTML page when storage download fails', async () => {
      setupDbMock([[mockAsset]]);
      mockStorageAdapter.download.mockRejectedValue(new Error('Storage error'));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveCommitAsset(mockOwner, mockRepo, mockCommitSha, 'index.html', req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('serveAliasAsset', () => {
    const setupDbMock = (results: any[]) => {
      let callIndex = 0;
      mockDb.then.mockImplementation((resolve: any) => {
        const result = results[callIndex] || [];
        callIndex++;
        return resolve(result);
      });
    };

    it('should serve file with alias reference', async () => {
      setupDbMock([[mockAsset]]);
      const res = createMockResponse();

      await controller.serveAliasAsset(
        mockOwner,
        mockRepo,
        'main',
        'index.html',
        createMockRequest(),
        res,
      );

      expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith(mockRepository, 'main');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=0, must-revalidate',
      );
    });

    it('should return 404 HTML page when alias not found', async () => {
      mockDeploymentsService.resolveAlias.mockResolvedValue(null);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.serveAliasAsset(mockOwner, mockRepo, 'non-existent', 'index.html', req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('MIME type detection', () => {
    const setupDbMock = (results: any[]) => {
      let callIndex = 0;
      mockDb.then.mockImplementation((resolve: any) => {
        const result = results[callIndex] || [];
        callIndex++;
        return resolve(result);
      });
    };

    it('should detect CSS mime type', async () => {
      const cssAsset = {
        ...mockAsset,
        fileName: 'style.css',
        publicPath: 'style.css',
        mimeType: null,
      };
      setupDbMock([[cssAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'style.css',
        createMockRequest(),
        res,
      );

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/css');
    });

    it('should detect JavaScript mime type', async () => {
      const jsAsset = {
        ...mockAsset,
        fileName: 'app.js',
        publicPath: 'app.js',
        mimeType: null,
      };
      setupDbMock([[jsAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'app.js',
        createMockRequest(),
        res,
      );

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript');
    });

    it('should default to octet-stream for unknown types', async () => {
      const unknownAsset = {
        ...mockAsset,
        fileName: 'data.xyz',
        publicPath: 'data.xyz',
        mimeType: null,
      };
      setupDbMock([[unknownAsset]]);
      const res = createMockResponse();

      await controller.serveCommitAsset(
        mockOwner,
        mockRepo,
        mockCommitSha,
        'data.xyz',
        createMockRequest(),
        res,
      );

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    });
  });
});
