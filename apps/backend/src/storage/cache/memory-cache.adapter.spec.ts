import { MemoryCacheAdapter } from './memory-cache.adapter';

describe('MemoryCacheAdapter', () => {
  let cache: MemoryCacheAdapter;

  beforeEach(() => {
    cache = new MemoryCacheAdapter({
      type: 'memory',
      maxSize: 1024 * 1024, // 1MB
      maxItems: 100,
      defaultTtl: 60,
      maxFileSize: 100 * 1024, // 100KB
    });
  });

  describe('get/set', () => {
    it('should store and retrieve data', async () => {
      const data = Buffer.from('test data');
      await cache.set('key1', data);

      const result = await cache.get('key1');
      expect(result?.toString()).toBe('test data');
    });

    it('should return null for missing key', async () => {
      const result = await cache.get('missing');
      expect(result).toBeNull();
    });

    it('should skip large files', async () => {
      const largeData = Buffer.alloc(200 * 1024); // 200KB, larger than maxFileSize
      await cache.set('large', largeData);

      const result = await cache.get('large');
      expect(result).toBeNull();
    });

    it('should respect custom TTL', async () => {
      const data = Buffer.from('ttl test');
      await cache.set('ttl-key', data, 1); // 1 second TTL

      // Should exist immediately
      const result1 = await cache.get('ttl-key');
      expect(result1?.toString()).toBe('ttl test');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result2 = await cache.get('ttl-key');
      expect(result2).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete key', async () => {
      await cache.set('key1', Buffer.from('test'));
      await cache.delete('key1');

      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(cache.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('deleteByPrefix', () => {
    it('should delete keys matching prefix', async () => {
      await cache.set('prefix/key1', Buffer.from('1'));
      await cache.set('prefix/key2', Buffer.from('2'));
      await cache.set('other/key3', Buffer.from('3'));

      const deleted = await cache.deleteByPrefix('prefix/');

      expect(deleted).toBe(2);
      expect(await cache.get('prefix/key1')).toBeNull();
      expect(await cache.get('prefix/key2')).toBeNull();
      expect(await cache.get('other/key3')).not.toBeNull();
    });

    it('should return 0 when no keys match prefix', async () => {
      await cache.set('key1', Buffer.from('test'));

      const deleted = await cache.deleteByPrefix('nonexistent/');
      expect(deleted).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing key', async () => {
      await cache.set('key1', Buffer.from('test'));
      const exists = await cache.has('key1');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const exists = await cache.has('missing');
      expect(exists).toBe(false);
    });
  });

  describe('stats', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', Buffer.from('test'));

      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should track item count', async () => {
      await cache.set('key1', Buffer.from('1'));
      await cache.set('key2', Buffer.from('2'));

      const stats = cache.getStats();
      expect(stats.itemCount).toBe(2);
    });

    it('should track size', async () => {
      const data = Buffer.from('12345'); // 5 bytes
      await cache.set('key1', data);

      const stats = cache.getStats();
      expect(stats.size).toBe(5);
    });
  });

  describe('clear', () => {
    it('should clear all items', async () => {
      await cache.set('key1', Buffer.from('1'));
      await cache.set('key2', Buffer.from('2'));

      await cache.clear();

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });

    it('should reset stats', async () => {
      await cache.set('key1', Buffer.from('test'));
      await cache.get('key1'); // hit

      await cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.itemCount).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used items when maxItems exceeded', async () => {
      const smallCache = new MemoryCacheAdapter({
        type: 'memory',
        maxItems: 3,
        maxSize: 1024 * 1024,
        maxFileSize: 1024 * 1024,
      });

      await smallCache.set('key1', Buffer.from('1'));
      await smallCache.set('key2', Buffer.from('2'));
      await smallCache.set('key3', Buffer.from('3'));

      // Access key1 to make it recently used
      await smallCache.get('key1');

      // Add a new item, should evict key2 (least recently used)
      await smallCache.set('key4', Buffer.from('4'));

      expect(await smallCache.get('key1')).not.toBeNull();
      expect(await smallCache.get('key2')).toBeNull(); // Evicted
      expect(await smallCache.get('key3')).not.toBeNull();
      expect(await smallCache.get('key4')).not.toBeNull();
    });
  });
});
