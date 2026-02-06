/**
 * Cache adapter interface for storage caching
 */
export interface ICacheAdapter {
  /**
   * Cache type identifier for analytics
   * Used to track cache hit sources (memory vs redis)
   */
  readonly cacheType?: 'memory' | 'redis';

  /**
   * Get item from cache
   * @returns Buffer if found, null if miss
   */
  get(key: string): Promise<Buffer | null>;

  /**
   * Set item in cache
   * @param key Cache key
   * @param value Data to cache
   * @param ttlSeconds Time-to-live in seconds
   */
  set(key: string, value: Buffer, ttlSeconds?: number): Promise<void>;

  /**
   * Delete item from cache
   */
  delete(key: string): Promise<void>;

  /**
   * Delete all items matching prefix
   * Used for cache invalidation
   */
  deleteByPrefix(prefix: string): Promise<number>;

  /**
   * Check if key exists in cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Get cache statistics (synchronous, may use cached values)
   */
  getStats(): CacheStats;

  /**
   * Refresh stats from backend (async, queries actual data)
   * Optional - not all adapters need this
   */
  refreshStats?(): Promise<CacheStats>;

  /**
   * Clear entire cache
   */
  clear(): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  itemCount: number;
}

export interface CacheConfig {
  /**
   * Enable caching
   */
  enabled?: boolean;

  /**
   * Cache backend type
   */
  type: 'memory' | 'redis';

  /**
   * Redis source: local Docker, external provider, or platform-managed
   * Only relevant when type is 'redis'
   */
  redisSource?: 'local' | 'external' | 'managed';

  /**
   * Default TTL in seconds
   * Default: 3600 (1 hour)
   */
  defaultTtl?: number;

  /**
   * Maximum cache size in bytes (memory cache only)
   * Default: 100MB
   */
  maxSize?: number;

  /**
   * Maximum number of items (memory cache only)
   * Default: 10000
   */
  maxItems?: number;

  /**
   * Maximum file size to cache (skip larger files)
   * Default: 10MB
   */
  maxFileSize?: number;

  /**
   * Redis configuration (redis cache only)
   */
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };

  /**
   * File type specific TTLs
   */
  ttlByMimeType?: Record<string, number>;
}

/**
 * Injection token for cache adapter
 */
export const CACHE_ADAPTER = 'CACHE_ADAPTER';
