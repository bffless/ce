import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ProjectPermissionGuard } from '../auth/guards/project-permission.guard';
import { RequireProjectRole } from '../auth/decorators/project-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ProjectInviteLinksService } from './project-invite-links.service';

@ApiTags('Project Invite Links')
@ApiBearerAuth()
@Controller('api/projects/:owner/:repo/invite-links')
@UseGuards(ApiKeyGuard, ProjectPermissionGuard)
export class ProjectInviteLinksController {
  constructor(
    private readonly inviteLinksService: ProjectInviteLinksService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'List invite links for a project' })
  async list(@Param('owner') owner: string, @Param('repo') repo: string) {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    return this.inviteLinksService.listByProject(project.id);
  }

  @Post()
  @RequireProjectRole('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an invite link for a project' })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      role?: string;
      label?: string;
      expiresAt?: string;
      maxUses?: number;
    },
  ) {
    const project = await this.projectsService.getProjectByOwnerName(owner, repo);

    const role = body.role || 'guest';
    const allowedRoles = ['guest', 'viewer', 'contributor', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new BadRequestException(`Role must be one of: ${allowedRoles.join(', ')}`);
    }

    return this.inviteLinksService.create(
      project.id,
      role,
      userId,
      body.label,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
      body.maxUses,
    );
  }

  @Patch(':id')
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Update an invite link' })
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      label?: string | null;
      isActive?: boolean;
      expiresAt?: string | null;
      maxUses?: number | null;
    },
  ) {
    const updates: any = {};
    if (body.label !== undefined) updates.label = body.label;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.expiresAt !== undefined) {
      updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }
    if (body.maxUses !== undefined) updates.maxUses = body.maxUses;

    return this.inviteLinksService.update(id, updates);
  }

  @Delete(':id')
  @RequireProjectRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an invite link' })
  async delete(@Param('id') id: string) {
    await this.inviteLinksService.delete(id);
  }
}
