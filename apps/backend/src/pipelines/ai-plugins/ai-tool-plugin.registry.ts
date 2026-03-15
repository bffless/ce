import { Injectable, Logger } from '@nestjs/common';
import { AIToolPlugin, AIToolPluginMetadata } from './ai-tool-plugin.interface';

/**
 * Registry for AI tool plugins.
 * Plugins self-register via constructor injection, same pattern as StepHandlerRegistry.
 */
@Injectable()
export class AIToolPluginRegistry {
  private readonly logger = new Logger(AIToolPluginRegistry.name);
  private readonly plugins = new Map<string, AIToolPlugin>();

  /**
   * Register a plugin. Called by plugin constructors.
   */
  register(plugin: AIToolPlugin): void {
    const { id } = plugin.metadata;
    if (this.plugins.has(id)) {
      this.logger.warn(`Plugin '${id}' is being overwritten`);
    }
    this.plugins.set(id, plugin);
    this.logger.log(`Registered AI plugin: ${id}`);
  }

  /**
   * Get a plugin by ID
   */
  get(pluginId: string): AIToolPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is registered
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Get all registered plugins
   */
  getAll(): AIToolPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get metadata for all registered plugins
   */
  getMetadataList(): AIToolPluginMetadata[] {
    return this.getAll().map((p) => p.metadata);
  }

  /**
   * Get all registered plugin IDs
   */
  getRegisteredIds(): string[] {
    return Array.from(this.plugins.keys());
  }
}
