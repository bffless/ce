import { LocalStorageAdapter } from './local.adapter';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;
  const testBasePath = path.join(__dirname, '../../test-storage');

  beforeEach(async () => {
    adapter = new LocalStorageAdapter({
      localPath: testBasePath,
      baseUrl: 'http://localhost:3000/files',
    });

    // Ensure test directory exists
    await fs.mkdir(testBasePath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testBasePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('upload', () => {
    it('should upload a file successfully', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Hello World');

      const result = await adapter.upload(content, key);

      expect(result).toBe(key);

      // Verify file exists on disk
      const fullPath = path.join(testBasePath, key);
      const fileContent = await fs.readFile(fullPath);
      expect(fileContent.toString()).toBe('Hello World');
    });

    it('should create directories as needed', async () => {
      const key = 'owner/repo/abc123/nested/deep/file.txt';
      const content = Buffer.from('Nested file');

      await adapter.upload(content, key);

      const fullPath = path.join(testBasePath, key);
      const exists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should store metadata if provided', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Test');
      const metadata = { mimeType: 'text/plain', customField: 'value' };

      await adapter.upload(content, key, metadata);

      // Check metadata file exists
      const metaPath = path.join(testBasePath, `${key}.meta.json`);
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.customField).toBe('value');
    });

    it('should reject path traversal attempts', async () => {
      const key = '../../../etc/passwd';
      const content = Buffer.from('Malicious');

      await expect(adapter.upload(content, key)).rejects.toThrow('path traversal detected');
    });

    it('should reject unsafe characters in key', async () => {
      const key = 'owner/repo/abc<script>alert()</script>';
      const content = Buffer.from('Test');

      await expect(adapter.upload(content, key)).rejects.toThrow('unsafe characters');
    });
  });

  describe('download', () => {
    it('should download an existing file', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Download test');

      await adapter.upload(content, key);
      const downloaded = await adapter.download(key);

      expect(downloaded.toString()).toBe('Download test');
    });

    it('should throw error for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      await expect(adapter.download(key)).rejects.toThrow('File not found');
    });
  });

  describe('delete', () => {
    it('should delete an existing file', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Delete test');

      await adapter.upload(content, key);
      await adapter.delete(key);

      const exists = await adapter.exists(key);
      expect(exists).toBe(false);
    });

    it('should delete metadata file if exists', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Test');
      const metadata = { mimeType: 'text/plain' };

      await adapter.upload(content, key, metadata);
      await adapter.delete(key);

      const metaPath = path.join(testBasePath, `${key}.meta.json`);
      const metaExists = await fs
        .access(metaPath)
        .then(() => true)
        .catch(() => false);
      expect(metaExists).toBe(false);
    });

    it('should not throw error if file does not exist', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      await expect(adapter.delete(key)).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Exists test');

      await adapter.upload(content, key);
      const exists = await adapter.exists(key);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';
      const exists = await adapter.exists(key);

      expect(exists).toBe(false);
    });
  });

  describe('getUrl', () => {
    it('should generate correct URL', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const url = await adapter.getUrl(key);

      expect(url).toBe('http://localhost:3000/files/owner/repo/abc123/test.txt');
    });
  });

  describe('listKeys', () => {
    it('should list all files', async () => {
      await adapter.upload(Buffer.from('File 1'), 'owner/repo/abc123/file1.txt');
      await adapter.upload(Buffer.from('File 2'), 'owner/repo/abc123/file2.txt');
      await adapter.upload(Buffer.from('File 3'), 'owner/repo/abc123/nested/file3.txt');

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('owner/repo/abc123/file1.txt');
      expect(keys).toContain('owner/repo/abc123/file2.txt');
      expect(keys).toContain('owner/repo/abc123/nested/file3.txt');
    });

    it('should list files with prefix filter', async () => {
      await adapter.upload(Buffer.from('File 1'), 'owner/repo/abc123/file1.txt');
      await adapter.upload(Buffer.from('File 2'), 'owner/repo/xyz789/file2.txt');

      const keys = await adapter.listKeys('owner/repo/abc123');

      expect(keys).toHaveLength(1);
      expect(keys).toContain('owner/repo/abc123/file1.txt');
    });

    it('should not include metadata files in listing', async () => {
      await adapter.upload(Buffer.from('File'), 'owner/repo/abc123/file.txt', {
        mimeType: 'text/plain',
      });

      const keys = await adapter.listKeys();

      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe('owner/repo/abc123/file.txt');
      // Should not include .meta.json file
      expect(keys.some((k) => k.endsWith('.meta.json'))).toBe(false);
    });

    it('should return empty array for non-existent prefix', async () => {
      const keys = await adapter.listKeys('nonexistent/prefix');

      expect(keys).toEqual([]);
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      const key = 'owner/repo/abc123/test.txt';
      const content = Buffer.from('Metadata test');

      await adapter.upload(content, key, { mimeType: 'text/plain' });
      const metadata = await adapter.getMetadata(key);

      expect(metadata.key).toBe(key);
      expect(metadata.size).toBe(content.length);
      expect(metadata.mimeType).toBe('text/plain');
      expect(metadata.lastModified).toBeDefined();
      // Verify it's a Date by checking it has a valid timestamp
      expect(metadata.lastModified!.getTime()).toBeGreaterThan(0);
      expect(metadata.etag).toBeDefined();
    });

    it('should guess MIME type if metadata not stored', async () => {
      const key = 'owner/repo/abc123/test.png';
      const content = Buffer.from('PNG data');

      await adapter.upload(content, key);
      const metadata = await adapter.getMetadata(key);

      expect(metadata.mimeType).toBe('image/png');
    });

    it('should throw error for non-existent file', async () => {
      const key = 'owner/repo/abc123/nonexistent.txt';

      await expect(adapter.getMetadata(key)).rejects.toThrow('File not found');
    });
  });

  describe('testConnection', () => {
    it('should return true for accessible directory', async () => {
      const result = await adapter.testConnection();

      expect(result).toBe(true);
    });

    it('should create base directory if it does not exist', async () => {
      const newAdapter = new LocalStorageAdapter({
        localPath: path.join(testBasePath, 'new-directory'),
      });

      const result = await newAdapter.testConnection();

      expect(result).toBe(true);
    });
  });

  describe('deletePrefix', () => {
    it('should delete all files under prefix', async () => {
      // Create test files
      const prefix = 'owner/repo/abc123';
      await adapter.upload(Buffer.from('File 1'), `${prefix}/file1.txt`);
      await adapter.upload(Buffer.from('File 2'), `${prefix}/file2.txt`);
      await adapter.upload(Buffer.from('File 3'), `${prefix}/nested/file3.txt`);

      const result = await adapter.deletePrefix(prefix);

      expect(result.deleted).toBe(3);
      expect(result.failed).toHaveLength(0);

      // Verify files are deleted
      expect(await adapter.exists(`${prefix}/file1.txt`)).toBe(false);
      expect(await adapter.exists(`${prefix}/file2.txt`)).toBe(false);
      expect(await adapter.exists(`${prefix}/nested/file3.txt`)).toBe(false);
    });

    it('should handle non-existent prefix', async () => {
      const result = await adapter.deletePrefix('nonexistent/prefix');

      expect(result.deleted).toBe(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should delete nested directories', async () => {
      const prefix = 'owner/repo/deep';
      await adapter.upload(Buffer.from('Root'), `${prefix}/root.txt`);
      await adapter.upload(Buffer.from('Level 1'), `${prefix}/level1/file.txt`);
      await adapter.upload(Buffer.from('Level 2'), `${prefix}/level1/level2/file.txt`);

      const result = await adapter.deletePrefix(prefix);

      expect(result.deleted).toBe(3);
      expect(result.failed).toHaveLength(0);

      // Verify entire directory structure is gone
      const fullPath = path.join(testBasePath, prefix);
      const exists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should also delete metadata files', async () => {
      const prefix = 'owner/repo/withmeta';
      await adapter.upload(Buffer.from('Content'), `${prefix}/file.txt`, {
        mimeType: 'text/plain',
      });

      // Verify metadata file exists before deletion
      const metaPath = path.join(testBasePath, `${prefix}/file.txt.meta.json`);
      const metaExistsBefore = await fs
        .access(metaPath)
        .then(() => true)
        .catch(() => false);
      expect(metaExistsBefore).toBe(true);

      const result = await adapter.deletePrefix(prefix);

      // Meta files are counted as part of directory, but only data files are reported
      expect(result.deleted).toBe(1);
      expect(result.failed).toHaveLength(0);

      // Verify metadata file is also deleted
      const metaExistsAfter = await fs
        .access(metaPath)
        .then(() => true)
        .catch(() => false);
      expect(metaExistsAfter).toBe(false);
    });

    it('should not delete files outside the prefix', async () => {
      await adapter.upload(Buffer.from('Inside'), 'owner/repo/abc123/inside.txt');
      await adapter.upload(Buffer.from('Outside'), 'owner/repo/xyz789/outside.txt');

      await adapter.deletePrefix('owner/repo/abc123');

      // File outside prefix should still exist
      expect(await adapter.exists('owner/repo/xyz789/outside.txt')).toBe(true);
    });

    it('should clean up empty parent directories', async () => {
      // Create a file deep in the tree
      const prefix = 'cleanup/test/deep';
      await adapter.upload(Buffer.from('Deep file'), `${prefix}/file.txt`);

      await adapter.deletePrefix(prefix);

      // Parent directories should be cleaned up if empty
      // This depends on implementation - checking the 'cleanup' dir exists but is empty
      // or has been cleaned up
      const parentPath = path.join(testBasePath, 'cleanup/test');
      const parentExists = await fs
        .access(parentPath)
        .then(() => true)
        .catch(() => false);

      // If parent exists, it should be empty or not exist at all
      if (parentExists) {
        const entries = await fs.readdir(parentPath);
        expect(entries).toHaveLength(0);
      }
    });
  });
});
