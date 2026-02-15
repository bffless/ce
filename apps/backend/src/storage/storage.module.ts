import { Module, DynamicModule, Global, Logger } from '@nestjs/common';
import { IStorageAdapter, STORAGE_ADAPTER } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';
import { MinioStorageAdapter } from './minio.adapter';
import { S3StorageAdapter } from './s3.adapter';
import { GcsStorageAdapter } from './gcs.adapter';
import { AzureBlobStorageAdapter } from './azure.adapter';
import { DynamicStorageAdapter } from './dynamic-storage.adapter';
import { FilesController } from './files.controller';
import { CacheController } from './cache/cache.controller';
import { CachingStorageAdapter } from './cache/caching-storage.adapter';
import { CACHE_ADAPTER, ICacheAdapter, CacheConfig } from './cache/cache.interface';

// Re-export STORAGE_ADAPTER for convenience
export { STORAGE_ADAPTER } from './storage.interface';

// Token for the DynamicStorageAdapter specifically (for type-safe injection)
export const DYNAMIC_STORAGE_ADAPTER = 'DYNAMIC_STORAGE_ADAPTER';

/**
 * Storage Module Factory Configuration
 */
export interface StorageModuleConfig {
  storageType: 'local' | 'minio' | 's3' | 'gcs' | 'azure';
  config: any;
  cacheConfig?: CacheConfig;
}

/**
 * Global Storage Module
 *
 * Provides dynamic storage adapter based on configuration.
 * Uses factory pattern to instantiate the correct adapter at runtime.
 */
@Global()
@Module({})
export class StorageModule {
  /**
   * Create a dynamic storage module with the specified configuration
   *
   * Usage:
   * ```typescript
   * StorageModule.forRoot({
   *   storageType: 'local',
   *   config: { localPath: './uploads' }
   * })
   * ```
   */
  static forRoot(config: StorageModuleConfig): DynamicModule {
    const storageProvider = {
      provide: STORAGE_ADAPTER,
      useFactory: (): IStorageAdapter => {
        return StorageModule.createAdapter(config);
      },
    };

    return {
      module: StorageModule,
      controllers: [FilesController, CacheController],
      providers: [storageProvider],
      exports: [STORAGE_ADAPTER],
    };
  }

  /**
   * Create a dynamic storage module that reads configuration from a service
   *
   * This is useful for reading storage config from database at runtime.
   * Uses DynamicStorageAdapter to allow runtime adapter swapping after setup.
   *
   * Usage:
   * ```typescript
   * StorageModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: async (configService: ConfigService) => {
   *     const config = await configService.getStorageConfig();
   *     return {
   *       storageType: config.type,
   *       config: config.settings
   *     };
   *   }
   * })
   * ```
   */
  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (...args: any[]) => Promise<StorageModuleConfig> | StorageModuleConfig;
  }): DynamicModule {
    const logger = new Logger('StorageModule');

    // Create a singleton DynamicStorageAdapter
    const dynamicAdapterProvider = {
      provide: DYNAMIC_STORAGE_ADAPTER,
      useFactory: async (
        cacheAdapter: ICacheAdapter | null,
        ...args: any[]
      ): Promise<DynamicStorageAdapter> => {
        const dynamicAdapter = new DynamicStorageAdapter();
        logger.log(
          `StorageModule factory created DynamicStorageAdapter [${dynamicAdapter.getInstanceId()}]`,
        );
        const config = await options.useFactory(...args);

        // Configure storage adapter with caching layer
        try {
          let adapter: IStorageAdapter = StorageModule.createAdapter(config);

          // Wrap with caching if cache adapter is available and cache is configured
          if (cacheAdapter && config.cacheConfig?.enabled !== false) {
            logger.log('Wrapping storage adapter with caching layer');
            adapter = new CachingStorageAdapter(
              adapter,
              cacheAdapter,
              config.cacheConfig || { type: 'memory' },
            );
          }

          dynamicAdapter.setAdapter(adapter);
          logger.log(`Storage configured at startup: ${config.storageType}`);
        } catch (error) {
          logger.error(`Failed to create storage adapter at startup: ${error}`);
          logger.warn('Falling back to default local storage');
        }

        return dynamicAdapter;
      },
      inject: [CACHE_ADAPTER, ...(options.inject || [])],
    };

    // Alias STORAGE_ADAPTER to DYNAMIC_STORAGE_ADAPTER for compatibility
    const storageAdapterProvider = {
      provide: STORAGE_ADAPTER,
      useFactory: (dynamicAdapter: DynamicStorageAdapter): IStorageAdapter => dynamicAdapter,
      inject: [DYNAMIC_STORAGE_ADAPTER],
    };

    return {
      module: StorageModule,
      imports: options.imports || [],
      controllers: [FilesController, CacheController],
      providers: [dynamicAdapterProvider, storageAdapterProvider],
      exports: [STORAGE_ADAPTER, DYNAMIC_STORAGE_ADAPTER],
    };
  }

  /**
   * Factory method to create the appropriate storage adapter
   * Public so it can be called from SetupService after configuration
   */
  static createAdapter(config: StorageModuleConfig): IStorageAdapter {
    switch (config.storageType) {
      case 'local':
        return new LocalStorageAdapter(config.config);

      case 'minio':
        return new MinioStorageAdapter(config.config);

      case 's3':
        return new S3StorageAdapter(config.config);

      case 'gcs':
        return new GcsStorageAdapter(config.config);

      case 'azure':
        return new AzureBlobStorageAdapter(config.config);

      default:
        throw new Error(`Unsupported storage type: ${config.storageType}`);
    }
  }
}
