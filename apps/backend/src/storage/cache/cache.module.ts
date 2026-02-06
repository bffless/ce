import { Module, DynamicModule, Provider, Logger } from '@nestjs/common';
import { CACHE_ADAPTER, CacheConfig, ICacheAdapter } from './cache.interface';
import { MemoryCacheAdapter } from './memory-cache.adapter';
import { RedisCacheAdapter } from './redis-cache.adapter';
import { MetadataCacheService } from './metadata-cache.service';

/**
 * Cache Module - Provides cache adapters (Memory LRU or Redis)
 *
 * NOTE: CacheController is registered in StorageModule because it needs
 * access to DYNAMIC_STORAGE_ADAPTER to get the actual cache adapter
 * being used by the storage layer.
 */
@Module({})
export class CacheModule {
  private static readonly logger = new Logger('CacheModule');

  static forRoot(config: CacheConfig): DynamicModule {
    const cacheProvider: Provider = {
      provide: CACHE_ADAPTER,
      useFactory: (): ICacheAdapter => {
        return CacheModule.createAdapter(config);
      },
    };

    return {
      module: CacheModule,
      providers: [cacheProvider, MetadataCacheService],
      exports: [CACHE_ADAPTER, MetadataCacheService],
      global: true,
    };
  }

  static forRootAsync(options: {
    imports?: any[];
    useFactory: (...args: any[]) => Promise<CacheConfig> | CacheConfig;
    inject?: any[];
  }): DynamicModule {
    const cacheProvider: Provider = {
      provide: CACHE_ADAPTER,
      useFactory: async (...args: any[]): Promise<ICacheAdapter> => {
        const config = await options.useFactory(...args);
        return CacheModule.createAdapter(config);
      },
      inject: options.inject || [],
    };

    return {
      module: CacheModule,
      imports: options.imports || [],
      providers: [cacheProvider, MetadataCacheService],
      exports: [CACHE_ADAPTER, MetadataCacheService],
      global: true,
    };
  }

  /**
   * Factory method to create the appropriate cache adapter
   */
  static createAdapter(config: CacheConfig): ICacheAdapter {
    // If caching is disabled, return a no-op adapter
    if (config.enabled === false) {
      CacheModule.logger.log('Caching disabled, using no-op adapter');
      return new NoOpCacheAdapter();
    }

    if (config.type === 'redis' && config.redis) {
      CacheModule.logger.log(
        `Creating Redis cache adapter: host=${config.redis.host}, port=${config.redis.port}, hasPassword=${!!config.redis.password}`,
      );
      return new RedisCacheAdapter(config);
    }

    CacheModule.logger.log('Creating Memory cache adapter');
    return new MemoryCacheAdapter(config);
  }
}

/**
 * No-op cache adapter for when caching is disabled
 */
class NoOpCacheAdapter implements ICacheAdapter {
  async get(): Promise<Buffer | null> {
    return null;
  }

  async set(): Promise<void> {
    // No-op
  }

  async delete(): Promise<void> {
    // No-op
  }

  async deleteByPrefix(): Promise<number> {
    return 0;
  }

  async has(): Promise<boolean> {
    return false;
  }

  getStats() {
    return {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      maxSize: 0,
      itemCount: 0,
    };
  }

  async clear(): Promise<void> {
    // No-op
  }
}
