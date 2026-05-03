import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ProjectPermissionGuard } from '../auth/guards/project-permission.guard';
import { RequireProjectRole } from '../auth/decorators/project-permission.decorator';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarIntegrationKeys } from './google-calendar.interface';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface OAuthStatePayload {
  projectId: string;
  integrationId: 'google-calendar';
  timestamp: number;
}

/**
 * REST API for the per-project Google Calendar integration OAuth flow.
 *
 * Routes are nested under /api/projects/:projectId/integrations/google-calendar
 * to match the existing IntegrationsService surface (Stripe / GitHub) and the
 * AI-plugin OAuth precedent (`/api/projects/:projectId/ai-plugins/...`).
 *
 * State tokens are AES-256-GCM with the platform `ENCRYPTION_KEY` and bind
 * `{projectId, integrationId, timestamp}` so a callback can't be substituted
 * across projects or replayed past expiry.
 */
@ApiTags('integrations')
@Controller('api/projects/:projectId/integrations/google-calendar')
@UseGuards(ApiKeyGuard, ProjectPermissionGuard)
@RequireProjectRole('admin')
export class GoogleCalendarIntegrationController {
  private readonly logger = new Logger(GoogleCalendarIntegrationController.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly googleCalendarOAuthService: GoogleCalendarOAuthService,
    configService: ConfigService,
  ) {
    const encryptionKey = configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  @Get('oauth/initiate')
  @ApiOperation({ summary: 'Initiate Google Calendar OAuth flow' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async initiateOAuth(
    @Param('projectId') projectId: string,
    @Query('redirectUri') redirectUri: string,
  ): Promise<{ authUrl: string }> {
    if (!redirectUri) {
      throw new BadRequestException('redirectUri is required');
    }

    const config = (await this.integrationsService.getActiveConfig(
      projectId,
      'google-calendar',
    )) as GoogleCalendarIntegrationKeys | null;
    if (!config?.clientId) {
      throw new BadRequestException(
        'Google OAuth Client ID not configured. Save clientId/clientSecret first.',
      );
    }

    const state = this.encryptState({
      projectId,
      integrationId: 'google-calendar',
      timestamp: Date.now(),
    });

    const authUrl = this.googleCalendarOAuthService.buildAuthorizationUrl(
      config.clientId,
      state,
      redirectUri,
    );
    return { authUrl };
  }

  @Post('oauth/callback')
  @ApiOperation({ summary: 'Complete Google Calendar OAuth flow with authorization code' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async completeOAuth(
    @Param('projectId') projectId: string,
    @Body() body: { code: string; state: string; redirectUri: string },
  ): Promise<{ success: boolean; connectedEmail: string }> {
    const { code, state, redirectUri } = body;
    if (!code || !state || !redirectUri) {
      throw new BadRequestException('code, state, and redirectUri are required');
    }

    let payload: OAuthStatePayload;
    try {
      payload = this.decryptState(state);
    } catch {
      throw new BadRequestException('Invalid OAuth state token');
    }

    if (payload.projectId !== projectId || payload.integrationId !== 'google-calendar') {
      throw new BadRequestException('OAuth state mismatch (project/integration)');
    }
    if (Date.now() - payload.timestamp > STATE_EXPIRY_MS) {
      throw new BadRequestException('OAuth state expired');
    }

    const result = await this.googleCalendarOAuthService.exchangeCodeForProject(
      projectId,
      undefined,
      code,
      redirectUri,
    );
    this.logger.log(
      `Google Calendar connected for project ${projectId}: ${result.connectedEmail}`,
    );
    return { success: true, connectedEmail: result.connectedEmail };
  }

  @Delete('oauth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect Google Calendar (revoke tokens, keep clientId/clientSecret)' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async disconnectOAuth(@Param('projectId') projectId: string): Promise<void> {
    const stored = await this.integrationsService.getStoredIntegration(
      projectId,
      'google-calendar',
    );
    if (!stored?.enabled) {
      throw new NotFoundException('Google Calendar integration is not configured');
    }

    const env = stored.activeEnvironment;
    const config = (await this.integrationsService.getActiveConfig(
      projectId,
      'google-calendar',
      env,
    )) as GoogleCalendarIntegrationKeys | null;

    if (config?.refreshToken) {
      await this.googleCalendarOAuthService.revokeToken(config.refreshToken);
    }

    // Keep clientId / clientSecret; clear OAuth state.
    await this.integrationsService.setConfig(projectId, 'google-calendar', env, {
      accessToken: '',
      refreshToken: '',
      tokenExpiry: 0,
      connectedEmail: '',
      availableCalendars: [],
    });
  }

  @Get('calendars')
  @ApiOperation({ summary: 'List sub-calendars on the connected Google account' })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  async listCalendars(
    @Param('projectId') projectId: string,
  ): Promise<{
    calendars: Array<{ id: string; summary: string; primary?: boolean; timeZone: string }>;
  }> {
    const calendars = await this.googleCalendarOAuthService.listCalendarsForProject(projectId);
    return { calendars };
  }

  // ===== State encryption =====

  private encryptState(payload: OAuthStatePayload): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptState(state: string): OAuthStatePayload {
    const [ivHex, authTagHex, encrypted] = state.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Malformed state token');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as OAuthStatePayload;
  }
}
