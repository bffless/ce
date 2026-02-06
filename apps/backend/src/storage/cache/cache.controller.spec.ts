import { Test, TestingModule } from '@nestjs/testing';
import { CacheController } from './cache.controller';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage.interface';
import { CachingStorageAdapter } from './caching-storage.adapter';
import { ICacheAdapter, CacheStats } from './cache.interface';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';

describe('CacheController', () => {
  let controller: CacheController;
  let mockStorageAdapter: jest.Mocked<IStorageAdapter>;
  let mockCacheAdapter: jest.Mocked<ICacheAdapter>;

  // Mock guards
  const mockSessionAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const mockRolesGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const createMockCacheAdapter = (): jest.Mocked<ICacheAdapter> => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    deleteByPrefix: jest.fn(),
    has: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      hits: 100,
      misses: 20,
      hitRate: 0.833,
      size: 1024 * 1024,
      maxSize: 10 * 1024 * 1024,
      itemCount: 50,
    } as CacheStats),
    refreshStats: jest.fn().mockResolvedValue({
      hits: 100,
      misses: 20,
      hitRate: 0.833,
      size: 1024 * 1024,
      maxSize: 10 * 1024 * 1024,
      itemCount: 50,
    } as CacheStats),
    clear: jest.fn().mockResolvedValue(undefined),
  });

  /**
   * Create a mock CachingStorageAdapter that passes instanceof checks
   */
  const createMockCachingStorageAdapter = (cacheAdapter: ICacheAdapter) => {
    const mock = Object.create(CachingStorageAdapter.prototype);
    mock.getCacheAdapter = jest.fn().mockReturnValue(cacheAdapter);
    return mock as CachingStorageAdapter;
  };

  beforeEach(async () => {
    mockCacheAdapter = createMockCacheAdapter();
    mockStorageAdapter = {
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getUrl: jest.fn(),
      listKeys: jest.fn(),
      getMetadata: jest.fn(),
      testConnection: jest.fn(),
      deletePrefix: jest.fn(),
    } as jest.Mocked<IStorageAdapter>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [
        {
          provide: STORAGE_ADAPTER,
          useValue: mockStorageAdapter,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue(mockSessionAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<CacheController>(CacheController);
  });

  describe('getCacheStats', () => {
    it('should return empty stats when no cache adapter available', async () => {
      // Default mockStorageAdapter is not a DynamicStorageAdapter or CachingStorageAdapter
      const result = await controller.getCacheStats();

      expect(result).toEqual({
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0,
        maxSize: 0,
        itemCount: 0,
        formattedSize: '0 B',
      });
    });

    it('should return stats from DynamicStorageAdapter with CachingStorageAdapter', async () => {
      // Create a mock CachingStorageAdapter that passes instanceof
      const mockCachingAdapter = createMockCachingStorageAdapter(mockCacheAdapter);

      const mockDynamicAdapter = {
        getUnderlyingAdapter: jest.fn().mockReturnValue(mockCachingAdapter),
      };

      // Replace the injected adapter
      (controller as any).storageAdapter = mockDynamicAdapter;

      const result = await controller.getCacheStats();

      expect(result.hits).toBe(100);
      expect(result.misses).toBe(20);
      expect(result.hitRate).toBe(0.833);
      expect(result.itemCount).toBe(50);
      expect(result.formattedSize).toBe('1 MB');
    });

    it('should use getStats when refreshStats is not available', async () => {
      const cacheAdapterWithoutRefresh: ICacheAdapter = {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        deleteByPrefix: jest.fn(),
        has: jest.fn(),
        getStats: jest.fn().mockReturnValue({
          hits: 100,
          misses: 20,
          hitRate: 0.833,
          size: 1024 * 1024,
          maxSize: 10 * 1024 * 1024,
          itemCount: 50,
        } as CacheStats),
        clear: jest.fn(),
        // No refreshStats
      };

      const mockCachingAdapter = createMockCachingStorageAdapter(cacheAdapterWithoutRefresh);

      const mockDynamicAdapter = {
        getUnderlyingAdapter: jest.fn().mockReturnValue(mockCachingAdapter),
      };

      (controller as any).storageAdapter = mockDynamicAdapter;

      const result = await controller.getCacheStats();

      expect(result.hits).toBe(100);
      expect(cacheAdapterWithoutRefresh.getStats).toHaveBeenCalled();
    });

    it('should return stats from direct CachingStorageAdapter', async () => {
      // Create a mock CachingStorageAdapter that passes instanceof
      const mockCachingAdapter = createMockCachingStorageAdapter(mockCacheAdapter);

      (controller as any).storageAdapter = mockCachingAdapter;

      const result = await controller.getCacheStats();

      expect(result.hits).toBe(100);
      expect(result.formattedSize).toBe('1 MB');
    });

    it('should return empty stats when DynamicStorageAdapter has non-caching underlying adapter', async () => {
      const nonCachingAdapter = {
        upload: jest.fn(),
      } as unknown as IStorageAdapter;

      const mockDynamicAdapter = {
        getUnderlyingAdapter: jest.fn().mockReturnValue(nonCachingAdapter),
      };

      (controller as any).storageAdapter = mockDynamicAdapter;

      const result = await controller.getCacheStats();

      expect(result).toEqual({
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0,
        maxSize: 0,
        itemCount: 0,
        formattedSize: '0 B',
      });
    });
  });

  describe('clearCache', () => {
    it('should return success with 0 cleared items when no cache adapter available', async () => {
      const result = await controller.clearCache();

      expect(result).toEqual({
        success: true,
        clearedItems: 0,
      });
    });

    it('should clear cache and return item count', async () => {
      const mockCachingAdapter = createMockCachingStorageAdapter(mockCacheAdapter);

      const mockDynamicAdapter = {
        getUnderlyingAdapter: jest.fn().mockReturnValue(mockCachingAdapter),
      };

      (controller as any).storageAdapter = mockDynamicAdapter;

      const result = await controller.clearCache();

      expect(result.success).toBe(true);
      expect(result.clearedItems).toBe(50);
      expect(mockCacheAdapter.clear).toHaveBeenCalled();
    });
  });

  describe('formatBytes', () => {
    it('should format 0 bytes', async () => {
      const zeroCacheAdapter: ICacheAdapter = {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        deleteByPrefix: jest.fn(),
        has: jest.fn(),
        getStats: jest.fn(),
        refreshStats: jest.fn().mockResolvedValue({
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: 0,
          maxSize: 0,
          itemCount: 0,
        }),
        clear: jest.fn(),
      };

      const mockCachingAdapter = createMockCachingStorageAdapter(zeroCacheAdapter);
      const mockDynamicAdapter = {
        getUnderlyingAdapter: jest.fn().mockReturnValue(mockCachingAdapter),
      };

      (controller as any).storageAdapter = mockDynamicAdapter;

      const result = await controller.getCacheStats();
      expect(result.formattedSize).toBe('0 B');
    });

    it('should format bytes correctly', async () => {
      const testCases = [
        { size: 500, expected: '500 B' },
        { size: 1024, expected: '1 KB' },
        { size: 1536, expected: '1.5 KB' },
        { size: 1024 * 1024, expected: '1 MB' },
        { size: 1024 * 1024 * 1024, expected: '1 GB' },
      ];

      for (const testCase of testCases) {
        const sizedCacheAdapter: ICacheAdapter = {
          get: jest.fn(),
          set: jest.fn(),
          delete: jest.fn(),
          deleteByPrefix: jest.fn(),
          has: jest.fn(),
          getStats: jest.fn(),
          refreshStats: jest.fn().mockResolvedValue({
            hits: 0,
            misses: 0,
            hitRate: 0,
            size: testCase.size,
            maxSize: 0,
            itemCount: 0,
          }),
          clear: jest.fn(),
        };

        const mockCachingAdapter = createMockCachingStorageAdapter(sizedCacheAdapter);
        const mockDynamicAdapter = {
          getUnderlyingAdapter: jest.fn().mockReturnValue(mockCachingAdapter),
        };

        (controller as any).storageAdapter = mockDynamicAdapter;

        const result = await controller.getCacheStats();
        expect(result.formattedSize).toBe(testCase.expected);
      }
    });
  });
});
