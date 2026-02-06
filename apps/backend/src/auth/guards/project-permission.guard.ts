import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../../permissions/permissions.service';
import { ProjectsService } from '../../projects/projects.service';
import { Project } from '../../db/schema';
import {
  PROJECT_ROLE_KEY,
  ALLOW_PUBLIC_ACCESS_KEY,
} from '../decorators/project-permission.decorator';

/**
 * Guard that enforces project-level permissions
 * - Checks if user has required role on the project
 * - Allows public access for read-only operations if project is public
 * - Supports both direct user permissions and group-based permissions
 *
 * Use with @RequireProjectRole() and optionally @AllowPublicAccess() decorators
 */
@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
    private projectsService: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const requiredRole = this.reflector.get<string>(PROJECT_ROLE_KEY, context.getHandler());
    const allowPublic = this.reflector.get<boolean>(ALLOW_PUBLIC_ACCESS_KEY, context.getHandler());

    // If no role requirement specified, allow access
    if (!requiredRole) {
      return true;
    }

    // Extract project identifier from params
    const { owner, repo, name, projectId, id } = request.params;
    let project: Project;

    try {
      if (projectId || id) {
        // Direct project ID lookup (supports both :projectId and :id param names)
        project = await this.projectsService.getProjectById(projectId || id);
      } else if (owner && (repo || name)) {
        // Lookup by owner/repo or owner/name
        const repoName = repo || name;
        project = await this.projectsService.getProjectByOwnerName(owner, repoName);
      } else {
        throw new BadRequestException('Project identifier not found in request');
      }
    } catch (error) {
      // If project not found, throw appropriate error
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Project not found');
    }

    // If project is public and public access is allowed (read-only), skip auth check
    if (project.isPublic && allowPublic) {
      // Attach project to request for use in controller
      request.project = project;
      request.userRole = null; // No authenticated user
      return true;
    }

    // Get user from request (set by ApiKeyGuard or SessionAuthGuard)
    const user = request.user;
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if user has required role on the project
    const userRole = await this.permissionsService.getUserProjectRole(user.id, project.id);

    if (!userRole) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Check if role is sufficient
    const roleHierarchy: Record<string, number> = {
      owner: 4,
      admin: 3,
      contributor: 2,
      viewer: 1,
    };

    const requiredLevel = roleHierarchy[requiredRole] || 0;
    const userLevel = roleHierarchy[userRole] || 0;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(`Requires ${requiredRole} role or higher`);
    }

    // Attach project and user role to request for use in controller
    request.project = project;
    request.userRole = userRole;

    return true;
  }
}
