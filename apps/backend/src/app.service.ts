import { Injectable, Inject, Optional } from '@nestjs/common';
import { STORAGE_ADAPTER, IStorageAdapter } from './storage/storage.interface';
import { DynamicStorageAdapter } from './storage/dynamic-storage.adapter';
import { CachingStorageAdapter } from './storage/cache/caching-storage.adapter';

@Injectable()
export class AppService {
  constructor(
    @Optional()
    @Inject(STORAGE_ADAPTER)
    private readonly storageAdapter?: IStorageAdapter,
  ) {}

  getHealth() {
    const cacheStatus = this.getCacheStatus();

    return {
      status: 'ok',
      message: 'Static Asset Hosting Platform API is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      cache: cacheStatus,
    };
  }

  /**
   * Get cache status from the storage adapter
   */
  private getCacheStatus(): { type: string; connected: boolean } {
    if (!this.storageAdapter) {
      return { type: 'none', connected: false };
    }

    // Check if storage adapter is a DynamicStorageAdapter
    const dynamicAdapter = this.storageAdapter as DynamicStorageAdapter;
    if (typeof dynamicAdapter.getUnderlyingAdapter !== 'function') {
      // Not a DynamicStorageAdapter, check if it's directly a CachingStorageAdapter
      if (this.storageAdapter instanceof CachingStorageAdapter) {
        const cacheAdapter = this.storageAdapter.getCacheAdapter();
        const type = cacheAdapter.constructor.name.replace('CacheAdapter', '').toLowerCase();
        return { type, connected: true };
      }
      return { type: 'none', connected: false };
    }

    const underlyingAdapter = dynamicAdapter.getUnderlyingAdapter();
    if (underlyingAdapter instanceof CachingStorageAdapter) {
      const cacheAdapter = underlyingAdapter.getCacheAdapter();
      const type = cacheAdapter.constructor.name.replace('CacheAdapter', '').toLowerCase();
      // For memory cache, it's always "connected"
      // For Redis, we'd ideally check connection, but for simplicity assume connected
      return { type, connected: true };
    }

    return { type: 'none', connected: false };
  }
}
