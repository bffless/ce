import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AIToolPluginService } from './ai-tool-plugin.service';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private readonly pluginService: AIToolPluginService,
    private readonly configService: ConfigService,
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

    const params = new URLSearchParams({
      client_id: config.clientId as string,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return { authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` };
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
    // Validate state
    const stateData = this.decryptState(state);
    if (stateData.projectId !== projectId || stateData.pluginId !== pluginId) {
      throw new Error('Invalid OAuth state: project/plugin mismatch');
    }
    if (Date.now() - stateData.timestamp > STATE_EXPIRY_MS) {
      throw new Error('OAuth state expired');
    }

    // Get client credentials from stored config
    const config = await this.pluginService.getDecryptedPluginConfig(projectId, pluginId);
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId as string,
        client_secret: config.clientSecret as string,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      this.logger.error(`Token exchange failed: ${JSON.stringify(error)}`);
      throw new Error(error.error_description || 'Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json();

    // Fetch user email
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let connectedEmail = 'unknown';
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      connectedEmail = userInfo.email || 'unknown';
    }

    // Merge tokens into existing plugin config
    const updatedConfig = {
      ...config,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: Date.now() + tokens.expires_in * 1000,
      connectedEmail,
    };

    await this.pluginService.updatePluginConfig(projectId, pluginId, updatedConfig);
    this.logger.log(`Google OAuth connected for project ${projectId}: ${connectedEmail}`);

    return { connectedEmail };
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error_description || 'Failed to refresh access token');
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Revoke a refresh token.
   */
  async revokeToken(refreshToken: string): Promise<void> {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${refreshToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (error) {
      this.logger.warn(`Token revocation failed: ${error.message}`);
      // Continue — revoking is best-effort
    }
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

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to list calendars');
    }

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || item.id,
      primary: item.primary || false,
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

    // Refresh
    const { accessToken, expiresIn } = await this.refreshAccessToken(
      config.clientId as string,
      config.clientSecret as string,
      config.refreshToken as string,
    );

    // Update stored config with new token
    const updatedConfig = {
      ...config,
      accessToken,
      tokenExpiry: Date.now() + expiresIn * 1000,
    };
    await this.pluginService.updatePluginConfig(projectId, pluginId, updatedConfig);

    return accessToken;
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
