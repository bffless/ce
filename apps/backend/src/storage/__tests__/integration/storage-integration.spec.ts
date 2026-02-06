/**
 * Storage Integration Tests
 *
 * These tests run against real cloud providers.
 * Requires environment variables for credentials.
 *
 * Run with: pnpm test:integration
 *
 * Environment variables:
 * S3:
 *   - TEST_S3_BUCKET
 *   - TEST_S3_REGION
 *   - TEST_S3_ACCESS_KEY (optional if using IAM role)
 *   - TEST_S3_SECRET_KEY (optional if using IAM role)
 *
 * GCS:
 *   - TEST_GCS_BUCKET
 *   - TEST_GCS_PROJECT
 *   - TEST_GCS_KEY_FILE (optional if using ADC)
 *
 * Azure:
 *   - TEST_AZURE_CONTAINER
 *   - TEST_AZURE_ACCOUNT
 *   - TEST_AZURE_KEY (optional if using managed identity)
 */
import { S3StorageAdapter } from '../../s3.adapter';
import { GcsStorageAdapter } from '../../gcs.adapter';
import { AzureBlobStorageAdapter } from '../../azure.adapter';
import { LocalStorageAdapter } from '../../local.adapter';
import { IStorageAdapter } from '../../storage.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Skip if no credentials
const runS3Tests = process.env.TEST_S3_BUCKET && process.env.TEST_S3_REGION;
const runGcsTests = process.env.TEST_GCS_BUCKET && process.env.TEST_GCS_PROJECT;
const runAzureTests = process.env.TEST_AZURE_CONTAINER && process.env.TEST_AZURE_ACCOUNT;
const runLocalTests = true; // Always run local tests

describe('Storage Integration Tests', () => {
  const testKey = `integration-test/${Date.now()}/test-file.txt`;
  const testContent = Buffer.from(`Test content at ${new Date().toISOString()}`);
  const testContentType = 'text/plain';

  /**
   * Run common adapter tests for any IStorageAdapter implementation
   */
  const runAdapterTests = (name: string, getAdapter: () => IStorageAdapter) => {
    let adapter: IStorageAdapter;

    beforeAll(() => {
      adapter = getAdapter();
    });

    afterAll(async () => {
      // Cleanup test files
      try {
        await adapter.delete(testKey);
        // Also try to delete any lingering test files from prefix
        const keys = await adapter.listKeys('integration-test/');
        for (const key of keys) {
          await adapter.delete(key);
        }
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should test connection successfully', async () => {
      const result = await adapter.testConnection();
      expect(result).toBe(true);
    });

    it('should upload file', async () => {
      const result = await adapter.upload(testContent, testKey, {
        mimeType: testContentType,
        customMeta: 'test-value',
      });
      expect(result).toBe(testKey);
    });

    it('should check file exists', async () => {
      const exists = await adapter.exists(testKey);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const exists = await adapter.exists('non-existent-key-' + Date.now());
      expect(exists).toBe(false);
    });

    it('should download file', async () => {
      const data = await adapter.download(testKey);
      expect(data.toString()).toBe(testContent.toString());
    });

    it('should get metadata', async () => {
      const metadata = await adapter.getMetadata(testKey);
      expect(metadata.key).toBe(testKey);
      expect(metadata.size).toBe(testContent.length);
      expect(metadata.mimeType).toBe(testContentType);
      // Check lastModified is a Date-like object
      expect(metadata.lastModified).toBeDefined();
      expect(typeof (metadata.lastModified as Date).getTime).toBe('function');
    });

    it('should generate presigned/signed/SAS URL', async () => {
      const url = await adapter.getUrl(testKey, 300);
      expect(url).toMatch(/^https?:\/\//);
    });

    it('should list keys with prefix', async () => {
      const keys = await adapter.listKeys('integration-test/');
      expect(keys).toContain(testKey);
    });

    it('should list all keys without prefix', async () => {
      const keys = await adapter.listKeys();
      expect(keys.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent prefix', async () => {
      const keys = await adapter.listKeys('nonexistent-prefix-' + Date.now() + '/');
      expect(keys).toEqual([]);
    });

    it('should delete file', async () => {
      await adapter.delete(testKey);
      const exists = await adapter.exists(testKey);
      expect(exists).toBe(false);
    });

    it('should not throw when deleting non-existent file', async () => {
      await expect(
        adapter.delete('non-existent-key-' + Date.now()),
      ).resolves.not.toThrow();
    });
  };

  // Local Storage Tests (always run)
  describe('LocalStorageAdapter', () => {
    const tempDir = path.join(os.tmpdir(), 'storage-integration-test-' + Date.now());

    beforeAll(() => {
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterAll(() => {
      // Cleanup temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    runAdapterTests('Local', () => new LocalStorageAdapter({ localPath: tempDir }));
  });

  // S3 Tests
  (runS3Tests ? describe : describe.skip)('S3StorageAdapter', () => {
    runAdapterTests('S3', () =>
      new S3StorageAdapter({
        region: process.env.TEST_S3_REGION!,
        bucket: process.env.TEST_S3_BUCKET!,
        accessKeyId: process.env.TEST_S3_ACCESS_KEY!,
        secretAccessKey: process.env.TEST_S3_SECRET_KEY!,
      }),
    );
  });

  // GCS Tests
  (runGcsTests ? describe : describe.skip)('GcsStorageAdapter', () => {
    runAdapterTests('GCS', () =>
      new GcsStorageAdapter({
        projectId: process.env.TEST_GCS_PROJECT!,
        bucket: process.env.TEST_GCS_BUCKET!,
        keyFilename: process.env.TEST_GCS_KEY_FILE,
      }),
    );
  });

  // Azure Tests
  (runAzureTests ? describe : describe.skip)('AzureBlobStorageAdapter', () => {
    runAdapterTests('Azure', () =>
      new AzureBlobStorageAdapter({
        accountName: process.env.TEST_AZURE_ACCOUNT!,
        containerName: process.env.TEST_AZURE_CONTAINER!,
        accountKey: process.env.TEST_AZURE_KEY,
      }),
    );
  });
});

/**
 * Cross-adapter migration test
 * Tests migrating files between different storage providers
 */
describe('Cross-Adapter Migration', () => {
  const sourceKey = `migration-test/${Date.now()}/source-file.txt`;
  const targetKey = `migration-test/${Date.now()}/target-file.txt`;
  const testContent = Buffer.from('Migration test content');
  const tempDir = path.join(os.tmpdir(), 'migration-test-' + Date.now());

  let sourceAdapter: IStorageAdapter;
  let targetAdapter: IStorageAdapter;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    sourceAdapter = new LocalStorageAdapter({ localPath: path.join(tempDir, 'source') });
    targetAdapter = new LocalStorageAdapter({ localPath: path.join(tempDir, 'target') });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should migrate file from source to target', async () => {
    // Upload to source
    await sourceAdapter.upload(testContent, sourceKey, { mimeType: 'text/plain' });

    // Download from source
    const data = await sourceAdapter.download(sourceKey);

    // Upload to target
    await targetAdapter.upload(data, targetKey, { mimeType: 'text/plain' });

    // Verify in target
    const targetData = await targetAdapter.download(targetKey);
    expect(targetData.toString()).toBe(testContent.toString());

    // Verify metadata preserved
    const sourceMetadata = await sourceAdapter.getMetadata(sourceKey);
    const targetMetadata = await targetAdapter.getMetadata(targetKey);
    expect(targetMetadata.size).toBe(sourceMetadata.size);
  });

  it('should migrate multiple files', async () => {
    const files = [
      { key: `migration-test/${Date.now()}/file1.txt`, content: 'Content 1' },
      { key: `migration-test/${Date.now()}/file2.txt`, content: 'Content 2' },
      { key: `migration-test/${Date.now()}/file3.txt`, content: 'Content 3' },
    ];

    // Upload all to source
    for (const file of files) {
      await sourceAdapter.upload(Buffer.from(file.content), file.key);
    }

    // List source files
    const sourceKeys = await sourceAdapter.listKeys('migration-test/');
    expect(sourceKeys.length).toBeGreaterThanOrEqual(files.length);

    // Migrate all to target
    for (const file of files) {
      const data = await sourceAdapter.download(file.key);
      await targetAdapter.upload(data, file.key);
    }

    // Verify all in target
    for (const file of files) {
      const data = await targetAdapter.download(file.key);
      expect(data.toString()).toBe(file.content);
    }
  });
});
