import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { ProjectPermissionGuard } from '../../auth/guards/project-permission.guard';
import { RequireProjectRole } from '../../auth/decorators/project-permission.decorator';
import { AIToolPluginService, PluginListItem } from './ai-tool-plugin.service';
import { GoogleOAuthService } from './google-oauth.service';

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
  constructor(
    private readonly pluginService: AIToolPluginService,
    private readonly oauthService: GoogleOAuthService,
  ) {}

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

  // ===== OAuth Endpoints =====

  @Get(':pluginId/oauth/initiate')
  @ApiOperation({ summary: 'Initiate OAuth flow for a plugin' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async initiateOAuth(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
    @Query('redirectUri') redirectUri: string,
  ): Promise<{ authUrl: string }> {
    return this.oauthService.getAuthorizationUrl(projectId, pluginId, redirectUri);
  }

  @Post(':pluginId/oauth/callback')
  @ApiOperation({ summary: 'Complete OAuth flow with authorization code' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async completeOAuth(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { code: string; state: string; redirectUri: string },
  ): Promise<{ success: boolean; connectedEmail: string }> {
    const result = await this.oauthService.exchangeCodeForTokens(
      projectId,
      pluginId,
      body.code,
      body.state,
      body.redirectUri,
    );
    return { success: true, ...result };
  }

  @Delete(':pluginId/oauth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect OAuth (revoke tokens, keep app credentials)' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiParam({ name: 'pluginId', description: 'Plugin identifier' })
  async disconnectOAuth(
    @Param('projectId') projectId: string,
    @Param('pluginId') pluginId: string,
  ): Promise<void> {
    const config = await this.pluginService.getDecryptedPluginConfig(projectId, pluginId);
    if (!config) return;

    // Revoke the refresh token
    if (config.refreshToken) {
      await this.oauthService.revokeToken(config.refreshToken as string);
    }

    // Clear OAuth fields but keep clientId/clientSecret
    const updatedConfig = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    };
    await this.pluginService.updatePluginConfig(projectId, pluginId, updatedConfig);
  }

  // ===== Calendars List Endpoint =====

  @Get('google-calendar/calendars')
  @ApiOperation({ summary: 'List calendars from connected Google account' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async listCalendars(
    @Param('projectId') projectId: string,
  ): Promise<{ calendars: Array<{ id: string; summary: string; primary: boolean }> }> {
    const calendars = await this.oauthService.listCalendars(projectId, 'google-calendar');
    return { calendars };
  }
}
