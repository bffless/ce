import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { projects, deploymentAliases } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'crypto';

/**
 * AI Provider types supported by the platform
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google';

/**
 * AI Service types (external ML services, separate from chat LLM providers)
 */
export type AIServiceType = 'replicate';

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
 * Why a model list fell back to the built-in catalog. Only 'fetch_failed' is
 * an actual problem — the other two are expected states the UI shouldn't alarm
 * the user about.
 */
export type ModelListFallbackReason = 'no_key' | 'unsupported_provider' | 'fetch_failed';

/**
 * A resolved model list plus whether it came from the provider's live catalog.
 * `live: false` means these are the built-in suggestions; `fallbackReason` says
 * why, so callers can distinguish a broken lookup from a provider that simply
 * has no live listing.
 */
export interface ProviderModelList {
  models: ModelInfo[];
  live: boolean;
  fallbackReason?: ModelListFallbackReason;
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
    // Fallback only — the live list from /v1/models supersedes this whenever a
    // key is available (see fetchAnthropicModels). One representative per tier.
    description: 'Claude Opus 4.8, Sonnet 5, and Haiku 4.5',
    models: [
      // Premium tier
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', tier: 'premium', description: 'Most intelligent for agents and coding' },
      // Balanced tier
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: 'balanced', description: 'Best balance of speed and intelligence' },
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

/**
 * Stored AI service configuration
 */
interface StoredServiceConfig {
  service: AIServiceType;
  config: string; // encrypted
  createdAt: string;
}

/**
 * Decrypted AI service configuration
 */
export interface AIServiceConfig {
  service: AIServiceType;
  apiToken: string;
}

/**
 * AI Services status response (for frontend display)
 */
export interface AIServicesStatusResponse {
  services: {
    service: AIServiceType;
    apiToken: string; // Masked
    createdAt: string;
  }[];
}

@Injectable()
export class ProjectAISettingsService {
  private readonly logger = new Logger(ProjectAISettingsService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  /**
   * In-memory cache of live model lists keyed by a hash of the API key.
   * Model catalogs change rarely (a few times a year), so a long TTL avoids
   * hitting the provider's /v1/models endpoint on every status fetch.
   */
  private readonly modelsCache = new Map<string, { models: ModelInfo[]; expires: number }>();
  private readonly MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

      return await Promise.all(
        stored.map(async (p) => {
          const config = JSON.parse(this.decryptData(p.config));
          const meta = AI_PROVIDER_METADATA[p.provider];

          // For Anthropic, pull the live model list from the provider's API so
          // newly released models show up without a redeploy. Falls back to the
          // hardcoded metadata if the fetch fails.
          const suggestedModels =
            p.provider === 'anthropic'
              ? (await this.fetchAnthropicModels(config.apiKey)).models
              : meta?.models || [];

          return {
            provider: p.provider,
            providerName: meta?.name || p.provider,
            apiKey: config.apiKey,
            defaultModel: config.defaultModel,
            isDefault: p.isDefault,
            suggestedModels,
          };
        }),
      );
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

  /**
   * Preview the live model list for a provider using a caller-supplied API key.
   *
   * Used by the "Add Provider" dialog so the default-model picker reflects the
   * models the typed key can actually access, before the provider is saved.
   * Falls back to the hardcoded metadata list (no key, unsupported provider, or
   * a failed fetch) so the picker is never empty.
   */
  async previewProviderModels(
    provider: AIProviderType,
    apiKey: string,
  ): Promise<ProviderModelList> {
    const fallback = AI_PROVIDER_METADATA[provider]?.models || [];
    if (!apiKey?.trim()) {
      return { models: fallback, live: false, fallbackReason: 'no_key' };
    }

    if (provider === 'anthropic') {
      return this.fetchAnthropicModels(apiKey.trim());
    }

    // OpenAI/Google live listing not implemented yet — return the static catalog.
    return { models: fallback, live: false, fallbackReason: 'unsupported_provider' };
  }

  /**
   * Fetch the live Anthropic model list via GET /v1/models.
   *
   * The API returns model IDs + display names only (no tier/description), so we
   * classify each into a tier locally. Results are cached per-key with a long
   * TTL, and any failure falls back to the hardcoded catalog so the UI never
   * ends up with an empty model list.
   */
  private async fetchAnthropicModels(apiKey: string): Promise<ProviderModelList> {
    const fallback: ProviderModelList = {
      models: AI_PROVIDER_METADATA.anthropic.models,
      live: false,
      fallbackReason: 'fetch_failed',
    };
    if (!apiKey) {
      return { ...fallback, fallbackReason: 'no_key' };
    }

    const cacheKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    const cached = this.modelsCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return { models: cached.models, live: true };
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        this.logger.warn(
          `Anthropic models fetch failed (HTTP ${response.status}); using fallback list`,
        );
        return fallback;
      }

      const data = (await response.json()) as {
        data?: Array<{ id?: string; display_name?: string }>;
      };
      // Normalize current models to their stable alias form (e.g. drop the
      // dated suffix on claude-haiku-4-5-20251001) so the list is consistent —
      // some entries come back aliased, others dated — then dedupe.
      const seen = new Set<string>();
      const models = (data.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => Boolean(m.id))
        .map((m) => this.toAnthropicModelInfo(this.normalizeAnthropicModelId(m.id), m.display_name))
        .filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });

      if (models.length === 0) {
        return fallback;
      }

      this.modelsCache.set(cacheKey, {
        models,
        expires: Date.now() + this.MODELS_CACHE_TTL_MS,
      });
      return { models, live: true };
    } catch (error) {
      this.logger.warn(
        `Anthropic models fetch error; using fallback list: ${(error as Error)?.message}`,
      );
      return fallback;
    }
  }

  /**
   * Prefer the stable alias form for current Claude models by dropping the
   * trailing dated-snapshot suffix (e.g. claude-haiku-4-5-20251001 →
   * claude-haiku-4-5), so the picker is consistent regardless of whether the
   * API returns the aliased or dated id.
   *
   * Only strips when the result is a real alias:
   *  - "family-major-minor-date" always is (claude-haiku-4-5-20251001).
   *  - "family-major-date" is only from generation 5 on, where the bare form is
   *    the alias (claude-sonnet-5, claude-fable-5). Generation 4 aliases to a
   *    "-0" suffix instead (claude-opus-4-20250514 → claude-opus-4-0), so
   *    stripping would yield the invalid "claude-opus-4" — left untouched.
   *
   * Legacy 3.x ids (claude-3-5-sonnet-20241022) match neither shape, since the
   * family name trails the version, and are likewise left untouched.
   */
  private normalizeAnthropicModelId(id: string): string {
    const match = id.match(/^(claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?)-20\d{6}$/);
    if (!match) return id;

    const [, alias, major, minor] = match;
    if (minor !== undefined) return alias;
    return Number(major) >= 5 ? alias : id;
  }

  /**
   * Map a live Anthropic model id + display name into our tiered ModelInfo.
   * Tier is derived from the model family so new releases slot in automatically.
   */
  private toAnthropicModelInfo(id: string, displayName?: string): ModelInfo {
    const tier = this.anthropicTierFor(id);
    const descriptions: Record<ModelTier, string> = {
      premium: 'Most intelligent for agents and coding',
      balanced: 'Best balance of speed and intelligence',
      economy: 'Fastest with near-frontier intelligence',
    };
    return {
      id,
      name: displayName || id,
      tier,
      description: descriptions[tier],
    };
  }

  /**
   * Classify an Anthropic model id into a pricing/capability tier by family.
   * Unknown families default to 'balanced' so they remain selectable.
   */
  private anthropicTierFor(id: string): ModelTier {
    const lower = id.toLowerCase();
    if (lower.includes('opus') || lower.includes('fable')) return 'premium';
    if (lower.includes('haiku')) return 'economy';
    if (lower.includes('sonnet')) return 'balanced';
    return 'balanced';
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

  // ===== Skills Alias Settings =====

  /**
   * Get the alias that skills are loaded from for a project.
   * Returns null when unset (callers should fall back to the serving
   * deployment at runtime, or the latest deployment in the config UI).
   */
  async getSkillsAlias(projectId: string): Promise<string | null> {
    const project = await this.getProject(projectId);
    if (!project?.settings) {
      return null;
    }

    const settings = project.settings as Record<string, unknown>;
    const alias = settings.skillsAlias as string | undefined;
    return alias && alias.trim() ? alias : null;
  }

  /**
   * Set (or clear, when given an empty value) the alias skills are loaded from.
   */
  async setSkillsAlias(projectId: string, alias: string | null): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const settings = (project.settings || {}) as Record<string, unknown>;
    if (alias && alias.trim()) {
      settings.skillsAlias = alias.trim();
    } else {
      delete settings.skillsAlias;
    }

    await db
      .update(projects)
      .set({
        settings,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    this.logger.log(
      `Updated skillsAlias for project ${projectId}: ${alias?.trim() || '(cleared)'}`,
    );
  }

  /**
   * Resolve the commit SHA that skills should be loaded from for a project.
   * If a skills alias is configured and resolves to a deployment, that SHA is
   * returned; otherwise the provided fallback (e.g. the serving deployment's
   * SHA at runtime) is returned.
   */
  async resolveSkillsCommitSha(
    projectId: string,
    fallbackCommitSha?: string,
  ): Promise<string | undefined> {
    const alias = await this.getSkillsAlias(projectId);
    if (alias) {
      const [record] = await db
        .select({ commitSha: deploymentAliases.commitSha })
        .from(deploymentAliases)
        .where(
          and(
            eq(deploymentAliases.projectId, projectId),
            eq(deploymentAliases.alias, alias),
          ),
        )
        .limit(1);
      if (record?.commitSha) {
        return record.commitSha;
      }
    }
    return fallbackCommitSha;
  }

  // ===== AI Services (Replicate, etc.) =====

  /**
   * Get all configured AI services for a project (with masked tokens)
   */
  async getAIServicesStatus(projectId: string): Promise<AIServicesStatusResponse> {
    try {
      const stored = await this.getStoredServices(projectId);

      return {
        services: stored.map((s) => {
          const config = JSON.parse(this.decryptData(s.config));
          return {
            service: s.service,
            apiToken: this.maskApiKey(config.apiToken),
            createdAt: s.createdAt,
          };
        }),
      };
    } catch (error) {
      this.logger.error('Error getting AI services status:', error);
      return { services: [] };
    }
  }

  /**
   * Add or update an AI service for a project
   */
  async addOrUpdateService(
    projectId: string,
    service: AIServiceType,
    apiToken: string,
  ): Promise<AIServicesStatusResponse> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new NotFoundException('Project not found');
      }

      const existing = await this.getStoredServices(projectId);
      const existingIndex = existing.findIndex((s) => s.service === service);

      const newConfig: StoredServiceConfig = {
        service,
        config: this.encryptData(JSON.stringify({ apiToken })),
        createdAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        existing[existingIndex] = { ...existing[existingIndex], config: newConfig.config };
      } else {
        existing.push(newConfig);
      }

      await db
        .update(projects)
        .set({
          aiServices: JSON.stringify(existing),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      this.logger.log(`AI service ${service} ${existingIndex >= 0 ? 'updated' : 'added'} for project ${projectId}`);
      return this.getAIServicesStatus(projectId);
    } catch (error) {
      this.logger.error('Error adding/updating AI service:', error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to update AI service configuration');
    }
  }

  /**
   * Remove an AI service from a project
   */
  async removeService(projectId: string, service: AIServiceType): Promise<AIServicesStatusResponse> {
    try {
      const project = await this.getProject(projectId);
      if (!project) {
        throw new NotFoundException('Project not found');
      }

      const existing = await this.getStoredServices(projectId);
      const serviceIndex = existing.findIndex((s) => s.service === service);

      if (serviceIndex < 0) {
        throw new NotFoundException(`Service ${service} not configured`);
      }

      existing.splice(serviceIndex, 1);

      await db
        .update(projects)
        .set({
          aiServices: JSON.stringify(existing),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      this.logger.log(`AI service ${service} removed from project ${projectId}`);
      return this.getAIServicesStatus(projectId);
    } catch (error) {
      this.logger.error('Error removing AI service:', error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to remove AI service');
    }
  }

  /**
   * Get decrypted service config (for use by handlers)
   */
  async getServiceConfig(projectId: string, service: AIServiceType): Promise<AIServiceConfig | null> {
    try {
      const stored = await this.getStoredServices(projectId);
      const entry = stored.find((s) => s.service === service);

      if (!entry) {
        return null;
      }

      const config = JSON.parse(this.decryptData(entry.config));
      return {
        service: entry.service,
        apiToken: config.apiToken,
      };
    } catch (error) {
      this.logger.error('Failed to get AI service config:', error);
      return null;
    }
  }

  /**
   * Test Replicate API connection
   */
  async testReplicateConnection(apiToken: string): Promise<TestAIResponse> {
    try {
      const startTime = Date.now();
      const response = await fetch('https://api.replicate.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          message: 'Replicate API test failed',
          error: (error as Record<string, string>).detail || `HTTP ${response.status}`,
          latencyMs,
        };
      }

      return {
        success: true,
        message: 'Replicate connection successful',
        latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Replicate connection failed',
        error: (error as Error).message,
      };
    }
  }

  private async getStoredServices(projectId: string): Promise<StoredServiceConfig[]> {
    const project = await this.getProject(projectId);
    if (!project?.aiServices) {
      return [];
    }

    try {
      return JSON.parse(project.aiServices);
    } catch {
      return [];
    }
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
