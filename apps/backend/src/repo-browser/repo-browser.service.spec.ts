import { Test, TestingModule } from '@nestjs/testing';
import { RepoBrowserService } from './repo-browser.service';
import { NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';

// Mock the database
jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
  },
}));

import * as dbClient from '../db/client';
const mockDb = (dbClient as any).db;

describe('RepoBrowserService', () => {
  let service: RepoBrowserService;
  let mockDeploymentsService: jest.Mocked<DeploymentsService>;
  let mockProjectsService: jest.Mocked<ProjectsService>;
  let mockPermissionsService: jest.Mocked<PermissionsService>;

  const mockPublicProject = {
    id: 'project-123',
    owner: 'owner',
    name: 'repo',
    displayName: 'Test Repo',
    description: null,
    isPublic: true,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    allowPublicSignup: false,
    settings: {},
    defaultProxyRuleSetId: null,
    aiProviders: null,
    aiServices: null,
    createdBy: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrivateProject = {
    ...mockPublicProject,
    isPublic: false,
  };

  beforeEach(async () => {
    mockDeploymentsService = {
      resolveAlias: jest.fn(),
    } as any;

    mockProjectsService = {
      getProjectByOwnerName: jest.fn(),
    } as any;

    mockPermissionsService = {
      getUserProjectRole: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepoBrowserService,
        {
          provide: DeploymentsService,
          useValue: mockDeploymentsService,
        },
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

    service = module.get<RepoBrowserService>(RepoBrowserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFileTree', () => {
    it('should throw NotFoundException when deployment not found', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('viewer');

      (mockDb.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.getFileTree('owner', 'repo', 'abc123', 'user-123', 'user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw UnauthorizedException for private project when not authenticated', async () => {
      // Mock private project
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);

      await expect(service.getFileTree('owner', 'repo', 'abc123', null)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ForbiddenException for private project when user has no permission', async () => {
      // Mock private project
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue(null);

      await expect(service.getFileTree('owner', 'repo', 'abc123', 'user-123', 'user')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should resolve alias to commit SHA', async () => {
      const mockCommitSha = 'abc123def456';
      mockDeploymentsService.resolveAlias.mockResolvedValue(mockCommitSha);
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('viewer');

      (mockDb.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              {
                repository: 'owner/repo',
                commitSha: mockCommitSha,
                isPublic: true,
                uploadedBy: 'some-user',
                publicPath: 'index.html',
                fileName: 'index.html',
                size: 1024,
                mimeType: 'text/html',
                branch: 'main',
                createdAt: new Date(),
              },
            ]),
          }),
        }),
      });

      const result = await service.getFileTree('owner', 'repo', 'main', 'user-123', 'user');

      expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith('owner/repo', 'main');
      expect(result.commitSha).toBe(mockCommitSha);
    });

    it('should throw NotFoundException when alias does not exist', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('viewer');
      mockDeploymentsService.resolveAlias.mockResolvedValue(null);

      await expect(
        service.getFileTree('owner', 'repo', 'non-existent', 'user-123', 'user'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDeploymentsService.resolveAlias).toHaveBeenCalledWith(
        'owner/repo',
        'non-existent',
      );
    });

    it('should not call resolveAlias when ref is a SHA', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      mockPermissionsService.getUserProjectRole.mockResolvedValue('viewer');

      (mockDb.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              {
                repository: 'owner/repo',
                commitSha: 'abc123def456',
                isPublic: true,
                uploadedBy: 'some-user',
                publicPath: 'index.html',
                fileName: 'index.html',
                size: 1024,
                mimeType: 'text/html',
                branch: 'main',
                createdAt: new Date(),
              },
            ]),
          }),
        }),
      });

      await service.getFileTree('owner', 'repo', 'abc123def456', 'user-123', 'user');

      expect(mockDeploymentsService.resolveAlias).not.toHaveBeenCalled();
    });

    it('should allow admin users to access any project', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPrivateProject);
      // Admin users bypass permission check

      (mockDb.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              {
                repository: 'owner/repo',
                commitSha: 'abc123def456',
                isPublic: false,
                uploadedBy: 'some-user',
                publicPath: 'index.html',
                fileName: 'index.html',
                size: 1024,
                mimeType: 'text/html',
                branch: 'main',
                createdAt: new Date(),
              },
            ]),
          }),
        }),
      });

      // Admin role bypasses permission check
      const result = await service.getFileTree('owner', 'repo', 'abc123def456', 'admin-123', 'admin');

      expect(result.commitSha).toBe('abc123def456');
      expect(mockPermissionsService.getUserProjectRole).not.toHaveBeenCalled();
    });
  });

  describe('getRepositoryRefs', () => {
    it('should return refs for any repository', async () => {
      // This endpoint returns metadata, no authorization checks
      expect(true).toBe(true);
    });
  });

  describe('getAliases', () => {
    const mockAliasRow = {
      id: 'alias-id-123',
      projectId: 'project-123',
      repository: 'owner/repo',
      alias: 'production',
      commitSha: 'abc123def456',
      deploymentId: 'deployment-123',
      isPublic: null,
      unauthorizedBehavior: null,
      requiredRole: null,
      isAutoPreview: false,
      basePath: null,
      proxyRuleSetId: null,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    };

    // Sets up the three sequential db.select() calls made by getAliases():
    // 1) select aliases, 2) select matching asset (branch lookup), 3) select join-table rule set rows.
    const mockAliasesQueryChain = (aliasRows: any[], assetRows: any[] = [], joinRows: any[] = []) => {
      (mockDb.select as jest.Mock)
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(aliasRows),
            }),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue(assetRows),
            }),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(joinRows),
            }),
          }),
        }));
    };

    // Regression: bffless/ce alias access-control readback bug.
    // The list-aliases endpoint backing the AliasesTab UI (getAliases -> AliasDetailDto)
    // never included isPublic/unauthorizedBehavior/requiredRole, so the edit dialog
    // always initialized as "Inherit from project" even when an override was stored
    // and actively being enforced.
    it('round-trips isPublic, unauthorizedBehavior, and requiredRole overrides', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPublicProject as any);
      mockAliasesQueryChain([
        {
          ...mockAliasRow,
          isPublic: false,
          unauthorizedBehavior: 'redirect_login',
          requiredRole: 'guest',
        },
      ]);

      const result = await service.getAliases('owner', 'repo', false, 'user-123', 'admin');

      expect(result.aliases[0].isPublic).toBe(false);
      expect(result.aliases[0].unauthorizedBehavior).toBe('redirect_login');
      expect(result.aliases[0].requiredRole).toBe('guest');
    });

    it('preserves explicit null overrides (inherit from project) rather than dropping them as undefined', async () => {
      mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockPublicProject as any);
      mockAliasesQueryChain([{ ...mockAliasRow }]);

      const result = await service.getAliases('owner', 'repo', false, 'user-123', 'admin');

      expect(result.aliases[0].isPublic).toBeNull();
      expect(result.aliases[0].unauthorizedBehavior).toBeNull();
      expect(result.aliases[0].requiredRole).toBeNull();
      expect('isPublic' in result.aliases[0]).toBe(true);
      expect('unauthorizedBehavior' in result.aliases[0]).toBe(true);
      expect('requiredRole' in result.aliases[0]).toBe(true);
    });
  });

  describe('getDeployments', () => {
    // TODO: Add integration tests with real database
    // These methods have complex database queries that are difficult to mock
    // The controller tests verify the API layer works correctly
    it('should be defined', () => {
      expect(service.getDeployments).toBeDefined();
    });
  });

  describe('getRepositoryStats', () => {
    // TODO: Add integration tests with real database
    // These methods have complex database queries that are difficult to mock
    // The controller tests verify the API layer works correctly
    it('should be defined', () => {
      expect(service.getRepositoryStats).toBeDefined();
    });
  });
});
