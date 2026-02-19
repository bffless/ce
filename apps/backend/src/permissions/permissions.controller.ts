import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ProjectPermissionGuard } from '../auth/guards/project-permission.guard';
import { RequireProjectRole } from '../auth/decorators/project-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentUserData } from '../auth';
import {
  GrantPermissionDto,
  GrantGroupPermissionDto,
  ProjectPermissionsResponseDto,
  UserPermissionResponseDto,
  GroupPermissionResponseDto,
} from './permissions.dto';

@ApiTags('Permissions')
@Controller('api/projects/:owner/:repo/permissions')
@UseGuards(SessionAuthGuard, ProjectPermissionGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @RequireProjectRole('viewer')
  @ApiOperation({ summary: 'Get all permissions for a project' })
  @ApiResponse({
    status: 200,
    description: 'Permissions retrieved successfully',
    type: ProjectPermissionsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - viewer+ role required' })
  async getProjectPermissions(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<ProjectPermissionsResponseDto> {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    const [userPermissions, groupPermissions] = await Promise.all([
      this.permissionsService.getProjectUserPermissions(project.id),
      this.permissionsService.getProjectGroupPermissions(project.id),
    ]);

    return {
      userPermissions: userPermissions as UserPermissionResponseDto[],
      groupPermissions: groupPermissions as GroupPermissionResponseDto[],
    };
  }

  @Post('users')
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Grant permission to a user' })
  @ApiResponse({
    status: 201,
    description: 'Permission granted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin+ role required' })
  async grantUserPermission(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() dto: GrantPermissionDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    // Look up user by email
    const targetUser = await this.usersService.findByEmail(dto.userEmail);
    if (!targetUser) {
      throw new BadRequestException(
        `User with email ${dto.userEmail} not found. They must be added to this workspace first.`,
      );
    }

    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    await this.permissionsService.grantPermission(project.id, targetUser.id, dto.role, user.id);
  }

  @Delete('users/:userId')
  @RequireProjectRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke permission from a user' })
  @ApiResponse({
    status: 204,
    description: 'Permission revoked successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin+ role required' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async revokeUserPermission(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('userId') userId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    await this.permissionsService.revokePermission(project.id, userId, user.id);
  }

  @Post('groups')
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Grant permission to a group' })
  @ApiResponse({
    status: 201,
    description: 'Permission granted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin+ role required' })
  async grantGroupPermission(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() dto: GrantGroupPermissionDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    await this.permissionsService.grantGroupPermission(project.id, dto.groupId, dto.role, user.id);
  }

  @Delete('groups/:groupId')
  @RequireProjectRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke permission from a group' })
  @ApiResponse({
    status: 204,
    description: 'Permission revoked successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin+ role required' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async revokeGroupPermission(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('groupId') groupId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    await this.permissionsService.revokeGroupPermission(project.id, groupId, user.id);
  }
}
