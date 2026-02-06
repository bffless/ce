import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ICacheAdapter, CacheStats, CacheConfig } from './cache.interface';

/**
 * Redis cache adapter for distributed caching
 *
 * Best for:
 * - Multi-instance deployments
 * - Persistent cache across restarts
 * - Shared cache between services
 *
 * Requirements:
 * - Redis server
 * - Network latency consideration
 */
@Injectable()
export class RedisCacheAdapter implements ICacheAdapter, OnModuleDestroy {
  readonly cacheType = 'redis' as const;
  private readonly logger = new Logger(RedisCacheAdapter.name);
  private readonly redis: Redis;
  private readonly config: CacheConfig;
  private readonly keyPrefix: string;
  private readonly statsKey: string;
  private cachedItemCount = 0;
  private cachedSize = 0;
  // Local counters for batching (flushed periodically)
  private localHits = 0;
  private localMisses = 0;

  constructor(config: CacheConfig) {
    this.config = config;

    if (!config.redis) {
      throw new Error('Redis configuration required for RedisCacheAdapter');
    }

    this.keyPrefix = config.redis.keyPrefix ?? 'storage:cache:';
    this.statsKey = '__cache_stats__'; // Special key for storing stats (no prefix)

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db ?? 0,
      keyPrefix: this.keyPrefix,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.error('Redis connection failed after 3 retries');
          return null; // Stop retrying
        }
        return Math.min(times * 1000, 3000);
      },
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis error:', err);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.logger.log(`Initialized RedisCacheAdapter: ${config.redis.host}:${config.redis.port}`);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const data = await this.redis.getBuffer(key);

      if (data) {
        // Increment hit counter in Redis (fire and forget for performance)
        this.redis.hincrby(this.statsKey, 'hits', 1).catch(() => {});
        this.localHits++;
        this.logger.debug(`Cache HIT: ${key}`);
        return data;
      }

      // Increment miss counter in Redis (fire and forget for performance)
      this.redis.hincrby(this.statsKey, 'misses', 1).catch(() => {});
      this.localMisses++;
      this.logger.debug(`Cache MISS: ${key}`);
      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis get error for ${key}: ${errorMessage}`);
      return null;
    }
  }

  async set(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    const size = value.length;

    // Skip if file is too large
    const maxFileSize = this.config.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    if (size > maxFileSize) {
      this.logger.debug(`Skipping cache for large file: ${key} (${size} bytes)`);
      return;
    }

    try {
      const ttl = ttlSeconds ?? this.config.defaultTtl ?? 86400;
      await this.redis.setex(key, ttl, value);
      this.logger.debug(`Cached: ${key} (${size} bytes, TTL: ${ttl}s)`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis set error for ${key}: ${errorMessage}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      this.logger.debug(`Deleted from cache: ${key}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis delete error for ${key}: ${errorMessage}`);
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    try {
      // Use SCAN to find matching keys (safer than KEYS in production)
      const fullPrefix = `${this.keyPrefix}${prefix}`;
      let deleted = 0;
      let cursor = '0';

      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${fullPrefix}*`,
          'COUNT',
          100,
        );
        cursor = newCursor;

        if (keys.length > 0) {
          // Remove prefix since Redis already has it
          const keysWithoutPrefix = keys.map((k) => k.replace(this.keyPrefix, ''));
          await this.redis.del(...keysWithoutPrefix);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      this.logger.debug(`Deleted ${deleted} items with prefix: ${prefix}`);
      return deleted;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis deleteByPrefix error: ${errorMessage}`);
      return 0;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis exists error for ${key}: ${errorMessage}`);
      return false;
    }
  }

  getStats(): CacheStats {
    // Return cached stats (use refreshStats for accurate data)
    const total = this.localHits + this.localMisses;
    return {
      hits: this.localHits,
      misses: this.localMisses,
      hitRate: total > 0 ? this.localHits / total : 0,
      size: this.cachedSize,
      maxSize: 0, // Redis handles memory management
      itemCount: this.cachedItemCount,
    };
  }

  /**
   * Fetch actual stats from Redis (async)
   * Call this periodically or on-demand to update cached stats
   */
  async refreshStats(): Promise<CacheStats> {
    try {
      // Get hit/miss counts from Redis (stored via HINCRBY)
      const statsData = await this.redis.hgetall(this.statsKey);
      const hits = parseInt(statsData.hits || '0', 10);
      const misses = parseInt(statsData.misses || '0', 10);
      const total = hits + misses;

      // Count keys with our prefix using SCAN
      let itemCount = 0;
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.keyPrefix}*`,
          'COUNT',
          1000,
        );
        cursor = newCursor;
        itemCount += keys.length;
      } while (cursor !== '0');

      // Get memory usage for our keys (sample-based estimate)
      // Use a separate Redis connection without keyPrefix for MEMORY USAGE command
      let totalSize = 0;
      if (itemCount > 0) {
        // Sample up to 100 keys for size estimation
        const sampleSize = Math.min(itemCount, 100);
        let sampled = 0;
        cursor = '0';

        sampleLoop: do {
          const [newCursor, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            `${this.keyPrefix}*`,
            'COUNT',
            100,
          );
          cursor = newCursor;

          for (const key of keys) {
            if (sampled >= sampleSize) break sampleLoop;
            try {
              // SCAN returns full keys (with prefix already included)
              // Use redis.call() to bypass ioredis keyPrefix handling
              const size = await this.redis.call('MEMORY', 'USAGE', key);
              if (size) totalSize += size as number;
              sampled++;
            } catch {
              // MEMORY command might not be available or key expired
            }
          }
        } while (cursor !== '0');

        // Extrapolate if we sampled
        if (sampled > 0 && sampled < itemCount) {
          totalSize = Math.round((totalSize / sampled) * itemCount);
        }
      }

      this.cachedItemCount = itemCount;
      this.cachedSize = totalSize;

      return {
        hits,
        misses,
        hitRate: total > 0 ? hits / total : 0,
        size: totalSize,
        maxSize: 0,
        itemCount,
      };
    } catch (error) {
      this.logger.error('Failed to refresh Redis stats:', error);
      return this.getStats();
    }
  }

  async clear(): Promise<void> {
    try {
      // Only clear keys with our prefix
      await this.deleteByPrefix('');
      // Reset stats in Redis
      await this.redis.del(this.statsKey);
      this.localHits = 0;
      this.localMisses = 0;
      this.cachedItemCount = 0;
      this.cachedSize = 0;
      this.logger.log('Cache cleared');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis clear error: ${errorMessage}`);
    }
  }

  /**
   * Test Redis connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
