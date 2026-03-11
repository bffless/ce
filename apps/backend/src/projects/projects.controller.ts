import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { ProjectAISettingsService, AIProviderType } from './project-ai-settings.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ProjectPermissionGuard } from '../auth/guards/project-permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  RequireProjectRole,
  AllowPublicAccess,
} from '../auth/decorators/project-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateProjectDto, UpdateProjectDto, ProjectResponseDto } from './projects.dto';
import {
  AddAIProviderDto,
  SetDefaultProviderDto,
  AIStatusResponseDto,
  TestAIResponseDto,
  AIProvidersResponseDto,
  AIProviderEnum,
} from '../settings/dto/ai-settings.dto';

@ApiTags('projects')
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly aiSettingsService: ProjectAISettingsService,
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'List all projects for the current user' })
  @ApiResponse({ status: 200, description: 'List of projects', type: [ProjectResponseDto] })
  async listUserProjects(@CurrentUser('id') userId: string): Promise<ProjectResponseDto[]> {
    const projects = await this.projectsService.listUserProjects(userId);
    return projects.map((p) => this.toResponseDto(p));
  }

  // ==========================================================================
  // AI Settings Endpoints (Project-Level)
  // NOTE: These MUST be defined BEFORE :owner/:name to avoid route conflicts
  // ==========================================================================

  @Get(':id/ai')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Get AI providers configured for this project' })
  @ApiResponse({
    status: 200,
    description: 'AI configuration status',
    type: AIStatusResponseDto,
  })
  async getAIStatus(@Param('id') id: string): Promise<AIStatusResponseDto> {
    return this.aiSettingsService.getAIStatus(id);
  }

  @Post(':id/ai')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Add or update an AI provider for this project' })
  @ApiResponse({
    status: 200,
    description: 'Provider added/updated',
    type: AIStatusResponseDto,
  })
  async addAIProvider(
    @Param('id') id: string,
    @Body() dto: AddAIProviderDto,
  ): Promise<AIStatusResponseDto> {
    return this.aiSettingsService.addOrUpdateProvider(id, dto);
  }

  @Delete(':id/ai/:provider')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Remove an AI provider from this project' })
  @ApiResponse({
    status: 200,
    description: 'Provider removed',
    type: AIStatusResponseDto,
  })
  async removeAIProvider(
    @Param('id') id: string,
    @Param('provider') provider: AIProviderEnum,
  ): Promise<AIStatusResponseDto> {
    return this.aiSettingsService.removeProvider(id, provider);
  }

  @Post(':id/ai/default')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Set default AI provider for this project' })
  @ApiResponse({
    status: 200,
    description: 'Default provider set',
    type: AIStatusResponseDto,
  })
  async setDefaultAIProvider(
    @Param('id') id: string,
    @Body() dto: SetDefaultProviderDto,
  ): Promise<AIStatusResponseDto> {
    return this.aiSettingsService.setDefaultProvider(id, dto.provider);
  }

  @Post(':id/ai/test')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Test AI connection for this project' })
  @ApiResponse({ status: 200, description: 'AI test result', type: TestAIResponseDto })
  async testAI(
    @Param('id') id: string,
    @Query('provider') provider?: AIProviderEnum,
  ): Promise<TestAIResponseDto> {
    return this.aiSettingsService.testAIConnection(id, provider);
  }

  @Get(':id/ai/providers')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Get available AI providers with model suggestions' })
  @ApiResponse({
    status: 200,
    description: 'Available AI providers',
    type: AIProvidersResponseDto,
  })
  async getAIProviders(): Promise<AIProvidersResponseDto> {
    return {
      providers: this.aiSettingsService.getAvailableProviders(),
    };
  }

  // ==========================================================================
  // Project CRUD Endpoints
  // NOTE: :owner/:name must come AFTER specific routes like :id/ai
  // ==========================================================================

  @Get(':owner/:name')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('viewer')
  @AllowPublicAccess()
  @ApiOperation({ summary: 'Get project by owner and name' })
  @ApiResponse({ status: 200, description: 'Project found', type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectByOwnerName(
    @Param('owner') owner: string,
    @Param('name') name: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.getProjectByOwnerName(owner, name);
    return this.toResponseDto(project);
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('viewer')
  @AllowPublicAccess()
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiResponse({ status: 200, description: 'Project found', type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectById(@Param('id') id: string): Promise<ProjectResponseDto> {
    const project = await this.projectsService.getProjectById(id);
    return this.toResponseDto(project);
  }

  @Post()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created', type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Members cannot create projects' })
  async createProject(
    @Body() dto: CreateProjectDto,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.createProject({
      ...dto,
      createdBy: userId,
    });
    return this.toResponseDto(project);
  }

  @Patch(':id')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Update project settings' })
  @ApiResponse({ status: 200, description: 'Project updated', type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.updateProject(id, dto);
    return this.toResponseDto(project);
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard, ProjectPermissionGuard)
  @RequireProjectRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: 204, description: 'Project deleted' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async deleteProject(@Param('id') id: string): Promise<void> {
    await this.projectsService.deleteProject(id);
  }

  /**
   * Transform database model to DTO
   * Note: createdAt/updatedAt may be Date objects (from DB) or strings (from Redis cache)
   */
  private toResponseDto(project: any): ProjectResponseDto {
    return {
      ...project,
      settings: project.settings as Record<string, any> | null,
      createdAt:
        project.createdAt instanceof Date
          ? project.createdAt.toISOString()
          : project.createdAt,
      updatedAt:
        project.updatedAt instanceof Date
          ? project.updatedAt.toISOString()
          : project.updatedAt,
    };
  }
}
