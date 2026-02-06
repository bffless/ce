import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectPermissionGuard } from './project-permission.guard';
import { PermissionsService } from '../../permissions/permissions.service';
import { ProjectsService } from '../../projects/projects.service';
import {
  PROJECT_ROLE_KEY,
  ALLOW_PUBLIC_ACCESS_KEY,
} from '../decorators/project-permission.decorator';

describe('ProjectPermissionGuard', () => {
  let guard: ProjectPermissionGuard;
  let reflector: Reflector;
  let permissionsService: PermissionsService;
  let projectsService: ProjectsService;

  const mockProject = {
    id: 'project-123',
    owner: 'test-owner',
    name: 'test-repo',
    displayName: 'Test Repo',
    description: null,
    isPublic: false,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
    settings: {},
    defaultProxyRuleSetId: null,
    createdBy: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectPermissionGuard,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getUserProjectRole: jest.fn(),
          },
        },
        {
          provide: ProjectsService,
          useValue: {
            getProjectById: jest.fn(),
            getProjectByOwnerName: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<ProjectPermissionGuard>(ProjectPermissionGuard);
    reflector = module.get<Reflector>(Reflector);
    permissionsService = module.get<PermissionsService>(PermissionsService);
    projectsService = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    let mockExecutionContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        user: { id: 'user-123' },
        params: { owner: 'test-owner', repo: 'test-repo' },
      };

      mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;
    });

    it('should allow access if no role requirement specified', async () => {
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should allow access for public project with public access allowed (viewer role)', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        if (key === ALLOW_PUBLIC_ACCESS_KEY) return true;
        return undefined;
      });

      const publicProject = { ...mockProject, isPublic: true };
      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(publicProject);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.project).toEqual(publicProject);
      expect(mockRequest.userRole).toBeNull();
    });

    it('should require authentication for private project even with public access allowed', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        if (key === ALLOW_PUBLIC_ACCESS_KEY) return true;
        return undefined;
      });

      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.project).toEqual(mockProject);
      expect(mockRequest.userRole).toBe('viewer');
    });

    it('should allow access if user has exact required role', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'contributor';
        return undefined;
      });

      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('contributor');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.project).toEqual(mockProject);
      expect(mockRequest.userRole).toBe('contributor');
    });

    it('should allow access if user has higher role than required', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('owner');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should deny access if user has lower role than required', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'admin';
        return undefined;
      });

      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Requires admin role or higher'),
      );
    });

    it('should deny access if user has no project access', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('You do not have access to this project'),
      );
    });

    it('should deny access if user is not authenticated', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      mockRequest.user = null;
      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Authentication required'),
      );
    });

    it('should lookup project by projectId param if provided', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      mockRequest.params = { projectId: 'project-123' };
      jest.spyOn(projectsService, 'getProjectById').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(projectsService.getProjectById).toHaveBeenCalledWith('project-123');
    });

    it('should lookup project by id param if provided (alternative to projectId)', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      mockRequest.params = { id: 'project-456' };
      jest.spyOn(projectsService, 'getProjectById').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(projectsService.getProjectById).toHaveBeenCalledWith('project-456');
    });

    it('should lookup project by owner/repo params if projectId not provided', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      mockRequest.params = { owner: 'test-owner', repo: 'test-repo' };
      jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(projectsService.getProjectByOwnerName).toHaveBeenCalledWith('test-owner', 'test-repo');
    });

    it('should throw BadRequestException if no project identifier in params', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      mockRequest.params = {};

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Project identifier not found in request'),
      );
    });

    it('should throw BadRequestException if project not found', async () => {
      jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
        if (key === PROJECT_ROLE_KEY) return 'viewer';
        return undefined;
      });

      jest
        .spyOn(projectsService, 'getProjectByOwnerName')
        .mockRejectedValue(new Error('Project not found'));

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new BadRequestException('Project not found'),
      );
    });

    describe('role hierarchy', () => {
      beforeEach(() => {
        jest.spyOn(projectsService, 'getProjectByOwnerName').mockResolvedValue(mockProject);
      });

      it('should allow owner for contributor requirement', async () => {
        jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
          if (key === PROJECT_ROLE_KEY) return 'contributor';
          return undefined;
        });

        jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('owner');

        const result = await guard.canActivate(mockExecutionContext);
        expect(result).toBe(true);
      });

      it('should allow admin for contributor requirement', async () => {
        jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
          if (key === PROJECT_ROLE_KEY) return 'contributor';
          return undefined;
        });

        jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('admin');

        const result = await guard.canActivate(mockExecutionContext);
        expect(result).toBe(true);
      });

      it('should deny contributor for admin requirement', async () => {
        jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
          if (key === PROJECT_ROLE_KEY) return 'admin';
          return undefined;
        });

        jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('contributor');

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(ForbiddenException);
      });

      it('should deny viewer for contributor requirement', async () => {
        jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
          if (key === PROJECT_ROLE_KEY) return 'contributor';
          return undefined;
        });

        jest.spyOn(permissionsService, 'getUserProjectRole').mockResolvedValue('viewer');

        await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(ForbiddenException);
      });
    });
  });
});
