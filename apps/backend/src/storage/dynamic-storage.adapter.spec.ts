import { DynamicStorageAdapter } from './dynamic-storage.adapter';
import { IStorageAdapter, FileMetadata } from './storage.interface';

describe('DynamicStorageAdapter', () => {
  let adapter: DynamicStorageAdapter;

  beforeEach(() => {
    adapter = new DynamicStorageAdapter();
  });

  describe('constructor', () => {
    it('should initialize with default LocalStorageAdapter', () => {
      expect(adapter.getAdapterType()).toBe('LocalStorageAdapter');
    });

    it('should generate unique instance ID', () => {
      const adapter2 = new DynamicStorageAdapter();
      expect(adapter.getInstanceId()).not.toBe(adapter2.getInstanceId());
    });
  });

  describe('getInstanceId', () => {
    it('should return instance ID', () => {
      const id = adapter.getInstanceId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('setAdapter', () => {
    it('should swap to new adapter', () => {
      const mockAdapter: IStorageAdapter = {
        upload: jest.fn(),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getUrl: jest.fn(),
        listKeys: jest.fn(),
        getMetadata: jest.fn(),
        testConnection: jest.fn(),
        deletePrefix: jest.fn(),
      };
      // Give the mock a name by defining its constructor name
      Object.defineProperty(mockAdapter, 'constructor', {
        value: { name: 'MockAdapter' },
      });

      adapter.setAdapter(mockAdapter);

      expect(adapter.getAdapterType()).toBe('MockAdapter');
    });
  });

  describe('getAdapterType', () => {
    it('should return adapter type name', () => {
      expect(adapter.getAdapterType()).toBe('LocalStorageAdapter');
    });
  });

  describe('getUnderlyingAdapter', () => {
    it('should return the underlying adapter', () => {
      const underlying = adapter.getUnderlyingAdapter();
      expect(underlying.constructor.name).toBe('LocalStorageAdapter');
    });
  });

  describe('delegation methods', () => {
    let mockAdapter: jest.Mocked<IStorageAdapter>;

    beforeEach(() => {
      mockAdapter = {
        upload: jest.fn().mockResolvedValue('uploaded-key'),
        download: jest.fn().mockResolvedValue(Buffer.from('data')),
        delete: jest.fn().mockResolvedValue(undefined),
        exists: jest.fn().mockResolvedValue(true),
        getUrl: jest.fn().mockResolvedValue('https://example.com/file'),
        listKeys: jest.fn().mockResolvedValue(['key1', 'key2']),
        getMetadata: jest.fn().mockResolvedValue({
          key: 'test-key',
          size: 100,
          mimeType: 'text/plain',
          lastModified: new Date(),
        } as FileMetadata),
        testConnection: jest.fn().mockResolvedValue(true),
        deletePrefix: jest.fn().mockResolvedValue({ deleted: 5, failed: [] }),
      };
      adapter.setAdapter(mockAdapter);
    });

    describe('upload', () => {
      it('should delegate to underlying adapter', async () => {
        const file = Buffer.from('test file');
        const key = 'test/key.txt';
        const metadata = { custom: 'value' };

        const result = await adapter.upload(file, key, metadata);

        expect(result).toBe('uploaded-key');
        expect(mockAdapter.upload).toHaveBeenCalledWith(file, key, metadata);
      });
    });

    describe('download', () => {
      it('should delegate to underlying adapter', async () => {
        const key = 'test/key.txt';

        const result = await adapter.download(key);

        expect(result.toString()).toBe('data');
        expect(mockAdapter.download).toHaveBeenCalledWith(key);
      });
    });

    describe('delete', () => {
      it('should delegate to underlying adapter', async () => {
        const key = 'test/key.txt';

        await adapter.delete(key);

        expect(mockAdapter.delete).toHaveBeenCalledWith(key);
      });
    });

    describe('exists', () => {
      it('should delegate to underlying adapter', async () => {
        const key = 'test/key.txt';

        const result = await adapter.exists(key);

        expect(result).toBe(true);
        expect(mockAdapter.exists).toHaveBeenCalledWith(key);
      });
    });

    describe('getUrl', () => {
      it('should delegate to underlying adapter', async () => {
        const key = 'test/key.txt';
        const expiresIn = 3600;

        const result = await adapter.getUrl(key, expiresIn);

        expect(result).toBe('https://example.com/file');
        expect(mockAdapter.getUrl).toHaveBeenCalledWith(key, expiresIn, undefined);
      });

      it('should work without expiresIn parameter', async () => {
        const key = 'test/key.txt';

        await adapter.getUrl(key);

        expect(mockAdapter.getUrl).toHaveBeenCalledWith(key, undefined, undefined);
      });
    });

    describe('listKeys', () => {
      it('should delegate to underlying adapter', async () => {
        const prefix = 'test/';

        const result = await adapter.listKeys(prefix);

        expect(result).toEqual(['key1', 'key2']);
        expect(mockAdapter.listKeys).toHaveBeenCalledWith(prefix);
      });

      it('should work without prefix parameter', async () => {
        await adapter.listKeys();

        expect(mockAdapter.listKeys).toHaveBeenCalledWith(undefined);
      });
    });

    describe('getMetadata', () => {
      it('should delegate to underlying adapter', async () => {
        const key = 'test/key.txt';

        const result = await adapter.getMetadata(key);

        expect(result.key).toBe('test-key');
        expect(result.size).toBe(100);
        expect(mockAdapter.getMetadata).toHaveBeenCalledWith(key);
      });
    });

    describe('testConnection', () => {
      it('should delegate to underlying adapter', async () => {
        const result = await adapter.testConnection();

        expect(result).toBe(true);
        expect(mockAdapter.testConnection).toHaveBeenCalled();
      });
    });
  });

  describe('getUrl', () => {
    it('forwards signed URL options to the wrapped adapter', async () => {
      const inner = { getUrl: jest.fn().mockResolvedValue('https://signed') };
      (adapter as any).adapter = inner;

      await adapter.getUrl('a/b.mp4', 600, { downloadFilename: 'my-video.mp4' });

      expect(inner.getUrl).toHaveBeenCalledWith('a/b.mp4', 600, {
        downloadFilename: 'my-video.mp4',
      });
    });

    it('forwards undefined options unchanged', async () => {
      const inner = { getUrl: jest.fn().mockResolvedValue('https://signed') };
      (adapter as any).adapter = inner;

      await adapter.getUrl('a/b.mp4', 600);

      expect(inner.getUrl).toHaveBeenCalledWith('a/b.mp4', 600, undefined);
    });
  });

  describe('downloadStream', () => {
    it('should expose downloadStream and delegate when the active adapter supports streaming', async () => {
      const fakeStream = { pipe: jest.fn() } as unknown as NodeJS.ReadableStream;
      const streamResult = { stream: fakeStream, size: 1024 };
      const streamingAdapter: IStorageAdapter = {
        upload: jest.fn(),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getUrl: jest.fn(),
        listKeys: jest.fn(),
        getMetadata: jest.fn(),
        testConnection: jest.fn(),
        deletePrefix: jest.fn(),
        downloadStream: jest.fn().mockResolvedValue(streamResult),
      };
      adapter.setAdapter(streamingAdapter);

      // Capability detection (FileServeHandler does `if (storageAdapter.downloadStream)`)
      expect(typeof adapter.downloadStream).toBe('function');

      const result = await adapter.downloadStream!('videos/clip.mp4', { start: 0, end: 1023 });

      expect(result).toBe(streamResult);
      expect(streamingAdapter.downloadStream).toHaveBeenCalledWith('videos/clip.mp4', {
        start: 0,
        end: 1023,
      });
    });

    it('should report no streaming capability when the active adapter lacks downloadStream', () => {
      const bufferingAdapter: IStorageAdapter = {
        upload: jest.fn(),
        download: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        getUrl: jest.fn(),
        listKeys: jest.fn(),
        getMetadata: jest.fn(),
        testConnection: jest.fn(),
        deletePrefix: jest.fn(),
      };
      adapter.setAdapter(bufferingAdapter);

      expect(adapter.downloadStream).toBeUndefined();
    });
  });
});

describe('DynamicStorageAdapter default local adapter', () => {
  const original = {
    PRIMARY_DOMAIN: process.env.PRIMARY_DOMAIN,
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('supports presigned uploads out of the box when a domain is configured', () => {
    process.env.PRIMARY_DOMAIN = 'ce.example';
    // On a real CE install ENCRYPTION_KEY is mandatory setup, not optional --
    // this test exercises "presigned support given a resolvable origin", so
    // it needs the real signing secret present too (fail-closed behavior with
    // no secret is covered in local.adapter.spec.ts).
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    expect(new DynamicStorageAdapter().supportsPresignedUrls()).toBe(true);
  });

  it('degrades to unsupported rather than throwing when no origin can be resolved', () => {
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.PUBLIC_ORIGIN;
    // This test isolates the ORIGIN gate specifically: set a real secret so
    // the (separate) secret gate can't also be the reason for `false` here --
    // without this, the test would still pass even if the origin check were
    // deleted, since the secret gate alone would produce `false` regardless.
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    expect(new DynamicStorageAdapter().supportsPresignedUrls()).toBe(false);
  });
});
