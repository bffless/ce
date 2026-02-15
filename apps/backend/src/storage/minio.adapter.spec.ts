import { MinioStorageAdapter } from './minio.adapter';
import * as Minio from 'minio';

// Mock MinIO client
jest.mock('minio');

describe('MinioStorageAdapter', () => {
  let adapter: MinioStorageAdapter;
  let mockMinioClient: jest.Mocked<Minio.Client>;

  const testConfig = {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'test-bucket',
    region: 'us-east-1',
  };

  beforeEach(() => {
    // Create a mock MinIO client
    mockMinioClient = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      removeObject: jest.fn(),
      statObject: jest.fn(),
      presignedGetObject: jest.fn(),
      listObjectsV2: jest.fn(),
      bucketExists: jest.fn(),
      makeBucket: jest.fn(),
    } as any;

    // Mock the MinIO.Client constructor
    (Minio.Client as jest.Mock).mockImplementation(() => mockMinioClient);

    adapter = new MinioStorageAdapter(testConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('should upload a file successfully', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Hello World');
      const metadata = { mimeType: 'text/plain' };

      mockMinioClient.putObject.mockResolvedValue({} as any);

      const result = await adapter.upload(content, key, metadata);

      expect(result).toBe(key);
      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'test-bucket',
        key,
        content,
        content.length,
        expect.objectContaining({
          'Content-Type': 'text/plain',
        }),
      );
    });

    it('should use default content type if not provided', async () => {
      const key = 'owner/repo/abc123/file.bin';
      const content = Buffer.from('Binary data');

      mockMinioClient.putObject.mockResolvedValue({} as any);

      await adapter.upload(content, key);

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'test-bucket',
        key,
        content,
        content.length,
        expect.objectContaining({
          'Content-Type': 'application/octet-stream',
        }),
      );
    });

    it('should reject path traversal attempts', async () => {
      const key = '../../../etc/passwd';
      const content = Buffer.from('Malicious');

      await expect(adapter.upload(content, key)).rejects.toThrow('path traversal detected');
    });

    it('should handle upload errors', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Test');

      mockMinioClient.putObject.mockRejectedValue(new Error('Upload failed'));

      await expect(adapter.upload(content, key)).rejects.toThrow('Upload failed');
    });
  });

  describe('download', () => {
    it('should download a file successfully', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = 'Download test';

      // Mock readable stream
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from(content));
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.getObject.mockResolvedValue(mockStream as any);

      const downloaded = await adapter.download(key);

      expect(downloaded.toString()).toBe(content);
      expect(mockMinioClient.getObject).toHaveBeenCalledWith('test-bucket', key);
    });

    it('should throw error for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      const error: any = new Error('Not found');
      error.code = 'NoSuchKey';
      mockMinioClient.getObject.mockRejectedValue(error);

      await expect(adapter.download(key)).rejects.toThrow('File not found');
    });

    it('should handle stream errors', async () => {
      const key = 'owner/repo/abc123/test.txt';

      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Stream error'));
          }
          return mockStream;
        }),
      };

      mockMinioClient.getObject.mockResolvedValue(mockStream as any);

      await expect(adapter.download(key)).rejects.toThrow('Stream error');
    });
  });

  describe('delete', () => {
    it('should delete a file successfully', async () => {
      const key = 'owner/repo/abc123/test.txt';

      mockMinioClient.removeObject.mockResolvedValue(undefined);

      await adapter.delete(key);

      expect(mockMinioClient.removeObject).toHaveBeenCalledWith('test-bucket', key);
    });

    it('should not throw error if file does not exist', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      mockMinioClient.removeObject.mockResolvedValue(undefined);

      await expect(adapter.delete(key)).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const key = 'owner/repo/abc123/test.txt';

      mockMinioClient.statObject.mockResolvedValue({
        size: 100,
        lastModified: new Date(),
      } as any);

      const exists = await adapter.exists(key);

      expect(exists).toBe(true);
      expect(mockMinioClient.statObject).toHaveBeenCalledWith('test-bucket', key);
    });

    it('should return false for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      const error: any = new Error('Not found');
      error.code = 'NotFound';
      mockMinioClient.statObject.mockRejectedValue(error);

      const exists = await adapter.exists(key);

      expect(exists).toBe(false);
    });
  });

  describe('getUrl', () => {
    it('should generate presigned URL', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const expectedUrl = 'https://minio.example.com/presigned-url';

      mockMinioClient.presignedGetObject.mockResolvedValue(expectedUrl);

      const url = await adapter.getUrl(key, 3600);

      expect(url).toBe(expectedUrl);
      expect(mockMinioClient.presignedGetObject).toHaveBeenCalledWith('test-bucket', key, 3600);
    });

    it('should use default expiration if not provided', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const expectedUrl = 'https://minio.example.com/presigned-url';

      mockMinioClient.presignedGetObject.mockResolvedValue(expectedUrl);

      await adapter.getUrl(key);

      expect(mockMinioClient.presignedGetObject).toHaveBeenCalledWith(
        'test-bucket',
        key,
        3600, // default expiration
      );
    });
  });

  describe('listKeys', () => {
    it('should list all files', async () => {
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler({ name: 'owner/repo/abc123/file1.txt' });
            handler({ name: 'owner/repo/abc123/file2.txt' });
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(2);
      expect(keys).toContain('owner/repo/abc123/file1.txt');
      expect(keys).toContain('owner/repo/abc123/file2.txt');
    });

    it('should list files with prefix filter', async () => {
      const prefix = 'owner/repo/abc123';
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler({ name: 'owner/repo/abc123/file1.txt' });
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);

      const keys = await adapter.listKeys(prefix);

      expect(mockMinioClient.listObjectsV2).toHaveBeenCalledWith('test-bucket', prefix, true);
      expect(keys).toHaveLength(1);
    });

    it('should handle stream errors', async () => {
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('List error'));
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);

      await expect(adapter.listKeys()).rejects.toThrow('Failed to list objects');
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const lastModified = new Date();

      mockMinioClient.statObject.mockResolvedValue({
        size: 1024,
        lastModified,
        etag: 'abc123',
        metaData: { 'content-type': 'text/plain' },
      } as any);

      const metadata = await adapter.getMetadata(key);

      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(1024);
      expect(metadata.mimeType).toBe('text/plain');
      expect(metadata.lastModified).toBe(lastModified);
      expect(metadata.etag).toBe('abc123');
    });

    it('should throw error for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      const error: any = new Error('Not found');
      error.code = 'NotFound';
      mockMinioClient.statObject.mockRejectedValue(error);

      await expect(adapter.getMetadata(key)).rejects.toThrow('File not found');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockMinioClient.bucketExists.mockResolvedValue(true);
      mockMinioClient.putObject.mockResolvedValue({} as any);
      mockMinioClient.statObject.mockResolvedValue({} as any);
      mockMinioClient.removeObject.mockResolvedValue(undefined);

      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it('should create bucket if it does not exist', async () => {
      mockMinioClient.bucketExists.mockResolvedValue(false);
      mockMinioClient.makeBucket.mockResolvedValue(undefined);
      mockMinioClient.putObject.mockResolvedValue({} as any);
      mockMinioClient.statObject.mockResolvedValue({} as any);
      mockMinioClient.removeObject.mockResolvedValue(undefined);

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockMinioClient.makeBucket).toHaveBeenCalledWith('test-bucket', 'us-east-1');
    });

    it('should throw error on connection failure', async () => {
      mockMinioClient.bucketExists.mockRejectedValue(new Error('Connection failed'));

      await expect(adapter.testConnection()).rejects.toThrow('Connection failed');
    });
  });

  describe('deletePrefix', () => {
    it('should delete all objects with prefix', async () => {
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler({ name: 'owner/repo/abc123/file1.txt' });
            handler({ name: 'owner/repo/abc123/file2.txt' });
            handler({ name: 'owner/repo/abc123/nested/file3.txt' });
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);
      (mockMinioClient as any).removeObjects = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.deletePrefix('owner/repo/abc123');

      expect(result.deleted).toBe(3);
      expect(result.failed).toHaveLength(0);
      expect((mockMinioClient as any).removeObjects).toHaveBeenCalledWith('test-bucket', [
        'owner/repo/abc123/file1.txt',
        'owner/repo/abc123/file2.txt',
        'owner/repo/abc123/nested/file3.txt',
      ]);
    });

    it('should handle empty prefix (no objects)', async () => {
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);
      (mockMinioClient as any).removeObjects = jest.fn();

      const result = await adapter.deletePrefix('empty/prefix');

      expect(result.deleted).toBe(0);
      expect(result.failed).toHaveLength(0);
      expect((mockMinioClient as any).removeObjects).not.toHaveBeenCalled();
    });

    it('should handle batch deletion for large number of files', async () => {
      // Create 1500 objects to test batching (batch size is 1000)
      const objects = Array.from({ length: 1500 }, (_, i) => ({
        name: `prefix/file${i}.txt`,
      }));

      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            objects.forEach((obj) => handler(obj));
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);
      (mockMinioClient as any).removeObjects = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(1500);
      expect(result.failed).toHaveLength(0);
      // Should be called twice (batch of 1000 + batch of 500)
      expect((mockMinioClient as any).removeObjects).toHaveBeenCalledTimes(2);
    });

    it('should track failed batch deletions', async () => {
      const objects = Array.from({ length: 10 }, (_, i) => ({
        name: `prefix/file${i}.txt`,
      }));

      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            objects.forEach((obj) => handler(obj));
          } else if (event === 'end') {
            handler();
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);
      (mockMinioClient as any).removeObjects = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(0);
      expect(result.failed).toHaveLength(10);
    });

    it('should handle list stream errors', async () => {
      const mockStream = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('List failed'));
          }
          return mockStream;
        }),
      };

      mockMinioClient.listObjectsV2.mockReturnValue(mockStream as any);

      await expect(adapter.deletePrefix('prefix')).rejects.toThrow('Failed to delete prefix');
    });
  });
});
