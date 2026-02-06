import { AzureBlobStorageAdapter } from './azure.adapter';
import {
  BlobServiceClient,
  ContainerClient,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

// Mock @azure/storage-blob
jest.mock('@azure/storage-blob', () => ({
  ...jest.requireActual('@azure/storage-blob'),
  BlobServiceClient: jest.fn(),
  StorageSharedKeyCredential: jest.fn(),
  generateBlobSASQueryParameters: jest.fn().mockReturnValue({
    toString: () => 'sig=mockedSignature&se=2024-01-01',
  }),
  BlobSASPermissions: {
    parse: jest.fn().mockReturnValue({}),
  },
  SASProtocol: {
    HttpsAndHttp: 'https,http',
  },
}));
jest.mock('@azure/identity');

describe('AzureBlobStorageAdapter', () => {
  const testConfig = {
    accountName: 'testaccount',
    containerName: 'test-container',
    accountKey: 'dGVzdC1rZXktYmFzZTY0LWVuY29kZWQ=', // base64 encoded test key
  };

  let adapter: AzureBlobStorageAdapter;
  let mockContainerClient: jest.Mocked<ContainerClient>;
  let mockBlockBlobClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock BlockBlobClient
    mockBlockBlobClient = {
      upload: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue({
        readableStreamBody: (async function* () {
          yield Buffer.from('test content');
        })(),
      }),
      deleteIfExists: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getProperties: jest.fn().mockResolvedValue({
        contentLength: 1024,
        contentType: 'text/plain',
        lastModified: new Date('2024-01-01'),
        etag: '"abc123"',
      }),
      url: 'https://testaccount.blob.core.windows.net/test-container/test-key',
    };

    // Setup mock ContainerClient
    mockContainerClient = {
      getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
      listBlobsFlat: jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { name: 'test-key' };
        },
        byPage: jest.fn().mockReturnValue({
          next: jest.fn().mockResolvedValue({ done: true }),
        }),
      }),
      exists: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Setup mock BlobServiceClient
    (BlobServiceClient as jest.MockedClass<typeof BlobServiceClient>).mockImplementation(
      () =>
        ({
          getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
        }) as any,
    );

    // Mock fromConnectionString static method
    (BlobServiceClient.fromConnectionString as jest.Mock) = jest.fn().mockReturnValue({
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
    });

    adapter = new AzureBlobStorageAdapter(testConfig);
  });

  describe('constructor', () => {
    it('should create adapter with valid config using account key', () => {
      expect(adapter).toBeDefined();
    });

    it('should create adapter with connection string', () => {
      const connectionStringConfig = {
        accountName: 'testaccount',
        containerName: 'test-container',
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net',
      };
      const connectionAdapter = new AzureBlobStorageAdapter(connectionStringConfig);
      expect(connectionAdapter).toBeDefined();
    });

    it('should throw error without accountName', () => {
      expect(
        () => new AzureBlobStorageAdapter({ ...testConfig, accountName: '' }),
      ).toThrow('Azure configuration requires accountName');
    });

    it('should throw error without containerName', () => {
      expect(
        () => new AzureBlobStorageAdapter({ ...testConfig, containerName: '' }),
      ).toThrow('Azure configuration requires containerName');
    });

    it('should throw error without authentication', () => {
      expect(
        () =>
          new AzureBlobStorageAdapter({
            accountName: 'test',
            containerName: 'test',
          }),
      ).toThrow('Azure configuration requires authentication');
    });

    it('should throw error with multiple auth methods', () => {
      expect(
        () =>
          new AzureBlobStorageAdapter({
            ...testConfig,
            connectionString: 'DefaultEndpointsProtocol=https;...',
          }),
      ).toThrow('only one authentication method');
    });

    it('should throw error for invalid access tier', () => {
      expect(
        () =>
          new AzureBlobStorageAdapter({
            ...testConfig,
            accessTier: 'Invalid' as any,
          }),
      ).toThrow('Invalid access tier');
    });

    it('should throw error for negative SAS expiration', () => {
      expect(
        () =>
          new AzureBlobStorageAdapter({
            ...testConfig,
            sasUrlExpiration: -1,
          }),
      ).toThrow('sasUrlExpiration must be at least 1 second');
    });

    it('should throw error when managedIdentityClientId is set without useManagedIdentity', () => {
      expect(
        () =>
          new AzureBlobStorageAdapter({
            accountName: 'test',
            containerName: 'test',
            accountKey: 'dGVzdC1rZXk=', // provide account key as auth method
            managedIdentityClientId: 'client-id', // but also provide MI client ID
          }),
      ).toThrow('managedIdentityClientId requires useManagedIdentity to be true');
    });
  });

  describe('upload', () => {
    it('should upload file successfully', async () => {
      const result = await adapter.upload(
        Buffer.from('test content'),
        'test/file.txt',
        { mimeType: 'text/plain' },
      );

      expect(result).toBe('test/file.txt');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/file.txt');
      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          blobHTTPHeaders: { blobContentType: 'text/plain' },
        }),
      );
    });

    it('should reject path traversal', async () => {
      await expect(
        adapter.upload(Buffer.from('test'), '../etc/passwd'),
      ).rejects.toThrow('path traversal detected');
    });

    it('should reject unsafe characters in key', async () => {
      await expect(
        adapter.upload(Buffer.from('test'), 'test/file<>.txt'),
      ).rejects.toThrow('contains unsafe characters');
    });

    it('should strip leading slashes from key', async () => {
      await adapter.upload(Buffer.from('test'), '/test/file.txt');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/file.txt');
    });

    it('should use default content type when not provided', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.bin');

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
        }),
      );
    });

    it('should throw error on upload failure', async () => {
      mockBlockBlobClient.upload.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(
        adapter.upload(Buffer.from('test'), 'test/file.txt'),
      ).rejects.toThrow('Azure Blob upload failed');
    });
  });

  describe('download', () => {
    it('should download file successfully', async () => {
      const result = await adapter.download('test/file.txt');

      expect(result.toString()).toBe('test content');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/file.txt');
    });

    it('should throw not found for missing file', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockBlockBlobClient.download.mockRejectedValueOnce(error);

      await expect(adapter.download('missing.txt')).rejects.toThrow('File not found');
    });

    it('should throw error for other download failures', async () => {
      mockBlockBlobClient.download.mockRejectedValueOnce(new Error('Network error'));

      await expect(adapter.download('test/file.txt')).rejects.toThrow(
        'Azure Blob download failed',
      );
    });

    it('should throw error for empty response body', async () => {
      mockBlockBlobClient.download.mockResolvedValueOnce({
        readableStreamBody: null,
      });

      await expect(adapter.download('test/file.txt')).rejects.toThrow(
        'Empty response body',
      );
    });
  });

  describe('delete', () => {
    it('should delete file successfully', async () => {
      await adapter.delete('test/file.txt');

      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/file.txt');
      expect(mockBlockBlobClient.deleteIfExists).toHaveBeenCalled();
    });

    it('should not throw on delete error (silent failure)', async () => {
      mockBlockBlobClient.deleteIfExists.mockRejectedValueOnce(new Error('Delete failed'));

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
      mockBlockBlobClient.exists.mockResolvedValueOnce(false);

      const result = await adapter.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('should throw error on exists check failure', async () => {
      mockBlockBlobClient.exists.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(adapter.exists('test/file.txt')).rejects.toThrow('Permission denied');
    });
  });

  describe('listKeys', () => {
    it('should list all keys', async () => {
      const result = await adapter.listKeys();

      expect(result).toEqual(['test-key']);
    });

    it('should filter by prefix', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { name: 'prefix/file1.txt' };
          yield { name: 'prefix/file2.txt' };
        },
      } as any);

      const result = await adapter.listKeys('prefix');

      expect(result).toEqual(['prefix/file1.txt', 'prefix/file2.txt']);
    });

    it('should handle empty results', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          // Empty iterator
        },
      } as any);

      const result = await adapter.listKeys();

      expect(result).toEqual([]);
    });

    it('should throw error on list failure', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Access denied');
        },
      } as any);

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
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockBlockBlobClient.getProperties.mockRejectedValueOnce(error);

      await expect(adapter.getMetadata('missing.txt')).rejects.toThrow('File not found');
    });

    it('should handle missing optional fields', async () => {
      mockBlockBlobClient.getProperties.mockResolvedValueOnce({
        contentLength: 512,
      });

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
    it('should return SAS URL with account key', async () => {
      const result = await adapter.getUrl('test/file.txt');

      expect(result).toContain('https://testaccount.blob.core.windows.net');
      expect(result).toContain('test-key');
    });

    it('should use custom expiration', async () => {
      const result = await adapter.getUrl('test/file.txt', 7200);

      // URL should be generated (we can't test exact expiration without more complex mocking)
      expect(result).toContain('https://');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it('should create container if not exists', async () => {
      mockContainerClient.exists.mockResolvedValueOnce(false);

      await adapter.testConnection();

      expect(mockContainerClient.create).toHaveBeenCalled();
    });

    it('should return false when test file does not exist after upload', async () => {
      // Container exists
      mockContainerClient.exists.mockResolvedValueOnce(true);
      // Test file does not exist after upload
      mockBlockBlobClient.exists.mockResolvedValueOnce(false);

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it('should return false on connection error', async () => {
      mockContainerClient.exists.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('key sanitization', () => {
    it('should strip trailing slashes', async () => {
      await adapter.upload(Buffer.from('test'), 'test/path/');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/path');
    });

    it('should allow dots in filename', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.tar.gz');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('test/file.tar.gz');
    });

    it('should allow hyphens in path', async () => {
      await adapter.upload(Buffer.from('test'), 'test-path/file-name.txt');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'test-path/file-name.txt',
      );
    });

    it('should allow underscores in path', async () => {
      await adapter.upload(Buffer.from('test'), 'test_path/file_name.txt');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'test_path/file_name.txt',
      );
    });
  });

  describe('metadata normalization', () => {
    it('should normalize metadata keys to valid C# identifiers', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.txt', {
        mimeType: 'text/plain',
        'custom-header': 'value1',
        '123numeric': 'value2',
        'special.chars!': 'value3',
      });

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          metadata: {
            custom_header: 'value1',
            x23numeric: 'value2',
            special_chars_: 'value3',
          },
        }),
      );
    });

    it('should skip mimeType and content-type in metadata', async () => {
      await adapter.upload(Buffer.from('test'), 'test/file.txt', {
        mimeType: 'text/plain',
        'content-type': 'text/plain',
        custom: 'value',
      });

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          metadata: {
            custom: 'value',
          },
        }),
      );
    });

    it('should truncate long metadata values', async () => {
      const longValue = 'x'.repeat(2000);
      await adapter.upload(Buffer.from('test'), 'test/file.txt', {
        longField: longValue,
      });

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          metadata: {
            longField: 'x'.repeat(1024),
          },
        }),
      );
    });
  });

  describe('deletePrefix', () => {
    it('should delete all blobs with prefix', async () => {
      const mockDeleteIfExists = jest.fn().mockResolvedValue(undefined);

      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { name: 'owner/repo/abc123/file1.txt' };
          yield { name: 'owner/repo/abc123/file2.txt' };
          yield { name: 'owner/repo/abc123/nested/file3.txt' };
        },
      } as any);

      mockContainerClient.getBlockBlobClient.mockReturnValue({
        deleteIfExists: mockDeleteIfExists,
      } as any);

      const result = await adapter.deletePrefix('owner/repo/abc123');

      expect(result.deleted).toBe(3);
      expect(result.failed).toHaveLength(0);
      expect(mockDeleteIfExists).toHaveBeenCalledTimes(3);
    });

    it('should handle empty prefix (no blobs)', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          // Empty iterator
        },
      } as any);

      const result = await adapter.deletePrefix('empty/prefix');

      expect(result.deleted).toBe(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should handle batch deletion for large number of blobs', async () => {
      // Create 150 blobs to test batching (batch size is 100)
      const blobs = Array.from({ length: 150 }, (_, i) => ({
        name: `prefix/file${i}.txt`,
      }));

      const mockDeleteIfExists = jest.fn().mockResolvedValue(undefined);

      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const blob of blobs) {
            yield blob;
          }
        },
      } as any);

      mockContainerClient.getBlockBlobClient.mockReturnValue({
        deleteIfExists: mockDeleteIfExists,
      } as any);

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(150);
      expect(result.failed).toHaveLength(0);
      expect(mockDeleteIfExists).toHaveBeenCalledTimes(150);
    });

    it('should track failed deletions', async () => {
      let callCount = 0;
      const mockDeleteIfExists = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Delete failed'));
        }
        return Promise.resolve(undefined);
      });

      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { name: 'prefix/file1.txt' };
          yield { name: 'prefix/file2.txt' };
          yield { name: 'prefix/file3.txt' };
        },
      } as any);

      mockContainerClient.getBlockBlobClient.mockReturnValue({
        deleteIfExists: mockDeleteIfExists,
      } as any);

      const result = await adapter.deletePrefix('prefix');

      expect(result.deleted).toBe(2);
      expect(result.failed).toEqual(['prefix/file2.txt']);
    });

    it('should throw error on list failure', async () => {
      mockContainerClient.listBlobsFlat.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Access denied');
        },
      } as any);

      await expect(adapter.deletePrefix('prefix')).rejects.toThrow('Failed to delete prefix');
    });
  });
});
