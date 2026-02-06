import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/client';
import { featureFlags, FeatureFlag } from '../db/schema';
import {
  FlagDefinition,
  FlagType,
  getAllFlagKeys,
  getFlagDefinition,
  isValidFlagKey,
  getClientExposedFlagKeys,
} from './feature-flags.definitions';

export type FlagSource = 'default' | 'env' | 'file' | 'database';
export type FlagValue = boolean | string | number | object;

export interface ResolvedFlag {
  key: string;
  value: FlagValue;
  type: FlagType;
  source: FlagSource;
  description: string;
  category: string;
}

export interface FlagSources {
  env?: FlagValue;
  file?: FlagValue;
  database?: FlagValue;
  default: FlagValue;
  resolved: FlagValue;
  source: FlagSource;
}

interface FileConfig {
  [key: string]: boolean | string | number | object;
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);

  /** Cached file config */
  private fileConfig: FileConfig | null = null;

  /** Cached database flags */
  private dbCache: Map<string, FeatureFlag> = new Map();

  /** Config file path (can be overridden via env) */
  private readonly configFilePath: string;

  /** Cache TTL in milliseconds */
  private readonly cacheTtl = 30000; // 30 seconds
  private lastDbCacheTime = 0;

  constructor(private readonly configService: ConfigService) {
    // Default config file location, can be overridden
    this.configFilePath = this.configService.get<string>(
      'FEATURE_FLAGS_CONFIG_PATH',
      './config/features.json',
    );
  }

  async onModuleInit() {
    // Load file config on startup
    this.loadFileConfig();

    // Warm up database cache
    await this.refreshDbCache();

    this.logger.log(`Feature flags service initialized with ${getAllFlagKeys().length} flags`);
  }

  /**
   * Get a feature flag value.
   * Resolution priority: Database > File > Environment > Default
   */
  async get<T = boolean | string | number | object>(key: string): Promise<T> {
    const resolved = await this.resolve(key);
    return resolved.value as T;
  }

  /**
   * Get a boolean feature flag (convenience method)
   */
  async isEnabled(key: string): Promise<boolean> {
    const value = await this.get(key);
    return Boolean(value);
  }

  /**
   * Get a numeric feature flag (convenience method)
   */
  async getNumber(key: string): Promise<number> {
    const value = await this.get(key);
    return Number(value);
  }

  /**
   * Resolve a flag with full source information
   */
  async resolve(key: string): Promise<ResolvedFlag> {
    const definition = getFlagDefinition(key);
    if (!definition) {
      throw new Error(`Unknown feature flag: ${key}`);
    }

    const sources = await this.getSources(key, definition);

    return {
      key,
      value: sources.resolved,
      type: definition.type,
      source: sources.source,
      description: definition.description,
      category: definition.category,
    };
  }

  /**
   * Get all values from all sources for a flag
   */
  async getSources(key: string, definition?: FlagDefinition): Promise<FlagSources> {
    const def = definition || getFlagDefinition(key);
    if (!def) {
      throw new Error(`Unknown feature flag: ${key}`);
    }

    // Get value from each source
    const envValue = this.getFromEnv(key, def);
    const fileValue = this.getFromFile(key, def);
    const dbValue = await this.getFromDatabase(key, def);

    // Resolve with priority: Database > File > Environment > Default
    let resolved = def.defaultValue;
    let source: FlagSource = 'default';

    if (envValue !== undefined) {
      resolved = envValue;
      source = 'env';
    }
    if (fileValue !== undefined) {
      resolved = fileValue;
      source = 'file';
    }
    if (dbValue !== undefined) {
      resolved = dbValue;
      source = 'database';
    }

    return {
      env: envValue,
      file: fileValue,
      database: dbValue,
      default: def.defaultValue,
      resolved,
      source,
    };
  }

  /**
   * Get all flags with their resolved values
   */
  async getAllFlags(): Promise<ResolvedFlag[]> {
    const keys = getAllFlagKeys();
    const results: ResolvedFlag[] = [];

    for (const key of keys) {
      results.push(await this.resolve(key));
    }

    return results;
  }

  /**
   * Get only flags marked as exposeToClient (for UI consumption)
   * Returns a simple key-value map for easy frontend usage
   */
  async getClientFlags(): Promise<Record<string, FlagValue>> {
    const keys = getClientExposedFlagKeys();
    const result: Record<string, FlagValue> = {};

    for (const key of keys) {
      result[key] = await this.get(key);
    }

    return result;
  }

  /**
   * Get all flags grouped by category
   */
  async getFlagsByCategory(): Promise<Record<string, ResolvedFlag[]>> {
    const flags = await this.getAllFlags();
    const grouped: Record<string, ResolvedFlag[]> = {};

    for (const flag of flags) {
      if (!grouped[flag.category]) {
        grouped[flag.category] = [];
      }
      grouped[flag.category].push(flag);
    }

    return grouped;
  }

  /**
   * Set a flag value in the database (creates override)
   */
  async setFlag(
    key: string,
    value: boolean | string | number | object,
    enabled = true,
  ): Promise<FeatureFlag> {
    if (!isValidFlagKey(key)) {
      throw new Error(`Unknown feature flag: ${key}`);
    }

    const definition = getFlagDefinition(key)!;
    const stringValue = this.serializeValue(value, definition.type);

    // Upsert the flag
    const existing = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);

    let result: FeatureFlag;

    if (existing.length > 0) {
      const [updated] = await db
        .update(featureFlags)
        .set({
          value: stringValue,
          valueType: definition.type,
          enabled,
          updatedAt: new Date(),
        })
        .where(eq(featureFlags.key, key))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db
        .insert(featureFlags)
        .values({
          key,
          value: stringValue,
          valueType: definition.type,
          description: definition.description,
          enabled,
        })
        .returning();
      result = inserted;
    }

    // Invalidate cache
    this.dbCache.set(key, result);

    this.logger.log(`Feature flag ${key} set to ${stringValue} (enabled: ${enabled})`);
    return result;
  }

  /**
   * Set multiple flags at once
   */
  async setFlags(
    flags: Array<{ key: string; value: boolean | string | number | object; enabled?: boolean }>,
  ): Promise<FeatureFlag[]> {
    const results: FeatureFlag[] = [];
    for (const flag of flags) {
      results.push(await this.setFlag(flag.key, flag.value, flag.enabled ?? true));
    }
    return results;
  }

  /**
   * Delete a database override (falls back to file/env/default)
   */
  async deleteFlag(key: string): Promise<boolean> {
    const result = await db.delete(featureFlags).where(eq(featureFlags.key, key)).returning();

    if (result.length > 0) {
      this.dbCache.delete(key);
      this.logger.log(`Feature flag ${key} database override deleted`);
      return true;
    }

    return false;
  }

  /**
   * Get all database overrides
   */
  async getDatabaseOverrides(): Promise<FeatureFlag[]> {
    return db.select().from(featureFlags);
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  private getFromEnv(_key: string, definition: FlagDefinition): FlagValue | undefined {
    const envValue = this.configService.get<string>(definition.envKey);
    if (envValue === undefined || envValue === '') {
      return undefined;
    }
    return this.parseValue(envValue, definition.type);
  }

  private getFromFile(key: string, definition: FlagDefinition): FlagValue | undefined {
    if (!this.fileConfig) {
      return undefined;
    }

    // Check both the flag key and the env key in the file
    const value = this.fileConfig[key] ?? this.fileConfig[definition.envKey];
    if (value === undefined) {
      return undefined;
    }

    // File values might already be typed correctly from JSON
    if (typeof value === definition.type) {
      return value;
    }

    return this.parseValue(String(value), definition.type);
  }

  private async getFromDatabase(
    key: string,
    _definition: FlagDefinition,
  ): Promise<FlagValue | undefined> {
    await this.ensureDbCacheFresh();

    const flag = this.dbCache.get(key);
    if (!flag || !flag.enabled) {
      return undefined;
    }

    return this.parseValue(flag.value, flag.valueType as FlagType);
  }

  private loadFileConfig(): void {
    const absolutePath = path.isAbsolute(this.configFilePath)
      ? this.configFilePath
      : path.join(process.cwd(), this.configFilePath);

    try {
      if (fs.existsSync(absolutePath)) {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        this.fileConfig = JSON.parse(content);
        this.logger.log(`Loaded feature flags from ${absolutePath}`);
      } else {
        this.logger.debug(`No feature flags config file found at ${absolutePath}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to load feature flags config file: ${error}`);
      this.fileConfig = null;
    }
  }

  /**
   * Reload file config (useful for file watching or manual refresh)
   */
  reloadFileConfig(): void {
    this.loadFileConfig();
  }

  private async refreshDbCache(): Promise<void> {
    try {
      const flags = await db.select().from(featureFlags);
      this.dbCache.clear();
      for (const flag of flags) {
        this.dbCache.set(flag.key, flag);
      }
      this.lastDbCacheTime = Date.now();
    } catch (error) {
      // Database might not be ready yet during startup
      this.logger.debug(`Could not refresh feature flags from database: ${error}`);
    }
  }

  private async ensureDbCacheFresh(): Promise<void> {
    if (Date.now() - this.lastDbCacheTime > this.cacheTtl) {
      await this.refreshDbCache();
    }
  }

  /**
   * Invalidate all caches (forces fresh reads)
   */
  async invalidateCache(): Promise<void> {
    this.loadFileConfig();
    await this.refreshDbCache();
    this.logger.log('Feature flags cache invalidated');
  }

  private parseValue(value: string, type: FlagType): FlagValue {
    switch (type) {
      case 'boolean':
        return value === 'true' || value === '1' || value === 'yes';
      case 'number':
        return Number(value);
      case 'json':
        try {
          return JSON.parse(value) as object;
        } catch {
          return {};
        }
      case 'string':
      default:
        return value;
    }
  }

  private serializeValue(value: FlagValue, type: FlagType): string {
    switch (type) {
      case 'boolean':
        return String(value);
      case 'number':
        return String(value);
      case 'json':
        return JSON.stringify(value);
      case 'string':
      default:
        return String(value);
    }
  }
}
