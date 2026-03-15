import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { ProjectPermissionGuard } from '../../auth/guards/project-permission.guard';
import { RequireProjectRole } from '../../auth/decorators/project-permission.decorator';
import { AIToolPluginService, PluginListItem } from './ai-tool-plugin.service';

/**
 * REST API for managing AI tool plugins per project.
 *
 * Routes are nested under /api/projects/:projectId/ai-plugins
 * to match the existing project settings pattern.
 */
@ApiTags('AI Plugins')
@Controller('api/projects/:projectId/ai-plugins')
@UseGuards(SessionAuthGuard, ProjectPermissionGuard)
@RequireProjectRole('admin')
export class AIPluginsController {
  constructor(private readonly pluginService: AIToolPluginService) {}

  @Get()
  @ApiOperation({ summary: 'List all plugins with enabled status for this project' })
  @ApiResponse({ status: 200, description: 'List of plugins' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async listPlugins(@Param('projectId') projectId: string): Promise<PluginListItem[]> {
    return this.pluginService.getAvailablePlugins(projectId);
  }

  @Post(':pluginId')
  @ApiOperation({ summary: 'Enable a plugin for this project' })
  @ApiResponse({ status: 200, description: 'Plugin enabled' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async enablePlugin(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { config?: Record<string, unknown> },
  ): Promise<PluginListItem> {
    return this.pluginService.enablePlugin(projectId, pluginId, body.config);
  }

  @Put(':pluginId')
  @ApiOperation({ summary: 'Update plugin configuration' })
  @ApiResponse({ status: 200, description: 'Plugin config updated' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async updatePluginConfig(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { config: Record<string, unknown> },
  ): Promise<PluginListItem> {
    return this.pluginService.updatePluginConfig(projectId, pluginId, body.config);
  }

  @Delete(':pluginId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable a plugin for this project' })
  @ApiResponse({ status: 204, description: 'Plugin disabled' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async disablePlugin(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
  ): Promise<void> {
    return this.pluginService.disablePlugin(projectId, pluginId);
  }
}
