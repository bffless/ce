import { Injectable, Logger } from '@nestjs/common';
import { IStorageAdapter, FileMetadata } from './storage.interface';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Local File System Storage Adapter
 *
 * Stores files on the local filesystem.
 * Useful for development and small deployments.
 */
@Injectable()
export class LocalStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly basePath: string;
  private readonly baseUrl: string;
  private readonly keyPrefix: string;

  constructor(config: { localPath: string; baseUrl?: string; keyPrefix?: string }) {
    this.basePath = path.resolve(config.localPath);
    this.baseUrl = config.baseUrl || 'http://localhost:3000/files'; // @TODO baseUrl of /files does not make sense, no sure baseUrl is used for anything?
    this.keyPrefix = config.keyPrefix || '';
    this.logger.log(
      `Initialized LocalStorageAdapter with basePath: ${this.basePath}` +
        (this.keyPrefix ? `, keyPrefix: ${this.keyPrefix}` : ''),
    );
  }

  /**
   * Apply key prefix for workspace isolation
   */
  private prefixKey(key: string): string {
    if (!this.keyPrefix) return key;
    return `${this.keyPrefix}/${key}`;
  }

  /**
   * Remove key prefix from returned keys
   */
  private unprefixKey(key: string): string {
    if (!this.keyPrefix) return key;
    const prefix = `${this.keyPrefix}/`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }

  /**
   * Upload a file to local storage
   */
  async upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string> {
    // Validate and sanitize the key
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    // Ensure directory exists
    const directory = path.dirname(fullPath);
    await fs.mkdir(directory, { recursive: true });

    // Write file to disk
    await fs.writeFile(fullPath, file);

    // Optionally store metadata as a separate .meta.json file
    if (metadata) {
      const metadataPath = `${fullPath}.meta.json`;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }

    this.logger.log(`Uploaded file to: ${storageKey}`);
    return sanitizedKey; // Return unprefixed key to caller
  }

  /**
   * Download a file from local storage
   */
  async download(key: string): Promise<Buffer> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    try {
      const buffer = await fs.readFile(fullPath);
      return buffer;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  /**
   * Delete a file from local storage
   */
  async delete(key: string): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    try {
      await fs.unlink(fullPath);

      // Also delete metadata file if exists
      const metadataPath = `${fullPath}.meta.json`;
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Ignore if metadata file doesn't exist
      }

      // Try to remove empty parent directories
      await this.removeEmptyDirectories(path.dirname(fullPath));

      this.logger.log(`Deleted file: ${storageKey}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, consider it deleted
        return;
      }
      throw error;
    }
  }

  /**
   * Check if a file exists in local storage
   */
  async exists(key: string): Promise<boolean> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get URL for accessing the file
   * For local storage, this returns a URL that will be served by the backend
   */
  async getUrl(key: string): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    // For local storage, we'll serve files through the backend API
    // The URL format will be: {baseUrl}/{key} (unprefixed for external access)
    return `${this.baseUrl}/${sanitizedKey}`;
  }

  /**
   * List all storage keys with optional prefix
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const sanitizedPrefix = prefix ? this.sanitizeKey(prefix) : '';
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const searchPath = storagePrefix ? path.join(this.basePath, storagePrefix) : path.join(this.basePath, this.keyPrefix || '');

    const keys: string[] = [];

    try {
      const baseForRelative = this.keyPrefix ? path.join(this.basePath, this.keyPrefix) : this.basePath;
      await this.listKeysRecursive(searchPath, baseForRelative, keys);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist, return empty array
        return [];
      }
      throw error;
    }

    return keys;
  }

  /**
   * Get file metadata without downloading
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    try {
      const stats = await fs.stat(fullPath);

      // Try to read stored metadata
      let mimeType: string | undefined;
      const metadataPath = `${fullPath}.meta.json`;
      try {
        const metaContent = await fs.readFile(metadataPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        mimeType = meta.mimeType || meta['content-type'];
      } catch {
        // Metadata file doesn't exist or is invalid
        // Guess MIME type from extension
        mimeType = this.guessMimeType(sanitizedKey);
      }

      // Calculate ETag (simple hash of file)
      const buffer = await fs.readFile(fullPath);
      const etag = crypto.createHash('md5').update(buffer).digest('hex');

      return {
        key: sanitizedKey, // Return unprefixed key
        size: stats.size,
        mimeType,
        lastModified: stats.mtime,
        etag,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${key}`);
      }
      throw error;
    }
  }

  /**
   * Test storage connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Ensure base directory exists and is writable
      await fs.mkdir(this.basePath, { recursive: true });

      // Test write access (use prefix if configured)
      const testPath = this.keyPrefix ? path.join(this.basePath, this.keyPrefix) : this.basePath;
      await fs.mkdir(testPath, { recursive: true });
      const testFile = path.join(testPath, '.storage-test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);

      this.logger.log('Storage connection test successful');
      return true;
    } catch (error) {
      this.logger.error('Storage connection test failed', error);
      return false;
    }
  }

  /**
   * Delete all files with the given prefix
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    const sanitizedPrefix = this.sanitizeKey(prefix);
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const fullPath = path.join(this.basePath, storagePrefix);
    const failed: string[] = [];

    try {
      // Check if directory exists
      await fs.access(fullPath);

      // Count files before deletion
      const files = await this.listKeysRecursiveInternal(fullPath);
      const count = files.length;

      // Delete directory recursively
      await fs.rm(fullPath, { recursive: true, force: true });

      // Try to clean up empty parent directories
      await this.removeEmptyDirectories(path.dirname(fullPath));

      this.logger.log(`Deleted ${count} files with prefix: ${storagePrefix}`);
      return { deleted: count, failed };
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist - nothing to delete
        return { deleted: 0, failed };
      }
      this.logger.error(`Failed to delete prefix: ${storagePrefix}`, error);
      throw error;
    }
  }

  /**
   * Internal helper to list files recursively and return paths
   */
  private async listKeysRecursiveInternal(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return this.listKeysRecursiveInternal(fullPath);
        }
        // Skip metadata files
        if (entry.name.endsWith('.meta.json')) {
          return [];
        }
        return [fullPath];
      }),
    );
    return files.flat();
  }

  /**
   * Sanitize storage key to prevent path traversal attacks
   */
  private sanitizeKey(key: string): string {
    // Remove leading/trailing slashes
    key = key.replace(/^\/+|\/+$/g, '');

    // Prevent path traversal
    if (key.includes('..')) {
      throw new Error('Invalid storage key: path traversal detected');
    }

    // Ensure key is URL-safe
    if (!/^[a-zA-Z0-9\/_.-]+$/.test(key)) {
      throw new Error('Invalid storage key: contains unsafe characters');
    }

    return key;
  }

  /**
   * Recursively list all files in a directory
   */
  private async listKeysRecursive(
    currentPath: string,
    basePath: string,
    keys: string[],
  ): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      // Skip metadata files
      if (entry.name.endsWith('.meta.json')) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.listKeysRecursive(fullPath, basePath, keys);
      } else if (entry.isFile()) {
        // Convert absolute path to relative key
        const relativeKey = path.relative(basePath, fullPath);
        // Normalize path separators to forward slashes (for consistency)
        const normalizedKey = relativeKey.split(path.sep).join('/');
        keys.push(normalizedKey);
      }
    }
  }

  /**
   * Remove empty parent directories after file deletion
   */
  private async removeEmptyDirectories(dirPath: string): Promise<void> {
    // Don't delete the base directory
    if (dirPath === this.basePath || !dirPath.startsWith(this.basePath)) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath);
      if (entries.length === 0) {
        await fs.rmdir(dirPath);
        // Recursively try to remove parent
        await this.removeEmptyDirectories(path.dirname(dirPath));
      }
    } catch {
      // Ignore errors (directory not empty or doesn't exist)
    }
  }

  /**
   * Guess MIME type from file extension
   */
  private guessMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.txt': 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
