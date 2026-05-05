import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

/**
 * Stored integration config shape in projects.settings.integrations
 */
export interface StoredIntegrationConfig {
  enabled: boolean;
  activeEnvironment: 'sandbox' | 'production';
  sandbox?: { config: string }; // encrypted JSON
  production?: { config: string }; // encrypted JSON
  webhookPipelines?: Array<{
    eventType: string;
    pipelinePath: string;
  }>;
}

/**
 * Decrypted Stripe config (what gets encrypted/decrypted)
 */
export interface StripeIntegrationKeys {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

/**
 * Decrypted GitHub config
 */
export interface GitHubIntegrationKeys {
  personalAccessToken: string;
  defaultOrg?: string;
}

/**
 * Public-facing integration info (no secrets exposed)
 */
export interface IntegrationInfo {
  id: string;
  enabled: boolean;
  activeEnvironment: 'sandbox' | 'production';
  hasSandboxConfig: boolean;
  hasProductionConfig: boolean;
  /** Non-sensitive config values exposed to the UI */
  publicConfig?: Record<string, unknown>;
  webhookPipelines: Array<{
    eventType: string;
    pipelinePath: string;
  }>;
}

/**
 * Service for managing project-level integrations with encrypted credential storage.
 * Follows the same encryption pattern as AIToolPluginService.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private configService: ConfigService,
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

  /** Supported integration ids (returned by `listIntegrations`). */
  private static readonly SUPPORTED_INTEGRATIONS = ['stripe', 'github', 'google-calendar'] as const;

  /** Fields that are safe to expose in the API response (per integration) */
  private static readonly PUBLIC_CONFIG_FIELDS: Record<string, string[]> = {
    github: ['defaultOrg'],
    'google-calendar': ['connectedEmail', 'availableCalendars'],
  };

  /**
   * Get integration info for a project (no secrets exposed)
   */
  async getIntegration(projectId: string, integrationId: string): Promise<IntegrationInfo> {
    const stored = await this.getStoredIntegration(projectId, integrationId);
    return this.toIntegrationInfo(integrationId, stored);
  }

  /**
   * List all integrations for a project
   */
  async listIntegrations(projectId: string): Promise<IntegrationInfo[]> {
    const allIntegrations = await this.getAllStoredIntegrations(projectId);
    return IntegrationsService.SUPPORTED_INTEGRATIONS.map((id) =>
      this.toIntegrationInfo(id, allIntegrations[id]),
    );
  }

  private toIntegrationInfo(id: string, stored?: StoredIntegrationConfig | null): IntegrationInfo {
    const info: IntegrationInfo = {
      id,
      enabled: stored?.enabled ?? false,
      activeEnvironment: stored?.activeEnvironment ?? 'sandbox',
      hasSandboxConfig: !!stored?.sandbox?.config,
      hasProductionConfig: !!stored?.production?.config,
      webhookPipelines: stored?.webhookPipelines ?? [],
    };

    // Extract non-sensitive fields from the active config
    const publicFields = IntegrationsService.PUBLIC_CONFIG_FIELDS[id];
    if (publicFields && stored?.enabled) {
      // For single-environment integrations (e.g. github), prefer production slot
      const env = stored.production?.config ? 'production' : (stored.activeEnvironment ?? 'production');
      const envConfig = stored[env];
      if (envConfig?.config) {
        try {
          const decrypted = JSON.parse(this.decryptData(envConfig.config));
          const publicConfig: Record<string, unknown> = {};
          for (const field of publicFields) {
            if (decrypted[field] !== undefined) {
              publicConfig[field] = decrypted[field];
            }
          }
          if (Object.keys(publicConfig).length > 0) {
            info.publicConfig = publicConfig;
          }
        } catch {
          // Ignore decryption errors
        }
      }
    }

    return info;
  }

  /**
   * Save integration config for a specific environment
   */
  async setConfig(
    projectId: string,
    integrationId: string,
    environment: 'sandbox' | 'production',
    config: Record<string, unknown>,
  ): Promise<IntegrationInfo> {
    const allIntegrations = await this.getAllStoredIntegrations(projectId);
    const stored: StoredIntegrationConfig = allIntegrations[integrationId] || {
      enabled: true,
      activeEnvironment: environment,
    };

    stored.enabled = true;

    // Merge with existing config: only overwrite fields that have non-empty values
    // This allows saving just the webhook secret without wiping the secret key, etc.
    let mergedConfig = config;
    if (stored[environment]?.config) {
      try {
        const existing = JSON.parse(this.decryptData(stored[environment]!.config));
        mergedConfig = { ...existing };
        for (const [key, value] of Object.entries(config)) {
          if (value !== undefined && value !== null && value !== '') {
            mergedConfig[key] = value;
          }
        }
      } catch {
        // If decryption fails, use new config as-is
      }
    }

    stored[environment] = {
      config: this.encryptData(JSON.stringify(mergedConfig)),
    };

    allIntegrations[integrationId] = stored;
    await this.saveAllIntegrations(projectId, allIntegrations);

    this.logger.log(`Saved ${environment} config for integration '${integrationId}' in project ${projectId}`);

    return this.getIntegration(projectId, integrationId);
  }

  /**
   * Switch active environment for an integration
   */
  async switchEnvironment(
    projectId: string,
    integrationId: string,
    environment: 'sandbox' | 'production',
  ): Promise<IntegrationInfo> {
    const allIntegrations = await this.getAllStoredIntegrations(projectId);
    const stored = allIntegrations[integrationId];
    if (!stored?.enabled) {
      throw new NotFoundException(`Integration '${integrationId}' is not enabled`);
    }

    stored.activeEnvironment = environment;
    allIntegrations[integrationId] = stored;
    await this.saveAllIntegrations(projectId, allIntegrations);

    return this.getIntegration(projectId, integrationId);
  }

  /**
   * Update webhook pipeline mappings for an integration
   */
  async setWebhookPipelines(
    projectId: string,
    integrationId: string,
    webhookPipelines: Array<{ eventType: string; pipelinePath: string }>,
  ): Promise<IntegrationInfo> {
    const allIntegrations = await this.getAllStoredIntegrations(projectId);
    const stored = allIntegrations[integrationId];
    if (!stored?.enabled) {
      throw new NotFoundException(`Integration '${integrationId}' is not enabled`);
    }

    stored.webhookPipelines = webhookPipelines;
    allIntegrations[integrationId] = stored;
    await this.saveAllIntegrations(projectId, allIntegrations);

    return this.getIntegration(projectId, integrationId);
  }

  /**
   * Delete an integration (remove all config). Per-integration cleanup
   * (e.g. revoking OAuth tokens with the upstream provider) runs first;
   * a failure there is logged but doesn't block the local delete — leaving
   * a stale grant on Google is preferable to leaving a stuck integration
   * row in the project.
   */
  async deleteIntegration(projectId: string, integrationId: string): Promise<void> {
    if (integrationId === 'google-calendar') {
      await this.revokeGoogleCalendarTokens(projectId);
    }

    const allIntegrations = await this.getAllStoredIntegrations(projectId);
    delete allIntegrations[integrationId];
    await this.saveAllIntegrations(projectId, allIntegrations);

    this.logger.log(`Deleted integration '${integrationId}' from project ${projectId}`);
  }

  /**
   * Best-effort revoke of any stored refresh token before deleting the
   * google-calendar integration. Iterates both environments so a project
   * that connected sandbox + production (rare) gets both grants released.
   */
  private async revokeGoogleCalendarTokens(projectId: string): Promise<void> {
    const stored = await this.getStoredIntegration(projectId, 'google-calendar');
    if (!stored) return;
    for (const env of ['sandbox', 'production'] as const) {
      const envConfig = stored[env];
      if (!envConfig?.config) continue;
      try {
        const decrypted = JSON.parse(this.decryptData(envConfig.config)) as {
          refreshToken?: string;
        };
        if (decrypted.refreshToken) {
          await this.googleCalendarOAuthService.revokeToken(decrypted.refreshToken);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to revoke ${env} refresh token for project ${projectId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Get decrypted config for the active environment.
   * Used by step handlers and webhook controller at runtime.
   */
  async getActiveConfig(
    projectId: string,
    integrationId: string,
    environmentOverride?: 'sandbox' | 'production',
  ): Promise<Record<string, unknown> | null> {
    const stored = await this.getStoredIntegration(projectId, integrationId);
    if (!stored?.enabled) return null;

    const env = environmentOverride || stored.activeEnvironment;
    const envConfig = stored[env];
    if (!envConfig?.config) return null;

    try {
      return JSON.parse(this.decryptData(envConfig.config));
    } catch {
      this.logger.warn(`Failed to decrypt ${env} config for '${integrationId}'`);
      return null;
    }
  }

  /**
   * Get the stored integration config (for webhook pipeline lookups)
   */
  async getStoredIntegration(
    projectId: string,
    integrationId: string,
  ): Promise<StoredIntegrationConfig | null> {
    const all = await this.getAllStoredIntegrations(projectId);
    return all[integrationId] ?? null;
  }

  /**
   * Test connection by attempting to list Stripe products with the given keys
   */
  async testConnection(
    projectId: string,
    integrationId: string,
    environment?: 'sandbox' | 'production',
  ): Promise<{ success: boolean; error?: string }> {
    const stored = await this.getStoredIntegration(projectId, integrationId);
    if (!stored?.enabled) {
      return { success: false, error: 'Integration not enabled' };
    }

    const env = environment || stored.activeEnvironment;
    const envConfig = stored[env];
    if (!envConfig?.config) {
      return { success: false, error: `No ${env} configuration found` };
    }

    try {
      if (integrationId === 'github') {
        const config = JSON.parse(this.decryptData(envConfig.config)) as GitHubIntegrationKeys;

        const response = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${config.personalAccessToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          return { success: false, error: body.message || `HTTP ${response.status}` };
        }

        return { success: true };
      }

      if (integrationId === 'google-calendar') {
        const token = await this.googleCalendarOAuthService.getValidAccessToken(projectId, env);
        if (!token) {
          return { success: false, error: 'Google Calendar not connected (complete OAuth flow first)' };
        }
        const response = await fetch(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          return {
            success: false,
            error: body.error?.message || `Google API HTTP ${response.status}`,
          };
        }
        return { success: true };
      }

      const config = JSON.parse(this.decryptData(envConfig.config)) as StripeIntegrationKeys;

      // Dynamically import stripe to test connection
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(config.secretKey);

      // Simple API call to verify the key works
      await stripe.products.list({ limit: 1 });

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect',
      };
    }
  }

  // ===== Private helpers =====

  private async getAllStoredIntegrations(
    projectId: string,
  ): Promise<Record<string, StoredIntegrationConfig>> {
    const [project] = await db
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project?.settings) return {};

    const settings = project.settings as Record<string, unknown>;
    return (settings.integrations as Record<string, StoredIntegrationConfig>) ?? {};
  }

  private async saveAllIntegrations(
    projectId: string,
    integrations: Record<string, StoredIntegrationConfig>,
  ): Promise<void> {
    const [project] = await db
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const settings = (project.settings || {}) as Record<string, unknown>;
    settings.integrations = integrations;

    await db
      .update(projects)
      .set({ settings, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
