import { GcsStorageAdapter } from './gcs.adapter';
import { Storage } from '@google-cloud/storage';

// Mock @google-cloud/storage
jest.mock('@google-cloud/storage');

describe('GcsStorageAdapter', () => {
  const testConfig = {
    projectId: 'test-project',
    bucket: 'test-bucket',
    credentials: {
      client_email: 'test@test-project.iam.gserviceaccount.com',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
    },
  };

  let adapter: GcsStorageAdapter;
  let mockBucket: any;
  let mockFile: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock file
    mockFile = {
      save: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue([Buffer.from('test content')]),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue([true]),
      getMetadata: jest.fn().mockResolvedValue([
        {
          size: '1024',
          contentType: 'text/plain',
          updated: '2024-01-01T00:00:00Z',
          etag: '"abc123"',
        },
      ]),
      getSignedUrl: jest.fn().mockResolvedValue(['https://signed-url.example.com']),
      name: 'test-key',
    };

    // Setup mock bucket
    mockBucket = {
      file: jest.fn().mockReturnValue(mockFile),
      getFiles: jest.fn().mockResolvedValue([[mockFile]]),
      exists: jest.fn().mockResolvedValue([true]),
    };

    // Setup mock Storage
    (Storage as jest.MockedClass<typeof Storage>).mockImplementation(
      () =>
        ({
          bucket: jest.fn().mockReturnValue(mockBucket),
        }) as any,
    );

    adapter = new GcsStorageAdapter(testConfig);
  });

  describe('constructor', () => {
    it('should create adapter with valid config', () => {
      expect(adapter).toBeDefined();
    });

    it('should throw error without projectId', () => {
      expect(() => new GcsStorageAdapter({ ...testConfig, projectId: '' })).toThrow(
        'GCS configuration requires projectId',
      );
    });

    it('should throw error without bucket', () => {
      expect(() => new GcsStorageAdapter({ ...testConfig, bucket: '' })).toThrow(
        'GCS configuration requires bucket name',
      );
    });

    it('should throw error with multiple auth methods', () => {
      expect(
        () =>
          new GcsStorageAdapter({
            projectId: 'test-project',
            bucket: 'test-bucket',
            credentials: {
              client_email: 'test@test-project.iam.gserviceaccount.com',
              private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
            },
            keyFilename: '/path/to/key.json',
          }),
      ).toThrow('only one authentication method');
    });

    it('should allow ADC when no explicit auth is provided', () => {
      const configWithoutAuth = {
        projectId: 'test-project',
        bucket: 'test-bucket',
      };
      // Should not throw, will use ADC
      const adcAdapter = new GcsStorageAdapter(configWithoutAuth);
      expect(adcAdapter).toBeDefined();
    });

    it('should throw error with invalid credentials object', () => {
      expect(
        () =>
          new GcsStorageAdapter({
            projectId: 'test-project',
            bucket: 'test-bucket',
            credentials: {
              client_email: '',
              private_key: 'test',
            },
          }),
      ).toThrow('GCS credentials require client_email and private_key');
    });

    it('should throw error with invalid signed URL expiration', () => {
      expect(
        () =>
          new GcsStorageAdapter({
            ...testConfig,
            signedUrlExpiration: 700000, // > 604800
          }),
      ).toThrow('signedUrlExpiration must be between 1 and 604800 seconds');
    });

    it('should throw error with invalid storage class', () => {
      expect(
        () =>
          new GcsStorageAdapter({
            ...testConfig,
            storageClass: 'INVALID' as any,
          }),
      ).toThrow('Invalid storage class');
    });
  });

  describe('upload', () => {
    it('should upload file successfully', async () => {
      const result = await adapter.upload(Buffer.from('test content'), 'test/file.txt', {
        mimeType: 'text/plain',
      });

      expect(result).toBe('test/file.txt');
      expect(mockBucket.file).toHaveBeenCalledWith('test/file.txt');
      expect(mockFile.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          contentType: 'text/plain',
        }),
      );
    });

    it('should reject path traversal', async () => {
      await expect(adapter.upload(Buffer.from('test'), '../etc/passwd')).rejects.toThrow(
        'path traversal detected',
      );
    });

    it('should reject unsafe characters in key', async () => {
      await expect(adapter.upload(Buffer.from('test'), 'test/file<>.txt')).rejects.toThrow(
        'contains unsafe characters',
      );
    });

    it('should strip leading slashes from key', async () => {
      await adapter.upload(Buffer.from('test'), '/test/file.txt');
      expect(mockBucket.file).toHaveBeenCalledWith('test/file.txt');
    });

    it('should use default content type when not provided', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.bin');

      expect(mockFile.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          contentType: 'application/octet-stream',
        }),
      );
    });

    it('should throw error on upload failure', async () => {
      mockFile.save.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(adapter.upload(Buffer.from('test'), 'test/file.txt')).rejects.toThrow(
        'GCS upload failed',
      );
    });
  });

  describe('download', () => {
    it('should download file successfully', async () => {
      const result = await adapter.download('test/file.txt');

      expect(result.toString()).toBe('test content');
      expect(mockBucket.file).toHaveBeenCalledWith('test/file.txt');
      expect(mockFile.download).toHaveBeenCalled();
    });

    it('should throw not found for missing file', async () => {
      const error = new Error('Not found') as Error & { code: number };
      error.code = 404;
      mockFile.download.mockRejectedValueOnce(error);

      await expect(adapter.download('missing.txt')).rejects.toThrow('File not found');
    });

    it('should throw error for other download failures', async () => {
      mockFile.download.mockRejectedValueOnce(new Error('Network error'));

      await expect(adapter.download('test/file.txt')).rejects.toThrow('GCS download failed');
    });
  });

  describe('delete', () => {
    it('should delete file successfully', async () => {
      await adapter.delete('test/file.txt');

      expect(mockBucket.file).toHaveBeenCalledWith('test/file.txt');
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('should not throw on delete error (silent failure)', async () => {
      mockFile.delete.mockRejectedValueOnce(new Error('Delete failed'));

      // Should not throw
      await expect(adapter.delete('test/file.txt')).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const result = await adapter.exists('test/file.txt');

      expect(result).toBe(true);
    });

    it('should return false for missing file', async () => {
      mockFile.exists.mockResolvedValueOnce([false]);

      const result = await adapter.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('should throw error on exists check failure', async () => {
      mockFile.exists.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(adapter.exists('test/file.txt')).rejects.toThrow('Permission denied');
    });
  });

  describe('listKeys', () => {
    it('should list all keys', async () => {
      const result = await adapter.listKeys();

      expect(result).toEqual(['test-key']);
    });

    it('should filter by prefix', async () => {
      await adapter.listKeys('prefix/');

      // Note: sanitizeKey strips trailing slashes
      expect(mockBucket.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'prefix',
        }),
      );
    });

    it('should handle empty results', async () => {
      mockBucket.getFiles.mockResolvedValueOnce([[]]);

      const result = await adapter.listKeys();

      expect(result).toEqual([]);
    });

    it('should throw error on list failure', async () => {
      mockBucket.getFiles.mockRejectedValueOnce(new Error('Access denied'));

      await expect(adapter.listKeys()).rejects.toThrow('Failed to list objects');
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const result = await adapter.getMetadata('test/file.txt');

      expect(result).toEqual({
        key: 'test/file.txt',
        size: 1024,
        mimeType: 'text/plain',
        lastModified: expect.any(Date),
        etag: 'abc123',
      });
    });

    it('should throw not found for missing file', async () => {
      const error = new Error('Not found') as Error & { code: number };
      error.code = 404;
      mockFile.getMetadata.mockRejectedValueOnce(error);

      await expect(adapter.getMetadata('missing.txt')).rejects.toThrow('File not found');
    });

    it('should handle missing optional fields', async () => {
      mockFile.getMetadata.mockResolvedValueOnce([
        {
          size: '512',
        },
      ]);

      const result = await adapter.getMetadata('test/file.txt');

      expect(result).toEqual({
        key: 'test/file.txt',
        size: 512,
        mimeType: undefined,
        lastModified: undefined,
        etag: undefined,
      });
    });
  });

  describe('getUrl', () => {
    it('should return signed URL', async () => {
      const result = await adapter.getUrl('test/file.txt');

      expect(result).toBe('https://signed-url.example.com');
      expect(mockFile.getSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'read',
          version: 'v4',
        }),
      );
    });

    it('should use custom expiration', async () => {
      await adapter.getUrl('test/file.txt', 7200);

      expect(mockFile.getSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          expires: expect.any(Number),
        }),
      );
    });

    it('should throw error on signed URL failure', async () => {
      mockFile.getSignedUrl.mockRejectedValueOnce(new Error('No credentials'));

      await expect(adapter.getUrl('test/file.txt')).rejects.toThrow('Failed to generate signed URL');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockFile.save.mockResolvedValueOnce(undefined);
      mockFile.exists.mockResolvedValueOnce([true]);
      mockFile.delete.mockResolvedValueOnce(undefined);

      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it('should throw error for non-existent bucket', async () => {
      mockBucket.exists.mockResolvedValueOnce([false]);

      await expect(adapter.testConnection()).rejects.toThrow('does not exist or is not accessible');
    });

    it('should throw error for write test failure', async () => {
      mockFile.save.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(adapter.testConnection()).rejects.toThrow('Permission denied');
    });

    it('should throw error when test file does not exist after upload', async () => {
      mockFile.save.mockResolvedValueOnce(undefined);
      mockFile.exists.mockResolvedValueOnce([false]);

      await expect(adapter.testConnection()).rejects.toThrow('Failed to verify test file');
    });
  });

  describe('key sanitization', () => {
    it('should strip trailing slashes', async () => {
      await adapter.upload(Buffer.from('test'), 'test/path/');
      expect(mockBucket.file).toHaveBeenCalledWith('test/path');
    });

    it('should allow dots in filename', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.tar.gz');
      expect(mockBucket.file).toHaveBeenCalledWith('test/file.tar.gz');
    });

    it('should allow hyphens in path', async () => {
      await adapter.upload(Buffer.from('test'), 'test-path/file-name.txt');
      expect(mockBucket.file).toHaveBeenCalledWith('test-path/file-name.txt');
    });

    it('should allow underscores in path', async () => {
      await adapter.upload(Buffer.from('test'), 'test_path/file_name.txt');
      expect(mockBucket.file).toHaveBeenCalledWith('test_path/file_name.txt');
    });
  });

  describe('deletePrefix', () => {
    it('should delete all files with prefix', async () => {
      const mockFiles = [
        { name: 'owner/repo/abc123/file1.txt', delete: jest.fn().mockResolvedValue(undefined) },
        { name: 'owner/repo/abc123/file2.txt', delete: jest.fn().mockResolvedValue(undefined) },
        { name: 'owner/repo/abc123/nested/file3.txt', delete: jest.fn().mockResolvedValue(undefined) },
      ];

      mockBucket.getFiles.mockResolvedValueOnce([mockFiles]);

      const result = await adapter.deletePrefix('owner/repo/abc123');

      expect(result.deleted).toBe(3);
      expect(result.failed).toHaveLength(0);
      expect(mockBucket.getFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: 'owner/repo/abc123',
        }),
      );
      mockFiles.forEach((file) => {
        expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
      });
    });

    it('should handle empty prefix (no files)', async () => {
      mockBucket.getFiles.mockResolvedValueOnce([[]]);

      const result = await adapter.deletePrefix('empty/prefix');

      expect(result.deleted).toBe(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should handle batch deletion for large number of files', async () => {
      // Create 150 files to test batching (batch size is 100)
      const mockFiles = Array.from({ length: 150 }, (_, i) => ({
        name: `prefix/file${i}.txt`,
        delete: jest.fn().mockResolvedValue(undefined),
      }));

      mockBucket.getFiles.mockResolvedValueOnce([mockFiles]);

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(150);
      expect(result.failed).toHaveLength(0);
      // All files should be deleted
      mockFiles.forEach((file) => {
        expect(file.delete).toHaveBeenCalled();
      });
    });

    it('should track failed deletions', async () => {
      const mockFiles = [
        { name: 'prefix/file1.txt', delete: jest.fn().mockResolvedValue(undefined) },
        { name: 'prefix/file2.txt', delete: jest.fn().mockRejectedValue(new Error('Delete failed')) },
        { name: 'prefix/file3.txt', delete: jest.fn().mockResolvedValue(undefined) },
      ];

      mockBucket.getFiles.mockResolvedValueOnce([mockFiles]);

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(2);
      expect(result.failed).toEqual(['prefix/file2.txt']);
    });

    it('should throw error on list failure', async () => {
      mockBucket.getFiles.mockRejectedValueOnce(new Error('Access denied'));

      await expect(adapter.deletePrefix('prefix')).rejects.toThrow('Failed to delete prefix');
    });
  });
});
