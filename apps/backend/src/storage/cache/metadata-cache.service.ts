import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_ADAPTER, ICacheAdapter } from './cache.interface';

/**
 * Metadata Cache Service
 *
 * Provides JSON object caching using the existing cache adapter (Redis or Memory).
 * Used for caching database query results like project lookups and asset metadata
 * to reduce database roundtrips.
 *
 * Cache key patterns:
 * - project:{owner}:{repo} - Project metadata
 * - asset:{projectId}:{sha}:{path} - Asset metadata
 */
@Injectable()
export class MetadataCacheService {
  private readonly logger = new Logger(MetadataCacheService.name);
  private readonly defaultTtl = 300; // 5 minutes

  constructor(
    @Optional() @Inject(CACHE_ADAPTER) private readonly cacheAdapter: ICacheAdapter | null,
  ) {
    if (this.cacheAdapter) {
      this.logger.log(`MetadataCacheService initialized with ${this.cacheAdapter.cacheType ?? 'memory'} cache`);
    } else {
      this.logger.log('MetadataCacheService initialized without cache adapter (caching disabled)');
    }
  }

  /**
   * Check if caching is available
   */
  isEnabled(): boolean {
    return this.cacheAdapter !== null;
  }

  /**
   * Get cached JSON object
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.cacheAdapter) return null;

    try {
      const buffer = await this.cacheAdapter.get(key);
      if (!buffer) return null;

      const json = buffer.toString('utf-8');
      return JSON.parse(json) as T;
    } catch (error) {
      this.logger.debug(`Cache get failed for ${key}: ${error}`);
      return null;
    }
  }

  /**
   * Set cached JSON object
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.cacheAdapter) return;

    try {
      const json = JSON.stringify(value);
      const buffer = Buffer.from(json, 'utf-8');
      await this.cacheAdapter.set(key, buffer, ttlSeconds ?? this.defaultTtl);
    } catch (error) {
      this.logger.debug(`Cache set failed for ${key}: ${error}`);
    }
  }

  /**
   * Delete cached item
   */
  async delete(key: string): Promise<void> {
    if (!this.cacheAdapter) return;

    try {
      await this.cacheAdapter.delete(key);
    } catch (error) {
      this.logger.debug(`Cache delete failed for ${key}: ${error}`);
    }
  }

  /**
   * Delete all items matching prefix
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    if (!this.cacheAdapter) return 0;

    try {
      return await this.cacheAdapter.deleteByPrefix(prefix);
    } catch (error) {
      this.logger.debug(`Cache deleteByPrefix failed for ${prefix}: ${error}`);
      return 0;
    }
  }

  // ============================================================
  // Project-specific cache methods
  // ============================================================

  /**
   * Generate cache key for project lookup by owner/name
   */
  projectKey(owner: string, name: string): string {
    return `meta:project:${owner}:${name}`;
  }

  /**
   * Generate cache key for project lookup by ID
   */
  projectIdKey(projectId: string): string {
    return `meta:project:id:${projectId}`;
  }

  /**
   * Invalidate all cache entries for a project
   * Called on project update or delete
   */
  async invalidateProject(owner: string, name: string, projectId: string): Promise<void> {
    await Promise.all([
      this.delete(this.projectKey(owner, name)),
      this.delete(this.projectIdKey(projectId)),
    ]);
    this.logger.debug(`Invalidated project cache: ${owner}/${name} (${projectId})`);
  }

  // ============================================================
  // Asset-specific cache methods
  // ============================================================

  /**
   * Generate cache key for asset metadata lookup
   */
  assetKey(projectId: string, commitSha: string, publicPath: string): string {
    return `meta:asset:${projectId}:${commitSha}:${publicPath}`;
  }

  /**
   * Invalidate all asset cache entries for a deployment
   * Called on deployment delete or re-upload
   */
  async invalidateDeploymentAssets(projectId: string, commitSha: string): Promise<number> {
    const prefix = `meta:asset:${projectId}:${commitSha}:`;
    const count = await this.deleteByPrefix(prefix);
    this.logger.debug(`Invalidated ${count} asset cache entries for ${projectId}/${commitSha}`);
    return count;
  }

  /**
   * Invalidate all asset cache entries for a project
   * Called on project delete
   */
  async invalidateProjectAssets(projectId: string): Promise<number> {
    const prefix = `meta:asset:${projectId}:`;
    const count = await this.deleteByPrefix(prefix);
    this.logger.debug(`Invalidated ${count} asset cache entries for project ${projectId}`);
    return count;
  }
}
