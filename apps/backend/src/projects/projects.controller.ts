import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { ProjectAISettingsService, AIProviderType, AIServiceType } from './project-ai-settings.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
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
import { SkillsService, SkillSummary } from '../pipelines/skills.service';
import { AIToolPluginService, PluginListItem } from '../pipelines/ai-plugins/ai-tool-plugin.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { IntegrationsService, IntegrationInfo } from '../integrations/integrations.service';

@ApiTags('projects')
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly aiSettingsService: ProjectAISettingsService,
    private readonly skillsService: SkillsService,
    private readonly pluginService: AIToolPluginService,
    @Inject(forwardRef(() => DeploymentsService))
    private readonly deploymentsService: DeploymentsService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  @Get()
  @UseGuards(ApiKeyGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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

  @Get(':id/ai/skills')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('contributor')
  @ApiOperation({ summary: 'List available AI skills for the project deployment' })
  @ApiResponse({
    status: 200,
    description: 'List of available skills',
  })
  async listSkills(
    @Param('id') projectId: string,
    @Query('commitSha') commitSha?: string,
    @CurrentUser('id') userId?: string,
  ): Promise<{ skills: SkillSummary[] }> {
    const project = await this.projectsService.getProjectById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Resolve commitSha: use provided, or try to get from production alias
    let sha = commitSha;
    if (!sha) {
      try {
        const alias = await this.deploymentsService.getAlias(
          projectId,
          'production',
          userId || 'system',
          'admin',
        );
        sha = alias?.commitSha;
      } catch {
        // No production alias - that's OK
      }
    }

    if (!sha) {
      return { skills: [] };
    }

    const skillsPath = await this.aiSettingsService.getSkillsPath(projectId);
    const skills = await this.skillsService.listSkills(
      project.owner,
      project.name,
      sha,
      skillsPath,
    );

    return { skills };
  }

  @Get(':id/ai/skills-path')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Get the skills path for a project' })
  @ApiResponse({ status: 200, description: 'Skills path configuration' })
  async getSkillsPath(
    @Param('id') projectId: string,
  ): Promise<{ skillsPath: string }> {
    const skillsPath = await this.aiSettingsService.getSkillsPath(projectId);
    return { skillsPath };
  }

  @Put(':id/ai/skills-path')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Set the skills path for a project' })
  @ApiResponse({ status: 200, description: 'Skills path updated' })
  async setSkillsPath(
    @Param('id') projectId: string,
    @Body() body: { skillsPath: string },
  ): Promise<{ skillsPath: string }> {
    await this.aiSettingsService.setSkillsPath(projectId, body.skillsPath);
    return { skillsPath: body.skillsPath };
  }

  // ==========================================================================
  // AI Services Endpoints (Replicate, etc.)
  // NOTE: These MUST be defined BEFORE :owner/:name to avoid route conflicts
  // ==========================================================================

  @Get(':id/ai-services')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Get AI services configured for this project' })
  @ApiResponse({ status: 200, description: 'AI services status' })
  async getAIServicesStatus(@Param('id') id: string) {
    return this.aiSettingsService.getAIServicesStatus(id);
  }

  @Post(':id/ai-services')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Add or update an AI service for this project' })
  @ApiResponse({ status: 200, description: 'Service added/updated' })
  async addOrUpdateAIService(
    @Param('id') id: string,
    @Body() body: { service: AIServiceType; apiToken: string },
  ) {
    return this.aiSettingsService.addOrUpdateService(id, body.service, body.apiToken);
  }

  @Delete(':id/ai-services/:service')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Remove an AI service from this project' })
  @ApiResponse({ status: 200, description: 'Service removed' })
  async removeAIService(
    @Param('id') id: string,
    @Param('service') service: AIServiceType,
  ) {
    return this.aiSettingsService.removeService(id, service);
  }

  @Post(':id/ai-services/test')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Test AI service connection' })
  @ApiResponse({ status: 200, description: 'Test result' })
  async testAIService(
    @Param('id') _id: string,
    @Body() body: { service: AIServiceType; apiToken: string },
  ) {
    if (body.service === 'replicate') {
      return this.aiSettingsService.testReplicateConnection(body.apiToken);
    }
    return { success: false, message: `Unknown service: ${body.service}` };
  }

  // ==========================================================================
  // AI Plugin Endpoints (Project-Level)
  // NOTE: These MUST be defined BEFORE :owner/:name to avoid route conflicts
  // ==========================================================================

  @Get(':id/ai-plugins')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'List all plugins with enabled status for this project' })
  @ApiResponse({ status: 200, description: 'List of plugins' })
  async listPlugins(@Param('id') id: string): Promise<PluginListItem[]> {
    return this.pluginService.getAvailablePlugins(id);
  }

  @Post(':id/ai-plugins/:pluginId')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Enable a plugin for this project' })
  @ApiResponse({ status: 200, description: 'Plugin enabled' })
  async enablePlugin(
    @Param('id') id: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { config?: Record<string, unknown> },
  ): Promise<PluginListItem> {
    return this.pluginService.enablePlugin(id, pluginId, body.config);
  }

  @Put(':id/ai-plugins/:pluginId')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Update plugin configuration' })
  @ApiResponse({ status: 200, description: 'Plugin config updated' })
  async updatePluginConfig(
    @Param('id') id: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { config: Record<string, unknown> },
  ): Promise<PluginListItem> {
    return this.pluginService.updatePluginConfig(id, pluginId, body.config);
  }

  @Delete(':id/ai-plugins/:pluginId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Disable a plugin for this project' })
  @ApiResponse({ status: 204, description: 'Plugin disabled' })
  async disablePlugin(
    @Param('id') id: string,
    @Param('pluginId') pluginId: string,
  ): Promise<void> {
    return this.pluginService.disablePlugin(id, pluginId);
  }

  // ==========================================================================
  // Integrations Endpoints (Project-Level)
  // NOTE: These MUST be defined BEFORE :owner/:name to avoid route conflicts
  // ==========================================================================

  @Get(':id/integrations')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'List all integrations for this project' })
  async listIntegrations(@Param('id') id: string): Promise<IntegrationInfo[]> {
    return this.integrationsService.listIntegrations(id);
  }

  @Get(':id/integrations/:integrationId')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Get integration details' })
  async getIntegration(
    @Param('id') id: string,
    @Param('integrationId') integrationId: string,
  ): Promise<IntegrationInfo> {
    return this.integrationsService.getIntegration(id, integrationId);
  }

  @Put(':id/integrations/:integrationId/:environment')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Set integration config for an environment' })
  async setIntegrationConfig(
    @Param('id') id: string,
    @Param('integrationId') integrationId: string,
    @Param('environment') environment: 'sandbox' | 'production',
    @Body() body: { config: Record<string, unknown> },
  ): Promise<IntegrationInfo> {
    return this.integrationsService.setConfig(id, integrationId, environment, body.config);
  }

  @Patch(':id/integrations/:integrationId/environment')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Switch active environment' })
  async switchIntegrationEnvironment(
    @Param('id') id: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { environment: 'sandbox' | 'production' },
  ): Promise<IntegrationInfo> {
    return this.integrationsService.switchEnvironment(id, integrationId, body.environment);
  }

  @Delete(':id/integrations/:integrationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Delete an integration' })
  async deleteIntegration(
    @Param('id') id: string,
    @Param('integrationId') integrationId: string,
  ): Promise<void> {
    return this.integrationsService.deleteIntegration(id, integrationId);
  }

  @Post(':id/integrations/:integrationId/test')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
  @RequireProjectRole('admin')
  @ApiOperation({ summary: 'Test integration connection' })
  async testIntegrationConnection(
    @Param('id') id: string,
    @Param('integrationId') integrationId: string,
    @Body() body: { environment?: 'sandbox' | 'production' },
  ): Promise<{ success: boolean; error?: string }> {
    return this.integrationsService.testConnection(id, integrationId, body.environment);
  }

  // ==========================================================================
  // Project CRUD Endpoints
  // NOTE: :owner/:name must come AFTER specific routes like :id/ai
  // ==========================================================================

  @Get(':owner/:name')
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, RolesGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
  @UseGuards(ApiKeyGuard, ProjectPermissionGuard)
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
