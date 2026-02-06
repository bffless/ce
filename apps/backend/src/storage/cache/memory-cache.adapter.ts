import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { ICacheAdapter, CacheStats, CacheConfig } from './cache.interface';

interface CacheEntry {
  data: Buffer;
  size: number;
}

/**
 * In-memory LRU cache adapter
 *
 * Best for:
 * - Single-instance deployments
 * - Development environments
 * - Fast access requirements
 *
 * Limitations:
 * - Not shared across instances
 * - Lost on restart
 */
@Injectable()
export class MemoryCacheAdapter implements ICacheAdapter {
  readonly cacheType = 'memory' as const;
  private readonly logger = new Logger(MemoryCacheAdapter.name);
  private readonly cache: LRUCache<string, CacheEntry>;
  private readonly config: CacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config: CacheConfig) {
    this.config = config;

    const maxSize = config.maxSize ?? 100 * 1024 * 1024; // 100MB default
    const maxItems = config.maxItems ?? 10000;

    this.cache = new LRUCache<string, CacheEntry>({
      max: maxItems,
      maxSize,
      sizeCalculation: (entry) => entry.size,
      ttl: (config.defaultTtl ?? 86400) * 1000, // Convert to ms (default 24h)
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    this.logger.log(
      `Initialized MemoryCacheAdapter: maxSize=${this.formatBytes(maxSize)}, maxItems=${maxItems}`,
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const entry = this.cache.get(key);

    if (entry) {
      this.hits++;
      this.logger.debug(`Cache HIT: ${key}`);
      return entry.data;
    }

    this.misses++;
    this.logger.debug(`Cache MISS: ${key}`);
    return null;
  }

  async set(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    const size = value.length;

    // Skip if file is too large
    const maxFileSize = this.config.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    if (size > maxFileSize) {
      this.logger.debug(`Skipping cache for large file: ${key} (${this.formatBytes(size)})`);
      return;
    }

    const entry: CacheEntry = { data: value, size };

    if (ttlSeconds) {
      this.cache.set(key, entry, { ttl: ttlSeconds * 1000 });
    } else {
      this.cache.set(key, entry);
    }

    this.logger.debug(`Cached: ${key} (${this.formatBytes(size)})`);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.logger.debug(`Deleted from cache: ${key}`);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    this.logger.debug(`Deleted ${deleted} items with prefix: ${prefix}`);
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.calculatedSize ?? 0,
      maxSize: this.config.maxSize ?? 100 * 1024 * 1024,
      itemCount: this.cache.size,
    };
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.logger.log('Cache cleared');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
