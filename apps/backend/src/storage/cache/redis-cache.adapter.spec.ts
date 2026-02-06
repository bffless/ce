import { RedisCacheAdapter } from './redis-cache.adapter';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

describe('RedisCacheAdapter', () => {
  let cache: RedisCacheAdapter;
  let mockRedis: jest.Mocked<Redis>;
  let eventHandlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    eventHandlers = {};

    // Create mock Redis instance
    mockRedis = {
      getBuffer: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      scan: jest.fn(),
      hgetall: jest.fn(),
      hincrby: jest.fn().mockResolvedValue(1),
      call: jest.fn(),
      ping: jest.fn(),
      quit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
        return mockRedis;
      }),
    } as unknown as jest.Mocked<Redis>;

    (Redis as unknown as jest.Mock).mockImplementation(() => mockRedis);
  });

  describe('constructor', () => {
    it('should create adapter with valid config', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          keyPrefix: 'storage:cache:',
        }),
      );
    });

    it('should use custom keyPrefix', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
          keyPrefix: 'custom:prefix:',
        },
      });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          keyPrefix: 'custom:prefix:',
        }),
      );
    });

    it('should use password when provided', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
          password: 'secret',
        },
      });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'secret',
        }),
      );
    });

    it('should use custom db when provided', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
          db: 5,
        },
      });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          db: 5,
        }),
      );
    });

    it('should throw error without redis config', () => {
      expect(() => {
        new RedisCacheAdapter({
          type: 'redis',
        });
      }).toThrow('Redis configuration required for RedisCacheAdapter');
    });

    it('should register event handlers', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedis.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should handle connection error event', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      // Trigger error event
      const errorHandler = eventHandlers['error'];
      expect(() => errorHandler(new Error('Connection failed'))).not.toThrow();
    });

    it('should handle connect event', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      // Trigger connect event
      const connectHandler = eventHandlers['connect'];
      expect(() => connectHandler()).not.toThrow();
    });
  });

  describe('get', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should return data on cache hit', async () => {
      const data = Buffer.from('test data');
      mockRedis.getBuffer.mockResolvedValue(data);

      const result = await cache.get('key1');

      expect(result?.toString()).toBe('test data');
      expect(mockRedis.getBuffer).toHaveBeenCalledWith('key1');
      expect(mockRedis.hincrby).toHaveBeenCalledWith('__cache_stats__', 'hits', 1);
    });

    it('should return null on cache miss', async () => {
      mockRedis.getBuffer.mockResolvedValue(null);

      const result = await cache.get('missing');

      expect(result).toBeNull();
      expect(mockRedis.hincrby).toHaveBeenCalledWith('__cache_stats__', 'misses', 1);
    });

    it('should return null on error', async () => {
      mockRedis.getBuffer.mockRejectedValue(new Error('Redis error'));

      const result = await cache.get('key1');

      expect(result).toBeNull();
    });

    it('should handle non-Error thrown values', async () => {
      mockRedis.getBuffer.mockRejectedValue('string error');

      const result = await cache.get('key1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
        maxFileSize: 100 * 1024, // 100KB
        defaultTtl: 3600,
      });
    });

    it('should store data with default TTL', async () => {
      const data = Buffer.from('test data');
      mockRedis.setex.mockResolvedValue('OK');

      await cache.set('key1', data);

      expect(mockRedis.setex).toHaveBeenCalledWith('key1', 3600, data);
    });

    it('should store data with custom TTL', async () => {
      const data = Buffer.from('test data');
      mockRedis.setex.mockResolvedValue('OK');

      await cache.set('key1', data, 300);

      expect(mockRedis.setex).toHaveBeenCalledWith('key1', 300, data);
    });

    it('should skip large files', async () => {
      const largeData = Buffer.alloc(200 * 1024); // 200KB, larger than maxFileSize
      mockRedis.setex.mockResolvedValue('OK');

      await cache.set('large', largeData);

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('should handle set errors gracefully', async () => {
      const data = Buffer.from('test data');
      mockRedis.setex.mockRejectedValue(new Error('Redis error'));

      await expect(cache.set('key1', data)).resolves.not.toThrow();
    });

    it('should handle non-Error thrown values', async () => {
      const data = Buffer.from('test data');
      mockRedis.setex.mockRejectedValue('string error');

      await expect(cache.set('key1', data)).resolves.not.toThrow();
    });

    it('should use default maxFileSize if not configured', async () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      const data = Buffer.alloc(5 * 1024 * 1024); // 5MB
      mockRedis.setex.mockResolvedValue('OK');

      await cache.set('medium', data);

      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should delete key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await cache.delete('key1');

      expect(mockRedis.del).toHaveBeenCalledWith('key1');
    });

    it('should not throw when deleting non-existent key', async () => {
      mockRedis.del.mockResolvedValue(0);

      await expect(cache.delete('nonexistent')).resolves.not.toThrow();
    });

    it('should handle delete errors gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      await expect(cache.delete('key1')).resolves.not.toThrow();
    });

    it('should handle non-Error thrown values', async () => {
      mockRedis.del.mockRejectedValue('string error');

      await expect(cache.delete('key1')).resolves.not.toThrow();
    });
  });

  describe('deleteByPrefix', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should delete keys matching prefix', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['storage:cache:prefix/key1', 'storage:cache:prefix/key2']]);
      mockRedis.del.mockResolvedValue(2);

      const deleted = await cache.deleteByPrefix('prefix/');

      expect(deleted).toBe(2);
      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'storage:cache:prefix/*',
        'COUNT',
        100,
      );
    });

    it('should handle multiple scan iterations', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['123', ['storage:cache:prefix/key1']])
        .mockResolvedValueOnce(['0', ['storage:cache:prefix/key2']]);
      mockRedis.del.mockResolvedValue(1);

      const deleted = await cache.deleteByPrefix('prefix/');

      expect(deleted).toBe(2);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no keys match prefix', async () => {
      mockRedis.scan.mockResolvedValueOnce(['0', []]);

      const deleted = await cache.deleteByPrefix('nonexistent/');

      expect(deleted).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis error'));

      const deleted = await cache.deleteByPrefix('prefix/');

      expect(deleted).toBe(0);
    });

    it('should handle non-Error thrown values', async () => {
      mockRedis.scan.mockRejectedValue('string error');

      const deleted = await cache.deleteByPrefix('prefix/');

      expect(deleted).toBe(0);
    });
  });

  describe('has', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should return true for existing key', async () => {
      mockRedis.exists.mockResolvedValue(1);

      const exists = await cache.has('key1');

      expect(exists).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('key1');
    });

    it('should return false for non-existent key', async () => {
      mockRedis.exists.mockResolvedValue(0);

      const exists = await cache.has('missing');

      expect(exists).toBe(false);
    });

    it('should return false on error', async () => {
      mockRedis.exists.mockRejectedValue(new Error('Redis error'));

      const exists = await cache.has('key1');

      expect(exists).toBe(false);
    });

    it('should handle non-Error thrown values', async () => {
      mockRedis.exists.mockRejectedValue('string error');

      const exists = await cache.has('key1');

      expect(exists).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should return local stats', async () => {
      // Simulate hits and misses
      mockRedis.getBuffer.mockResolvedValueOnce(Buffer.from('data')); // hit
      mockRedis.getBuffer.mockResolvedValueOnce(Buffer.from('data')); // hit
      mockRedis.getBuffer.mockResolvedValueOnce(null); // miss

      await cache.get('key1');
      await cache.get('key2');
      await cache.get('missing');

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should return 0 hitRate when no requests', () => {
      const stats = cache.getStats();

      expect(stats.hitRate).toBe(0);
    });

    it('should return maxSize as 0 (Redis manages memory)', () => {
      const stats = cache.getStats();

      expect(stats.maxSize).toBe(0);
    });
  });

  describe('refreshStats', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should fetch stats from Redis', async () => {
      mockRedis.hgetall.mockResolvedValue({ hits: '100', misses: '20' });
      mockRedis.scan.mockResolvedValue(['0', []]);

      const stats = await cache.refreshStats();

      expect(stats.hits).toBe(100);
      expect(stats.misses).toBe(20);
      expect(stats.hitRate).toBeCloseTo(0.833, 2);
      expect(mockRedis.hgetall).toHaveBeenCalledWith('__cache_stats__');
    });

    it('should count items with prefix', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.scan
        .mockResolvedValueOnce(['123', ['storage:cache:k1', 'storage:cache:k2']])
        .mockResolvedValueOnce(['0', ['storage:cache:k3']])
        // Second scan for size estimation
        .mockResolvedValueOnce(['0', []]);

      const stats = await cache.refreshStats();

      expect(stats.itemCount).toBe(3);
    });

    it('should estimate memory usage', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['storage:cache:k1']])
        .mockResolvedValueOnce(['0', ['storage:cache:k1']]);
      mockRedis.call.mockResolvedValue(1024);

      const stats = await cache.refreshStats();

      expect(stats.size).toBe(1024);
    });

    it('should extrapolate size for large item counts', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      // First scan for count - 150 items total
      const keys150 = Array.from({ length: 150 }, (_, i) => `storage:cache:k${i}`);
      mockRedis.scan
        .mockResolvedValueOnce(['0', keys150])
        // Second scan for size sampling - 100 keys max
        .mockResolvedValueOnce(['0', keys150.slice(0, 100)]);
      mockRedis.call.mockResolvedValue(100); // 100 bytes per key

      const stats = await cache.refreshStats();

      // 100 sampled keys * 100 bytes = 10000 bytes
      // Extrapolated: (10000 / 100) * 150 = 15000 bytes
      expect(stats.size).toBe(15000);
    });

    it('should handle missing stats gracefully', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.scan.mockResolvedValue(['0', []]);

      const stats = await cache.refreshStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should handle MEMORY command failure', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['storage:cache:k1']])
        .mockResolvedValueOnce(['0', ['storage:cache:k1']]);
      mockRedis.call.mockRejectedValue(new Error('MEMORY command not supported'));

      const stats = await cache.refreshStats();

      expect(stats.size).toBe(0);
    });

    it('should return local stats on error', async () => {
      mockRedis.hgetall.mockRejectedValue(new Error('Redis error'));

      // Generate some local stats
      mockRedis.getBuffer.mockResolvedValue(Buffer.from('data'));
      await cache.get('key1');

      const stats = await cache.refreshStats();

      expect(stats.hits).toBe(1);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should clear all items with prefix', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);
      mockRedis.del.mockResolvedValue(1);

      await cache.clear();

      expect(mockRedis.del).toHaveBeenCalledWith('__cache_stats__');
    });

    it('should reset local stats', async () => {
      mockRedis.getBuffer.mockResolvedValue(Buffer.from('data'));
      await cache.get('key1');

      mockRedis.scan.mockResolvedValue(['0', []]);
      mockRedis.del.mockResolvedValue(1);

      await cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis error'));

      await expect(cache.clear()).resolves.not.toThrow();
    });

    it('should handle non-Error thrown values', async () => {
      mockRedis.scan.mockRejectedValue('string error');

      await expect(cache.clear()).resolves.not.toThrow();
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
    });

    it('should return true on successful ping', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await cache.testConnection();

      expect(result).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return false on ping failure', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));

      const result = await cache.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection', async () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });
      mockRedis.quit.mockResolvedValue('OK');

      await cache.onModuleDestroy();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  describe('retry strategy', () => {
    it('should use retry strategy that stops after 3 retries', () => {
      cache = new RedisCacheAdapter({
        type: 'redis',
        redis: {
          host: 'localhost',
          port: 6379,
        },
      });

      const redisConfig = (Redis as unknown as jest.Mock).mock.calls[0][0];
      const retryStrategy = redisConfig.retryStrategy;

      expect(retryStrategy(1)).toBe(1000);
      expect(retryStrategy(2)).toBe(2000);
      expect(retryStrategy(3)).toBe(3000);
      expect(retryStrategy(4)).toBeNull();
    });
  });
});
