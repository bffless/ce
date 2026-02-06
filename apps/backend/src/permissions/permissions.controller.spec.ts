import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectRole, ProjectGroupRole } from './permissions.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ProjectPermissionGuard } from '../auth/guards/project-permission.guard';

describe('PermissionsController', () => {
  let controller: PermissionsController;
  let service: PermissionsService;
  let projectsService: any;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'user',
  };

  const mockOwner = 'test-owner';
  const mockRepo = 'test-repo';
  const mockProjectId = 'project-456';
  const mockUserId = 'user-789';
  const mockGroupId = 'group-101';

  const mockProject = {
    id: mockProjectId,
    owner: mockOwner,
    name: mockRepo,
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPermissionsService = {
    hasProjectAccess: jest.fn(),
    getProjectUserPermissions: jest.fn(),
    getProjectGroupPermissions: jest.fn(),
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
    grantGroupPermission: jest.fn(),
    revokeGroupPermission: jest.fn(),
  };

  const mockProjectsService = {
    getProjectByOwnerName: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PermissionsController>(PermissionsController);
    service = module.get<PermissionsService>(PermissionsService);
    projectsService = module.get<ProjectsService>(ProjectsService);

    // Reset all mocks
    jest.clearAllMocks();

    // Default mock for getProjectByOwnerName
    mockProjectsService.getProjectByOwnerName.mockResolvedValue(mockProject);
  });

  describe('getProjectPermissions', () => {
    it('should return user and group permissions', async () => {
      const mockUserPerms = [
        {
          id: '1',
          projectId: mockProjectId,
          userId: 'user-1',
          role: 'admin',
          grantedBy: null,
          grantedAt: new Date(),
        },
        {
          id: '2',
          projectId: mockProjectId,
          userId: 'user-2',
          role: 'viewer',
          grantedBy: null,
          grantedAt: new Date(),
        },
      ];

      const mockGroupPerms = [
        {
          id: '3',
          projectId: mockProjectId,
          groupId: 'group-1',
          role: 'contributor',
          grantedBy: null,
          grantedAt: new Date(),
        },
      ];

      mockPermissionsService.getProjectUserPermissions.mockResolvedValue(mockUserPerms);
      mockPermissionsService.getProjectGroupPermissions.mockResolvedValue(mockGroupPerms);

      const result = await controller.getProjectPermissions(mockOwner, mockRepo);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(result.userPermissions).toEqual(mockUserPerms);
      expect(result.groupPermissions).toEqual(mockGroupPerms);
    });
  });

  describe('grantUserPermission', () => {
    it('should grant permission to a user', async () => {
      const dto = {
        userId: mockUserId,
        role: ProjectRole.CONTRIBUTOR,
      };

      mockPermissionsService.grantPermission.mockResolvedValue(undefined);

      await controller.grantUserPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockUserId,
        ProjectRole.CONTRIBUTOR,
        mockUser.id,
      );
    });

    it('should allow granting admin role', async () => {
      const dto = {
        userId: mockUserId,
        role: ProjectRole.ADMIN,
      };

      mockPermissionsService.grantPermission.mockResolvedValue(undefined);

      await controller.grantUserPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockUserId,
        ProjectRole.ADMIN,
        mockUser.id,
      );
    });

    it('should allow granting viewer role', async () => {
      const dto = {
        userId: mockUserId,
        role: ProjectRole.VIEWER,
      };

      mockPermissionsService.grantPermission.mockResolvedValue(undefined);

      await controller.grantUserPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockUserId,
        ProjectRole.VIEWER,
        mockUser.id,
      );
    });
  });

  describe('revokeUserPermission', () => {
    it('should revoke permission from a user', async () => {
      mockPermissionsService.revokePermission.mockResolvedValue(undefined);

      await controller.revokeUserPermission(mockOwner, mockRepo, mockUserId, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.revokePermission).toHaveBeenCalledWith(mockProjectId, mockUserId, mockUser.id);
    });
  });

  describe('grantGroupPermission', () => {
    it('should grant permission to a group', async () => {
      const dto = {
        groupId: mockGroupId,
        role: ProjectGroupRole.CONTRIBUTOR,
      };

      mockPermissionsService.grantGroupPermission.mockResolvedValue(undefined);

      await controller.grantGroupPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantGroupPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockGroupId,
        ProjectGroupRole.CONTRIBUTOR,
        mockUser.id,
      );
    });

    it('should allow granting admin role to group', async () => {
      const dto = {
        groupId: mockGroupId,
        role: ProjectGroupRole.ADMIN,
      };

      mockPermissionsService.grantGroupPermission.mockResolvedValue(undefined);

      await controller.grantGroupPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantGroupPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockGroupId,
        ProjectGroupRole.ADMIN,
        mockUser.id,
      );
    });

    it('should allow granting viewer role to group', async () => {
      const dto = {
        groupId: mockGroupId,
        role: ProjectGroupRole.VIEWER,
      };

      mockPermissionsService.grantGroupPermission.mockResolvedValue(undefined);

      await controller.grantGroupPermission(mockOwner, mockRepo, dto, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.grantGroupPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockGroupId,
        ProjectGroupRole.VIEWER,
        mockUser.id,
      );
    });
  });

  describe('revokeGroupPermission', () => {
    it('should revoke permission from a group', async () => {
      mockPermissionsService.revokeGroupPermission.mockResolvedValue(undefined);

      await controller.revokeGroupPermission(mockOwner, mockRepo, mockGroupId, mockUser as any);

      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith(mockOwner, mockRepo);
      expect(service.revokeGroupPermission).toHaveBeenCalledWith(
        mockProjectId,
        mockGroupId,
        mockUser.id,
      );
    });
  });
});
