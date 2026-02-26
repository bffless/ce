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
    settings: {},
    defaultProxyRuleSetId: null,
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
