import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AIToolPluginService } from './ai-tool-plugin.service';
import { GoogleCalendarOAuthService } from '../../integrations/google-calendar-oauth.service';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * AI-chat Google Calendar OAuth.
 *
 * The HTTP plumbing (auth URL build, code exchange, refresh, calendar list,
 * revoke) is delegated to `GoogleCalendarOAuthService`. What stays here:
 *   - state-token encryption / replay protection bound to this AI plugin
 *   - storage in `settings.aiPlugins['google-calendar']` via `AIToolPluginService`
 *
 * The new scheduling integration uses `settings.integrations['google-calendar']`
 * instead. Both store per-project clientId/clientSecret + tokens; they share the
 * same OAuth client model but live in different `settings` namespaces so the
 * AI-chat path keeps working without migration.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private readonly pluginService: AIToolPluginService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => GoogleCalendarOAuthService))
    private readonly googleCalendarOAuthService: GoogleCalendarOAuthService,
  ) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  /**
   * Build the Google OAuth2 authorization URL.
   * Reads clientId from the stored plugin config.
   */
  async getAuthorizationUrl(
    projectId: string,
    pluginId: string,
    redirectUri: string,
  ): Promise<{ authUrl: string }> {
    const config = await this.pluginService.getDecryptedPluginConfig(projectId, pluginId);
    if (!config?.clientId) {
      throw new Error('Google OAuth Client ID not configured');
    }

    const state = this.encryptState({
      projectId,
      pluginId,
      timestamp: Date.now(),
    });

    const authUrl = this.googleCalendarOAuthService.buildAuthorizationUrl(
      config.clientId as string,
      state,
      redirectUri,
    );

    return { authUrl };
  }

  /**
   * Exchange authorization code for tokens and store them.
   */
  async exchangeCodeForTokens(
    projectId: string,
    pluginId: string,
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ connectedEmail: string }> {
    const stateData = this.decryptState(state);
    if (stateData.projectId !== projectId || stateData.pluginId !== pluginId) {
      throw new Error('Invalid OAuth state: project/plugin mismatch');
    }
    if (Date.now() - stateData.timestamp > STATE_EXPIRY_MS) {
      throw new Error('OAuth state expired');
    }

    const config = await this.pluginService.getDecryptedPluginConfig(projectId, pluginId);
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }

    const tokens = await this.googleCalendarOAuthService.exchangeCodeForCredentials(
      config.clientId as string,
      config.clientSecret as string,
      code,
      redirectUri,
    );

    await this.pluginService.updatePluginConfig(projectId, pluginId, {
      ...config,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      connectedEmail: tokens.connectedEmail,
    });
    this.logger.log(`Google OAuth connected for project ${projectId}: ${tokens.connectedEmail}`);

    return { connectedEmail: tokens.connectedEmail };
  }

  /**
   * Refresh an expired access token. Returns the raw shape the AI plugin
   * already expects (`expiresIn` seconds rather than absolute expiry).
   */
  async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const refreshed = await this.googleCalendarOAuthService.refreshAccessTokenForCredentials(
      clientId,
      clientSecret,
      refreshToken,
    );
    return {
      accessToken: refreshed.accessToken,
      expiresIn: Math.max(0, Math.floor((refreshed.tokenExpiry - Date.now()) / 1000)),
    };
  }

  /**
   * Revoke a refresh token (best-effort).
   */
  async revokeToken(refreshToken: string): Promise<void> {
    await this.googleCalendarOAuthService.revokeToken(refreshToken);
  }

  /**
   * List calendars from the connected Google account.
   */
  async listCalendars(
    projectId: string,
    pluginId: string,
  ): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
    const config = await this.pluginService.getDecryptedPluginConfig(projectId, pluginId);
    if (!config?.refreshToken) {
      throw new Error('Google account not connected');
    }

    const accessToken = await this.getValidAccessToken(projectId, pluginId, config);
    const calendars = await this.googleCalendarOAuthService.listCalendarsForToken(accessToken);
    return calendars.map((c) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
    }));
  }

  /**
   * Get a valid access token, refreshing if expired.
   */
  async getValidAccessToken(
    projectId: string,
    pluginId: string,
    config: Record<string, unknown>,
  ): Promise<string> {
    const tokenExpiry = config.tokenExpiry as number;
    const isExpired = !tokenExpiry || Date.now() > tokenExpiry - 60_000; // 1 min buffer

    if (!isExpired && config.accessToken) {
      return config.accessToken as string;
    }

    const refreshed = await this.googleCalendarOAuthService.refreshAccessTokenForCredentials(
      config.clientId as string,
      config.clientSecret as string,
      config.refreshToken as string,
    );

    await this.pluginService.updatePluginConfig(projectId, pluginId, {
      ...config,
      accessToken: refreshed.accessToken,
      tokenExpiry: refreshed.tokenExpiry,
    });

    return refreshed.accessToken;
  }

  // ===== State encryption helpers =====

  private encryptState(data: Record<string, unknown>): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptState(state: string): { projectId: string; pluginId: string; timestamp: number } {
    const [ivHex, authTagHex, encrypted] = state.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }
}
