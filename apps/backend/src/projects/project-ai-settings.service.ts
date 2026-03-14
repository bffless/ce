import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';

/**
 * AI Provider types supported by the platform
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google';

/**
 * Model tier for pricing/capability categorization
 */
export type ModelTier = 'economy' | 'balanced' | 'premium';

/**
 * Model metadata with tier information
 */
export interface ModelInfo {
  id: string;
  name: string;
  tier: ModelTier;
  description: string;
}

/**
 * Metadata for AI providers
 */
export const AI_PROVIDER_METADATA: Record<
  AIProviderType,
  {
    name: string;
    description: string;
    models: ModelInfo[];
  }
> = {
  openai: {
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4, and GPT-3.5 models',
    models: [
      // Premium tier
      { id: 'gpt-4o', name: 'GPT-4o', tier: 'premium', description: 'Most capable, multimodal' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tier: 'premium', description: 'Fast GPT-4 with vision' },
      { id: 'gpt-4', name: 'GPT-4', tier: 'premium', description: 'Complex reasoning' },
      // Balanced tier
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'balanced', description: 'Fast and affordable' },
      // Economy tier
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', tier: 'economy', description: 'Fast and cost-effective' },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    description: 'Claude Opus 4.6, Sonnet 4.6, and Haiku 4.5',
    models: [
      // Premium tier
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', description: 'Most intelligent for agents and coding' },
      // Balanced tier
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'balanced', description: 'Best balance of speed and intelligence' },
      // Economy tier
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'economy', description: 'Fastest with near-frontier intelligence' },
    ],
  },
  google: {
    name: 'Google AI',
    description: 'Gemini Pro and Flash models',
    models: [
      // Premium tier
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', tier: 'premium', description: '1M token context, best reasoning' },
      // Balanced tier
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', tier: 'balanced', description: 'Fast multimodal' },
      // Economy tier
      { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B', tier: 'economy', description: 'Most cost-effective' },
    ],
  },
};

/**
 * Stored provider configuration
 */
interface StoredProviderConfig {
  provider: AIProviderType;
  config: string; // encrypted
  isDefault: boolean;
  createdAt: string;
}

/**
 * Decrypted provider configuration
 */
export interface AIProviderConfig {
  provider: AIProviderType;
  providerName: string;
  apiKey: string;
  defaultModel?: string;
  isDefault: boolean;
  suggestedModels: ModelInfo[];
}

export interface AIStatusResponse {
  hasAIConfigured: boolean;
  providers: {
    provider: string;
    providerName: string;
    apiKey: string; // Masked
    defaultModel?: string;
    isDefault: boolean;
    suggestedModels: ModelInfo[];
  }[];
  defaultProvider?: string;
}

export interface AddAIProviderDto {
  provider: AIProviderType;
  config: {
    apiKey: string;
    defaultModel?: string;
  };
  isDefault?: boolean;
}

export interface TestAIResponse {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
  model?: string;
}

@Injectable()
export class ProjectAISettingsService {
  private readonly logger = new Logger(ProjectAISettingsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(private configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  /**
   * Get all configured AI providers for a project (without sensitive data)
   */
  async getAIStatus(projectId: string): Promise<AIStatusResponse> {
    try {
      const providers = await this.getAllProviders(projectId);

      if (providers.length === 0) {
        return { hasAIConfigured: false, providers: [] };
      }

      const defaultProvider = providers.find((p) => p.isDefault)?.provider;

      return {
        hasAIConfigured: true,
        providers: providers.map((p) => ({
          provider: p.provider,
          providerName: p.providerName,
          apiKey: this.maskApiKey(p.apiKey),
          defaultModel: p.defaultModel,
          isDefault: p.isDefault,
          suggestedModels: p.suggestedModels,
        })),
        defaultProvider,
      };
    } catch (error) {
      this.logger.error('Error getting AI status:', error);
      return { hasAIConfigured: false, providers: [] };
    }
  }

  /**
   * Add or update an AI provider for a project
   */
  async addOrUpdateProvider(projectId: string, dto: AddAIProviderDto): Promise<AIStatusResponse> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new NotFoundException('Project not found');
      }

      // Get existing providers
      const existingProviders = await this.getStoredProviders(projectId);

      // Check if provider already exists
      const existingIndex = existingProviders.findIndex((p) => p.provider === dto.provider);

      const newConfig: StoredProviderConfig = {
        provider: dto.provider,
        config: this.encryptData(JSON.stringify(dto.config)),
        isDefault: dto.isDefault ?? existingProviders.length === 0, // First provider is default
        createdAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        // Update existing provider
        existingProviders[existingIndex] = {
          ...existingProviders[existingIndex],
          config: newConfig.config,
          isDefault: dto.isDefault ?? existingProviders[existingIndex].isDefault,
        };
      } else {
        // Add new provider
        existingProviders.push(newConfig);
      }

      // If this is set as default, unset others
      if (newConfig.isDefault) {
        existingProviders.forEach((p) => {
          if (p.provider !== dto.provider) {
            p.isDefault = false;
          }
        });
      }

      // Save to database
      await db
        .update(projects)
        .set({
          aiProviders: JSON.stringify(existingProviders),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      this.logger.log(`AI provider ${dto.provider} ${existingIndex >= 0 ? 'updated' : 'added'} for project ${projectId}`);

      return this.getAIStatus(projectId);
    } catch (error) {
      this.logger.error('Error adding/updating AI provider:', error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to update AI configuration');
    }
  }

  /**
   * Remove an AI provider from a project
   */
  async removeProvider(projectId: string, provider: AIProviderType): Promise<AIStatusResponse> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new NotFoundException('Project not found');
      }

      const existingProviders = await this.getStoredProviders(projectId);
      const providerIndex = existingProviders.findIndex((p) => p.provider === provider);

      if (providerIndex < 0) {
        throw new NotFoundException(`Provider ${provider} not configured`);
      }

      const wasDefault = existingProviders[providerIndex].isDefault;
      existingProviders.splice(providerIndex, 1);

      // If we removed the default, set the first remaining as default
      if (wasDefault && existingProviders.length > 0) {
        existingProviders[0].isDefault = true;
      }

      await db
        .update(projects)
        .set({
          aiProviders: JSON.stringify(existingProviders),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      this.logger.log(`AI provider ${provider} removed from project ${projectId}`);

      return this.getAIStatus(projectId);
    } catch (error) {
      this.logger.error('Error removing AI provider:', error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to remove AI provider');
    }
  }

  /**
   * Set a provider as default for a project
   */
  async setDefaultProvider(projectId: string, provider: AIProviderType): Promise<AIStatusResponse> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new NotFoundException('Project not found');
      }

      const existingProviders = await this.getStoredProviders(projectId);
      const providerExists = existingProviders.some((p) => p.provider === provider);

      if (!providerExists) {
        throw new NotFoundException(`Provider ${provider} not configured`);
      }

      existingProviders.forEach((p) => {
        p.isDefault = p.provider === provider;
      });

      await db
        .update(projects)
        .set({
          aiProviders: JSON.stringify(existingProviders),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      this.logger.log(`AI provider ${provider} set as default for project ${projectId}`);

      return this.getAIStatus(projectId);
    } catch (error) {
      this.logger.error('Error setting default provider:', error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to set default provider');
    }
  }

  /**
   * Test AI connection for a specific provider
   */
  async testAIConnection(projectId: string, provider?: AIProviderType): Promise<TestAIResponse> {
    try {
      const providers = await this.getAllProviders(projectId);

      if (providers.length === 0) {
        return {
          success: false,
          message: 'No AI providers configured',
          error: 'Please configure an AI provider first',
        };
      }

      // Find the provider to test
      const providerConfig = provider
        ? providers.find((p) => p.provider === provider)
        : providers.find((p) => p.isDefault) || providers[0];

      if (!providerConfig) {
        return {
          success: false,
          message: 'Provider not found',
          error: `Provider ${provider} is not configured`,
        };
      }

      const startTime = Date.now();

      switch (providerConfig.provider) {
        case 'openai':
          return await this.testOpenAI(providerConfig.apiKey, startTime);
        case 'anthropic':
          return await this.testAnthropic(providerConfig.apiKey, startTime);
        case 'google':
          return await this.testGoogle(providerConfig.apiKey, startTime);
        default:
          return {
            success: false,
            message: 'Unknown provider',
            error: `Provider ${providerConfig.provider} is not supported`,
          };
      }
    } catch (error) {
      this.logger.error('AI connection test failed:', error);
      return {
        success: false,
        message: 'AI connection test failed',
        error: error.message,
      };
    }
  }

  /**
   * Get decrypted config for a specific provider (for use by handlers)
   */
  async getProviderConfig(projectId: string, provider?: AIProviderType): Promise<AIProviderConfig | null> {
    const providers = await this.getAllProviders(projectId);

    if (providers.length === 0) {
      return null;
    }

    if (provider) {
      return providers.find((p) => p.provider === provider) || null;
    }

    // Return default provider
    return providers.find((p) => p.isDefault) || providers[0];
  }

  /**
   * Get all providers (decrypted, for internal use)
   */
  async getAllProviders(projectId: string): Promise<AIProviderConfig[]> {
    try {
      const stored = await this.getStoredProviders(projectId);

      return stored.map((p) => {
        const config = JSON.parse(this.decryptData(p.config));
        const meta = AI_PROVIDER_METADATA[p.provider];

        return {
          provider: p.provider,
          providerName: meta?.name || p.provider,
          apiKey: config.apiKey,
          defaultModel: config.defaultModel,
          isDefault: p.isDefault,
          suggestedModels: meta?.models || [],
        };
      });
    } catch (error) {
      this.logger.error('Failed to get AI providers:', error);
      return [];
    }
  }

  /**
   * Check if any AI provider is configured for a project
   */
  async hasAIConfigured(projectId: string): Promise<boolean> {
    const providers = await this.getAllProviders(projectId);
    return providers.length > 0;
  }

  /**
   * Get available AI providers metadata
   */
  getAvailableProviders(): {
    provider: AIProviderType;
    displayName: string;
    description: string;
    models: ModelInfo[];
  }[] {
    return Object.entries(AI_PROVIDER_METADATA).map(([id, meta]) => ({
      provider: id as AIProviderType,
      displayName: meta.name,
      description: meta.description,
      models: meta.models,
    }));
  }

  // ===== Skills Path Settings =====

  /**
   * Get the skills path for a project (default: .bffless/skills)
   */
  async getSkillsPath(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project?.settings) {
      return '.bffless/skills';
    }

    const settings = project.settings as Record<string, unknown>;
    return (settings.skillsPath as string) ?? '.bffless/skills';
  }

  /**
   * Set the skills path for a project
   */
  async setSkillsPath(projectId: string, skillsPath: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const settings = (project.settings || {}) as Record<string, unknown>;
    settings.skillsPath = skillsPath;

    await db
      .update(projects)
      .set({
        settings,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    this.logger.log(`Updated skillsPath for project ${projectId}: ${skillsPath}`);
  }

  // ===== Private methods =====

  private async getProject(projectId: string) {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    return project;
  }

  private async getStoredProviders(projectId: string): Promise<StoredProviderConfig[]> {
    const project = await this.getProject(projectId);
    if (!project?.aiProviders) {
      return [];
    }

    try {
      return JSON.parse(project.aiProviders);
    } catch {
      return [];
    }
  }

  private async testOpenAI(apiKey: string, startTime: number): Promise<TestAIResponse> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: 'OpenAI API test failed',
          error: error.error?.message || `HTTP ${response.status}`,
          latencyMs,
        };
      }

      return {
        success: true,
        message: 'OpenAI connection successful',
        latencyMs,
        model: 'gpt-4o',
      };
    } catch (error) {
      return {
        success: false,
        message: 'OpenAI connection failed',
        error: error.message,
      };
    }
  }

  private async testAnthropic(apiKey: string, startTime: number): Promise<TestAIResponse> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 401) {
          return {
            success: false,
            message: 'Anthropic API test failed',
            error: 'Invalid API key',
            latencyMs,
          };
        }
        return {
          success: false,
          message: 'Anthropic API test failed',
          error: error.error?.message || `HTTP ${response.status}`,
          latencyMs,
        };
      }

      return {
        success: true,
        message: 'Anthropic connection successful',
        latencyMs,
        model: 'claude-3-5-sonnet-20241022',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Anthropic connection failed',
        error: error.message,
      };
    }
  }

  private async testGoogle(apiKey: string, startTime: number): Promise<TestAIResponse> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        {
          method: 'GET',
        },
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          message: 'Google AI API test failed',
          error: error.error?.message || `HTTP ${response.status}`,
          latencyMs,
        };
      }

      return {
        success: true,
        message: 'Google AI connection successful',
        latencyMs,
        model: 'gemini-1.5-pro',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Google AI connection failed',
        error: error.message,
      };
    }
  }

  private maskApiKey(key: string): string {
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
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
