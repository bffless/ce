import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ICacheAdapter } from './cache.interface';
import { CacheStatsResponseDto, ClearCacheResponseDto } from '../../setup/dto/cache-config.dto';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage.interface';
import { DynamicStorageAdapter } from '../dynamic-storage.adapter';
import { CachingStorageAdapter } from './caching-storage.adapter';

@ApiTags('Admin - Cache')
@Controller('api/admin/cache')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class CacheController {
  private readonly logger = new Logger(CacheController.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter) {}

  /**
   * Get the actual cache adapter being used by the storage layer
   */
  private getCacheAdapter(): ICacheAdapter | null {
    // The STORAGE_ADAPTER is actually a DynamicStorageAdapter in forRootAsync mode
    const dynamicAdapter = this.storageAdapter as DynamicStorageAdapter;
    if (typeof dynamicAdapter.getUnderlyingAdapter !== 'function') {
      // Not a DynamicStorageAdapter, check if it's directly a CachingStorageAdapter
      if (this.storageAdapter instanceof CachingStorageAdapter) {
        return this.storageAdapter.getCacheAdapter();
      }
      return null;
    }

    const underlyingAdapter = dynamicAdapter.getUnderlyingAdapter();
    if (underlyingAdapter instanceof CachingStorageAdapter) {
      return underlyingAdapter.getCacheAdapter();
    }
    return null;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  @ApiResponse({ status: 200, description: 'Cache statistics', type: CacheStatsResponseDto })
  async getCacheStats(): Promise<CacheStatsResponseDto> {
    const cacheAdapter = this.getCacheAdapter();
    if (!cacheAdapter) {
      return {
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0,
        maxSize: 0,
        itemCount: 0,
        formattedSize: '0 B',
      };
    }

    // Refresh stats from backend if available (e.g., Redis)
    const stats = cacheAdapter.refreshStats
      ? await cacheAdapter.refreshStats()
      : cacheAdapter.getStats();

    return {
      ...stats,
      formattedSize: this.formatBytes(stats.size),
    };
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all cached data' })
  @ApiResponse({ status: 200, description: 'Cache cleared', type: ClearCacheResponseDto })
  async clearCache(): Promise<ClearCacheResponseDto> {
    const cacheAdapter = this.getCacheAdapter();
    if (!cacheAdapter) {
      return { success: true, clearedItems: 0 };
    }

    const stats = cacheAdapter.getStats();
    await cacheAdapter.clear();
    this.logger.log(`Cache cleared: ${stats.itemCount} items removed`);
    return { success: true, clearedItems: stats.itemCount };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
}
