import { Injectable, Logger } from '@nestjs/common';
import { IStorageAdapter, FileMetadata, DownloadResult } from '../storage.interface';
import { ICacheAdapter, CacheConfig } from './cache.interface';

/**
 * Caching wrapper for storage adapters
 *
 * Decorates any IStorageAdapter with caching functionality.
 * Uses the decorator pattern to add caching transparently.
 */
@Injectable()
export class CachingStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(CachingStorageAdapter.name);

  constructor(
    private readonly storage: IStorageAdapter,
    private readonly cache: ICacheAdapter,
    private readonly config: CacheConfig,
  ) {
    this.logger.log('Initialized CachingStorageAdapter');
  }

  /**
   * Get the wrapped storage adapter
   * Used for unwrapping when cache config changes
   */
  getWrappedAdapter(): IStorageAdapter {
    return this.storage;
  }

  /**
   * Get the cache adapter
   * Used for reusing the cache adapter when rewrapping
   */
  getCacheAdapter(): ICacheAdapter {
    return this.cache;
  }

  /**
   * Upload with cache invalidation
   */
  async upload(file: Buffer, key: string, metadata?: Record<string, string>): Promise<string> {
    // Upload to storage
    const result = await this.storage.upload(file, key, metadata);

    // Invalidate any cached version
    const cacheKey = this.getCacheKey(key);
    await this.cache.delete(cacheKey);

    // Optionally pre-populate cache
    const ttl = this.getTtlForMimeType(metadata?.mimeType);
    await this.cache.set(cacheKey, file, ttl);

    return result;
  }

  /**
   * Download with caching
   */
  async download(key: string): Promise<Buffer> {
    const result = await this.downloadWithCacheInfo(key);
    return result.data;
  }

  /**
   * Download with caching and return cache hit information
   * Used for analytics to track cache effectiveness
   *
   * @param key Storage key to download
   * @param ttlHint Optional TTL hint from cache rules (takes precedence over MIME-type-based TTL)
   */
  async downloadWithCacheInfo(key: string, ttlHint?: number): Promise<DownloadResult> {
    const cacheKey = this.getCacheKey(key);

    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      // Determine cache type (memory or redis)
      const cacheHit = this.cache.cacheType ?? 'memory';
      return { data: cached, cacheHit };
    }

    // Cache miss - fetch from storage
    const data = await this.storage.download(key);

    // Determine TTL: use hint from cache rules, or fall back to MIME-type-based TTL
    let ttl: number;
    if (ttlHint !== undefined) {
      ttl = ttlHint;
    } else {
      ttl = this.config.defaultTtl ?? 86400;
      try {
        const metadata = await this.storage.getMetadata(key);
        ttl = this.getTtlForMimeType(metadata.mimeType);
      } catch {
        // Use default TTL if metadata fetch fails
      }
    }

    // Store in cache
    await this.cache.set(cacheKey, data, ttl);

    return { data, cacheHit: 'miss' };
  }

  /**
   * Delete with cache invalidation
   */
  async delete(key: string): Promise<void> {
    // Delete from storage
    await this.storage.delete(key);

    // Invalidate cache
    const cacheKey = this.getCacheKey(key);
    await this.cache.delete(cacheKey);
  }

  /**
   * Exists check (doesn't cache, fast operation)
   */
  async exists(key: string): Promise<boolean> {
    // Check cache first (instant)
    const cacheKey = this.getCacheKey(key);
    if (await this.cache.has(cacheKey)) {
      return true;
    }

    // Fall back to storage
    return this.storage.exists(key);
  }

  /**
   * Get URL (pass through, URLs are temporary)
   */
  async getUrl(key: string, expiresIn?: number): Promise<string> {
    return this.storage.getUrl(key, expiresIn);
  }

  /**
   * List keys (pass through, not cached)
   */
  async listKeys(prefix?: string): Promise<string[]> {
    return this.storage.listKeys(prefix);
  }

  /**
   * Get metadata (could cache, but usually fast)
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    return this.storage.getMetadata(key);
  }

  /**
   * Test connection (pass through)
   */
  async testConnection(): Promise<boolean> {
    return this.storage.testConnection();
  }

  /**
   * Delete all files with prefix (with cache invalidation)
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    // Delete from storage
    const result = await this.storage.deletePrefix(prefix);

    // Invalidate cache for the prefix
    const cachePrefix = this.getCacheKey(prefix);
    await this.cache.deleteByPrefix(cachePrefix);

    return result;
  }

  /**
   * Invalidate cache for a deployment
   * Call this when a deployment is updated
   */
  async invalidateDeployment(owner: string, repo: string, commitSha: string): Promise<number> {
    const prefix = `cache:${owner}/${repo}/${commitSha}/`;
    return this.cache.deleteByPrefix(prefix);
  }

  /**
   * Invalidate entire project cache
   */
  async invalidateProject(owner: string, repo: string): Promise<number> {
    const prefix = `cache:${owner}/${repo}/`;
    return this.cache.deleteByPrefix(prefix);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear entire cache
   */
  async clearCache(): Promise<void> {
    return this.cache.clear();
  }

  /**
   * Generate cache key from storage key
   */
  private getCacheKey(storageKey: string): string {
    return `cache:${storageKey}`;
  }

  /**
   * Get TTL based on MIME type
   */
  private getTtlForMimeType(mimeType?: string): number {
    if (!mimeType) {
      return this.config.defaultTtl ?? 86400;
    }

    // Check custom TTL config
    if (this.config.ttlByMimeType?.[mimeType]) {
      return this.config.ttlByMimeType[mimeType];
    }

    // Default TTLs by content type
    // Cache keys include commit SHA, so content is immutable - safe for long TTLs
    if (mimeType.startsWith('text/html')) {
      return 300; // 5 minutes for HTML (has injected base tag)
    }
    if (mimeType.startsWith('text/css') || mimeType.includes('javascript')) {
      return 86400; // 24 hours for CSS/JS
    }
    if (mimeType.startsWith('image/')) {
      return 86400; // 24 hours for images
    }
    if (mimeType.startsWith('font/') || mimeType.includes('font')) {
      return 86400; // 24 hours for fonts
    }

    return this.config.defaultTtl ?? 86400;
  }
}
