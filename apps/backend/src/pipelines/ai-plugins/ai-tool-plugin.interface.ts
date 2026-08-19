import { z } from 'zod';

/**
 * Context passed to plugin tool execution
 */
export interface AIToolContext {
  projectId: string;
  userId?: string;
  pluginConfig: Record<string, unknown>;
  /** Per-pipeline options set in the pipeline editor (e.g., calendarId) */
  pipelineOptions?: Record<string, unknown>;
}

/**
 * A single tool definition provided by a plugin
 */
export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  execute: (args: any, context: AIToolContext) => Promise<any>;
}

/**
 * Metadata describing a plugin (used for UI display and configuration)
 */
export interface AIToolPluginMetadata {
  /** Unique identifier, e.g. 'google-calendar' */
  id: string;
  /** Display name, e.g. 'Google Calendar' */
  name: string;
  /** Brief description of what the plugin does */
  description: string;
  /** Category for grouping, e.g. 'scheduling', 'communication', 'utility' */
  category: string;
  /** Optional icon identifier */
  icon?: string;
  /** Zod schema for plugin configuration/credentials */
  configSchema?: z.ZodObject<any>;
  /** Whether this plugin requires OAuth authentication */
  requiresOAuth?: boolean;
  /** OAuth provider identifier (e.g. 'google') */
  oauthProvider?: string;
  /** Optional Zod schema for per-pipeline options (e.g., calendarId selection) */
  pipelineOptionsSchema?: z.ZodObject<any>;
}

/**
 * Interface that all AI tool plugins must implement.
 * Plugins are NestJS @Injectable() classes that self-register with the AIToolPluginRegistry.
 */
export interface AIToolPlugin {
  readonly metadata: AIToolPluginMetadata;

  /**
   * Return the tools this plugin provides, configured with the given config.
   * Called only when the plugin is enabled for a project.
   */
  getTools(config: Record<string, unknown>): AIToolDefinition[];

  /**
   * Optional: validate plugin configuration before storing.
   * Called when a user enables the plugin or updates its config.
   */
  validateConfig?(config: Record<string, unknown>): Promise<{ valid: boolean; error?: string }>;

  /**
   * Optional: return tools that depend on per-pipeline options (e.g., dynamic tools per source).
   * When implemented, this is called instead of getTools() during tool building.
   */
  getToolsWithOptions?(
    config: Record<string, unknown>,
    pipelineOptions?: Record<string, unknown>,
  ): AIToolDefinition[];

  /**
   * Optional: return instructions to append to the AI system prompt.
   * Called with the pipeline options so plugins can provide context-aware guidance.
   */
  getSystemPromptInstructions?(pipelineOptions?: Record<string, unknown>): string | null;
}

/**
 * Stored plugin configuration in projects.settings.aiPlugins
 */
export interface StoredPluginConfig {
  enabled: boolean;
  config?: string; // encrypted JSON string
}
