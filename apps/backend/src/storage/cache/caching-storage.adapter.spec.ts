import { CachingStorageAdapter } from './caching-storage.adapter';
import { IStorageAdapter, FileMetadata } from '../storage.interface';
import { ICacheAdapter, CacheStats } from './cache.interface';

describe('CachingStorageAdapter', () => {
  let cachingAdapter: CachingStorageAdapter;
  let mockStorage: jest.Mocked<IStorageAdapter>;
  let mockCache: jest.Mocked<ICacheAdapter>;

  beforeEach(() => {
    mockStorage = {
      upload: jest.fn().mockResolvedValue('key'),
      download: jest.fn().mockResolvedValue(Buffer.from('data')),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getUrl: jest.fn().mockResolvedValue('http://url'),
      listKeys: jest.fn().mockResolvedValue(['key1', 'key2']),
      getMetadata: jest.fn().mockResolvedValue({
        key: 'key',
        size: 100,
        mimeType: 'text/plain',
        lastModified: new Date(),
      } as FileMetadata),
      testConnection: jest.fn().mockResolvedValue(true),
      deletePrefix: jest.fn().mockResolvedValue({ deleted: 3, failed: [] }),
    };

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByPrefix: jest.fn().mockResolvedValue(5),
      has: jest.fn().mockResolvedValue(false),
      getStats: jest.fn().mockReturnValue({
        hits: 0,
        misses: 0,
        hitRate: 0,
        size: 0,
        maxSize: 0,
        itemCount: 0,
      } as CacheStats),
      clear: jest.fn().mockResolvedValue(undefined),
    };

    cachingAdapter = new CachingStorageAdapter(mockStorage, mockCache, {
      type: 'memory',
      defaultTtl: 3600,
    });
  });

  describe('download', () => {
    it('should return cached data on hit', async () => {
      const cachedData = Buffer.from('cached');
      mockCache.get.mockResolvedValueOnce(cachedData);

      const result = await cachingAdapter.download('key');

      expect(result).toBe(cachedData);
      expect(mockStorage.download).not.toHaveBeenCalled();
    });

    it('should fetch and cache on miss', async () => {
      mockCache.get.mockResolvedValueOnce(null);

      const result = await cachingAdapter.download('key');

      expect(mockStorage.download).toHaveBeenCalledWith('key');
      expect(mockCache.set).toHaveBeenCalled();
      expect(result.toString()).toBe('data');
    });

    it('should use MIME-type based TTL when caching', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'text/html',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('key');

      expect(mockCache.set).toHaveBeenCalledWith(
        'cache:key',
        expect.any(Buffer),
        300, // HTML gets 5 minute TTL
      );
    });

    it('should use default TTL when metadata fetch fails', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockRejectedValueOnce(new Error('Not found'));

      await cachingAdapter.download('key');

      expect(mockCache.set).toHaveBeenCalledWith(
        'cache:key',
        expect.any(Buffer),
        3600, // Default TTL
      );
    });
  });

  describe('upload', () => {
    it('should upload to storage and invalidate cache', async () => {
      const data = Buffer.from('new data');
      await cachingAdapter.upload(data, 'key', { mimeType: 'text/plain' });

      expect(mockStorage.upload).toHaveBeenCalledWith(data, 'key', { mimeType: 'text/plain' });
      expect(mockCache.delete).toHaveBeenCalledWith('cache:key');
    });

    it('should pre-populate cache after upload', async () => {
      const data = Buffer.from('new data');
      await cachingAdapter.upload(data, 'key', { mimeType: 'text/plain' });

      expect(mockCache.set).toHaveBeenCalledWith('cache:key', data, expect.any(Number));
    });

    it('should use MIME-type based TTL for pre-population', async () => {
      const data = Buffer.from('new data');
      await cachingAdapter.upload(data, 'key', { mimeType: 'image/png' });

      expect(mockCache.set).toHaveBeenCalledWith(
        'cache:key',
        data,
        86400, // Image TTL (24 hours)
      );
    });
  });

  describe('delete', () => {
    it('should delete from storage and cache', async () => {
      await cachingAdapter.delete('key');

      expect(mockStorage.delete).toHaveBeenCalledWith('key');
      expect(mockCache.delete).toHaveBeenCalledWith('cache:key');
    });
  });

  describe('exists', () => {
    it('should return true if in cache', async () => {
      mockCache.has.mockResolvedValueOnce(true);

      const result = await cachingAdapter.exists('key');

      expect(result).toBe(true);
      expect(mockStorage.exists).not.toHaveBeenCalled();
    });

    it('should check storage if not in cache', async () => {
      mockCache.has.mockResolvedValueOnce(false);
      mockStorage.exists.mockResolvedValueOnce(true);

      const result = await cachingAdapter.exists('key');

      expect(result).toBe(true);
      expect(mockStorage.exists).toHaveBeenCalledWith('key');
    });
  });

  describe('pass-through methods', () => {
    it('should pass getUrl to storage', async () => {
      await cachingAdapter.getUrl('key', 3600);
      expect(mockStorage.getUrl).toHaveBeenCalledWith('key', 3600);
    });

    it('should pass listKeys to storage', async () => {
      await cachingAdapter.listKeys('prefix/');
      expect(mockStorage.listKeys).toHaveBeenCalledWith('prefix/');
    });

    it('should pass getMetadata to storage', async () => {
      await cachingAdapter.getMetadata('key');
      expect(mockStorage.getMetadata).toHaveBeenCalledWith('key');
    });

    it('should pass testConnection to storage', async () => {
      await cachingAdapter.testConnection();
      expect(mockStorage.testConnection).toHaveBeenCalled();
    });
  });

  describe('invalidateDeployment', () => {
    it('should delete all keys for deployment', async () => {
      const deleted = await cachingAdapter.invalidateDeployment('owner', 'repo', 'abc123');

      expect(mockCache.deleteByPrefix).toHaveBeenCalledWith('cache:owner/repo/abc123/');
      expect(deleted).toBe(5);
    });
  });

  describe('invalidateProject', () => {
    it('should delete all keys for project', async () => {
      const deleted = await cachingAdapter.invalidateProject('owner', 'repo');

      expect(mockCache.deleteByPrefix).toHaveBeenCalledWith('cache:owner/repo/');
      expect(deleted).toBe(5);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache stats', () => {
      const mockStats: CacheStats = {
        hits: 10,
        misses: 5,
        hitRate: 0.667,
        size: 1024,
        maxSize: 10240,
        itemCount: 15,
      };
      mockCache.getStats.mockReturnValueOnce(mockStats);

      const stats = cachingAdapter.getCacheStats();

      expect(stats).toEqual(mockStats);
    });
  });

  describe('clearCache', () => {
    it('should clear cache', async () => {
      await cachingAdapter.clearCache();
      expect(mockCache.clear).toHaveBeenCalled();
    });
  });

  describe('TTL by MIME type', () => {
    it('should return 300s for HTML', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'text/html',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('index.html');

      expect(mockCache.set).toHaveBeenCalledWith('cache:index.html', expect.any(Buffer), 300);
    });

    it('should return 86400s for CSS', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'text/css',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('style.css');

      expect(mockCache.set).toHaveBeenCalledWith('cache:style.css', expect.any(Buffer), 86400);
    });

    it('should return 86400s for JavaScript', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'application/javascript',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('app.js');

      expect(mockCache.set).toHaveBeenCalledWith('cache:app.js', expect.any(Buffer), 86400);
    });

    it('should return 86400s for images', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'image/png',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('image.png');

      expect(mockCache.set).toHaveBeenCalledWith('cache:image.png', expect.any(Buffer), 86400);
    });

    it('should return 86400s for fonts', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockStorage.getMetadata.mockResolvedValueOnce({
        key: 'key',
        size: 100,
        mimeType: 'font/woff2',
        lastModified: new Date(),
      } as FileMetadata);

      await cachingAdapter.download('font.woff2');

      expect(mockCache.set).toHaveBeenCalledWith('cache:font.woff2', expect.any(Buffer), 86400);
    });
  });
});
