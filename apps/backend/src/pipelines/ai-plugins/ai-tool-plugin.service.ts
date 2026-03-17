import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../../db/client';
import { projects } from '../../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { z } from 'zod';
import { AIToolPluginRegistry } from './ai-tool-plugin.registry';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolContext,
  StoredPluginConfig,
} from './ai-tool-plugin.interface';

/**
 * Response shape for plugin list endpoints
 */
export interface PluginListItem extends AIToolPluginMetadata {
  enabled: boolean;
  hasConfig: boolean;
  oauthConnectedEmail?: string;
}

/**
 * Service for managing AI tool plugins per project.
 *
 * Responsibilities:
 * - List available/enabled plugins
 * - Enable/disable plugins with encrypted config storage
 * - Build Vercel AI SDK tool objects for enabled plugins
 */
@Injectable()
export class AIToolPluginService {
  private readonly logger = new Logger(AIToolPluginService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private readonly registry: AIToolPluginRegistry,
    private configService: ConfigService,
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
   * Get all registered plugins with their enabled status for a project
   */
  async getAvailablePlugins(projectId: string): Promise<PluginListItem[]> {
    const storedPlugins = await this.getStoredPlugins(projectId);
    const allPlugins = this.registry.getAll();

    return allPlugins.map((plugin) => {
      const stored = storedPlugins[plugin.metadata.id];
      let oauthConnectedEmail: string | undefined;

      // For OAuth plugins, extract connectedEmail from stored config
      if (plugin.metadata.requiresOAuth && stored?.config) {
        try {
          const decrypted = JSON.parse(this.decryptData(stored.config));
          oauthConnectedEmail = decrypted.connectedEmail;
        } catch {
          // Ignore decryption errors
        }
      }

      return {
        ...plugin.metadata,
        enabled: stored?.enabled ?? false,
        hasConfig: !!stored?.config,
        oauthConnectedEmail,
      };
    });
  }

  /**
   * Enable a plugin for a project, optionally with configuration
   */
  async enablePlugin(
    projectId: string,
    pluginId: string,
    config?: Record<string, unknown>,
  ): Promise<PluginListItem> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginId}' not found`);
    }

    // Validate config if plugin requires it
    if (config && plugin.validateConfig) {
      const validation = await plugin.validateConfig(config);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid plugin configuration');
      }
    }

    const storedPlugins = await this.getStoredPlugins(projectId);
    const storedConfig: StoredPluginConfig = {
      enabled: true,
      config: config ? this.encryptData(JSON.stringify(config)) : storedPlugins[pluginId]?.config,
    };

    storedPlugins[pluginId] = storedConfig;
    await this.saveStoredPlugins(projectId, storedPlugins);

    this.logger.log(`Enabled plugin '${pluginId}' for project ${projectId}`);

    return {
      ...plugin.metadata,
      enabled: true,
      hasConfig: !!storedConfig.config,
    };
  }

  /**
   * Disable a plugin for a project
   */
  async disablePlugin(projectId: string, pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginId}' not found`);
    }

    const storedPlugins = await this.getStoredPlugins(projectId);
    if (storedPlugins[pluginId]) {
      delete storedPlugins[pluginId];
      await this.saveStoredPlugins(projectId, storedPlugins);
    }

    this.logger.log(`Disabled plugin '${pluginId}' for project ${projectId}`);
  }

  /**
   * Update plugin configuration for an already-enabled plugin
   */
  async updatePluginConfig(
    projectId: string,
    pluginId: string,
    config: Record<string, unknown>,
  ): Promise<PluginListItem> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginId}' not found`);
    }

    const storedPlugins = await this.getStoredPlugins(projectId);
    if (!storedPlugins[pluginId]?.enabled) {
      throw new NotFoundException(`Plugin '${pluginId}' is not enabled for this project`);
    }

    // Validate config if plugin supports it
    if (plugin.validateConfig) {
      const validation = await plugin.validateConfig(config);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid plugin configuration');
      }
    }

    storedPlugins[pluginId] = {
      enabled: true,
      config: this.encryptData(JSON.stringify(config)),
    };
    await this.saveStoredPlugins(projectId, storedPlugins);

    this.logger.log(`Updated config for plugin '${pluginId}' in project ${projectId}`);

    return {
      ...plugin.metadata,
      enabled: true,
      hasConfig: true,
    };
  }

  /**
   * Get the decrypted config for an enabled plugin.
   * Used by OAuth services that need to read stored credentials.
   */
  async getDecryptedPluginConfig(
    projectId: string,
    pluginId: string,
  ): Promise<Record<string, unknown> | null> {
    const storedPlugins = await this.getStoredPlugins(projectId);
    const stored = storedPlugins[pluginId];
    if (!stored?.enabled || !stored.config) return null;

    try {
      return JSON.parse(this.decryptData(stored.config));
    } catch {
      return null;
    }
  }

  /**
   * Build Vercel AI SDK tools for all enabled plugins for a project.
   * Tools are namespaced as {pluginId}_{toolName} to prevent collisions.
   */
  async buildToolsForProject(
    projectId: string,
    pipelinePluginOptions?: Record<string, Record<string, unknown>>,
  ): Promise<Record<string, any>> {
    const storedPlugins = await this.getStoredPlugins(projectId);
    const tools: Record<string, any> = {};

    for (const [pluginId, stored] of Object.entries(storedPlugins)) {
      if (!stored.enabled) continue;

      const plugin = this.registry.get(pluginId);
      if (!plugin) {
        this.logger.warn(`Enabled plugin '${pluginId}' not found in registry — skipping`);
        continue;
      }

      try {
        const decryptedConfig = stored.config
          ? JSON.parse(this.decryptData(stored.config))
          : {};

        const pluginTools = plugin.getTools(decryptedConfig);
        const context: AIToolContext = {
          projectId,
          pluginConfig: decryptedConfig,
          pipelineOptions: pipelinePluginOptions?.[pluginId],
        };

        for (const toolDef of pluginTools) {
          const namespacedName = `${pluginId}_${toolDef.name}`;
          tools[namespacedName] = {
            description: toolDef.description,
            inputSchema: toolDef.inputSchema,
            execute: async (args: any) => toolDef.execute(args, context),
          };
        }

        this.logger.debug(
          `Built ${pluginTools.length} tools for plugin '${pluginId}': ${pluginTools.map((t) => t.name).join(', ')}`,
        );
      } catch (error) {
        this.logger.warn(`Failed to build tools for plugin '${pluginId}': ${error.message}`);
        // Continue — don't let one broken plugin block others
      }
    }

    return tools;
  }

  // ===== Private helpers =====

  private async getStoredPlugins(
    projectId: string,
  ): Promise<Record<string, StoredPluginConfig>> {
    const [project] = await db
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project?.settings) return {};

    const settings = project.settings as Record<string, unknown>;
    return (settings.aiPlugins as Record<string, StoredPluginConfig>) ?? {};
  }

  private async saveStoredPlugins(
    projectId: string,
    plugins: Record<string, StoredPluginConfig>,
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
    settings.aiPlugins = plugins;

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
