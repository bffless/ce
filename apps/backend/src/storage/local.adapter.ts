import { Injectable, Logger } from '@nestjs/common';
import {
  IStorageAdapter,
  FileMetadata,
  StreamDownloadResult,
  DownloadStreamOptions,
} from './storage.interface';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  derivePresignKey,
  signLocalUpload,
  hasRealPresignSecret,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_EXPIRES_IN_SECONDS,
} from './presign.util';

/** Path the local presigned-upload route is mounted at. */
export const LOCAL_PRESIGN_PATH = '/api/storage/presigned/local';

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
  private readonly publicOrigin: string | null;
  private readonly presignKey: Buffer;
  private readonly hasExplicitPresignKey: boolean;
  private readonly maxUploadBytes: number;

  constructor(config: {
    localPath: string;
    baseUrl?: string;
    keyPrefix?: string;
    publicOrigin?: string;
    presignKey?: Buffer;
    maxUploadBytes?: number;
  }) {
    this.basePath = path.resolve(config.localPath);
    this.baseUrl = config.baseUrl || 'http://localhost:3000/files'; // @TODO baseUrl of /files does not make sense, no sure baseUrl is used for anything?
    this.keyPrefix = config.keyPrefix || '';

    // Presigned-upload config. `publicOrigin` is deliberately separate from the
    // vestigial `baseUrl` above: threading presigned URLs through that would
    // silently mint localhost URLs on a real install.
    this.publicOrigin = config.publicOrigin?.replace(/\/+$/, '') ?? null;
    this.presignKey = config.presignKey ?? derivePresignKey();
    this.hasExplicitPresignKey = config.presignKey !== undefined;
    this.maxUploadBytes = config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

    this.logger.log(
      `Initialized LocalStorageAdapter with basePath: ${this.basePath}` +
        (this.keyPrefix ? `, keyPrefix: ${this.keyPrefix}` : '') +
        `, presignedUploads: ${this.publicOrigin ? 'enabled' : 'disabled (no public origin)'}`,
    );
  }

  /** Marker used to narrow the active adapter without instanceof across module boundaries. */
  readonly isLocalAdapter = true;

  /** Absolute storage root. Used by the presigned-upload route. */
  getStorageBasePath(): string {
    return this.basePath;
  }

  /** Presign key this adapter mints with; the route verifies against it. */
  getPresignKey(): Buffer {
    return this.presignKey;
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
   * Download a file as a stream without buffering into memory
   */
  async downloadStream(
    key: string,
    opts?: DownloadStreamOptions,
  ): Promise<StreamDownloadResult> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const fullPath = path.join(this.basePath, storageKey);

    try {
      const stats = await fs.stat(fullPath);
      // fs.createReadStream start/end are inclusive byte offsets (HTTP Range).
      const hasRange = opts?.start !== undefined || opts?.end !== undefined;
      const stream = hasRange
        ? fsSync.createReadStream(fullPath, { start: opts?.start ?? 0, end: opts?.end })
        : fsSync.createReadStream(fullPath);
      const mimeType = this.guessMimeType(sanitizedKey);

      return {
        stream,
        size: stats.size,
        mimeType,
        lastModified: stats.mtime,
      };
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
   * Local storage serves files through the backend API rather than presigning,
   * so there is no signature to embed a `Content-Disposition` into. A
   * `SignedUrlOptions.downloadFilename` passed here is deliberately IGNORED —
   * the browser will render the object inline. Presigned-only apps (e.g. Studio,
   * whose uploads bypass the 1 MB body cap) cannot run on local storage anyway.
   */
  async getUrl(key: string): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    // For local storage, we'll serve files through the backend API
    // The URL format will be: {baseUrl}/{key} (unprefixed for external access)
    return `${this.baseUrl}/${sanitizedKey}`;
  }

  /**
   * Local storage supports presigned uploads via a same-origin, HMAC-signed
   * PUT route. Requires a resolvable public origin to mint absolute URLs, AND
   * real signing material: either an explicitly configured `presignKey`, or a
   * non-default secret in the environment (`hasRealPresignSecret`).
   *
   * Without one of those, `derivePresignKey()` above degrades to a hardcoded
   * dev-fallback string rather than throwing (so construction never crashes),
   * but that fallback is a PUBLIC CONSTANT — the sole "authorization" on the
   * upload route would then be forgeable by anyone. Fail closed here instead:
   * don't advertise presigned support when the only signing material backing
   * it is public. `ENCRYPTION_KEY` is mandatory in CE setup, so this should
   * never trigger in practice — but ENABLE_LOCAL_PRESIGNED_UPLOADS defaults
   * to on, so this is the backstop for a misconfigured install rather than a
   * theoretical concern.
   */
  supportsPresignedUrls(): boolean {
    if (this.publicOrigin === null) return false;
    return this.hasExplicitPresignKey || hasRealPresignSecret();
  }

  /**
   * Mint a signed, time-bounded, size-capped upload URL.
   *
   * The signature covers the PREFIXED key so it matches exactly what the route
   * will write, and `max` is signed so a client cannot raise its own cap.
   */
  async getPresignedUploadUrl(key: string, expiresIn = MAX_EXPIRES_IN_SECONDS): Promise<string> {
    if (!this.publicOrigin) {
      throw new Error(
        'Presigned local uploads are not available: no public origin configured ' +
          '(set PUBLIC_ORIGIN or PRIMARY_DOMAIN).',
      );
    }

    if (!Number.isFinite(expiresIn)) {
      throw new TypeError('expiresIn must be a finite number');
    }

    const storageKey = this.prefixKey(this.sanitizeKey(key));
    const ttl = Math.min(Math.max(1, Math.floor(expiresIn)), MAX_EXPIRES_IN_SECONDS);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const max = this.maxUploadBytes;
    const sig = signLocalUpload({ key: storageKey, exp, max }, this.presignKey);

    const url = new URL(LOCAL_PRESIGN_PATH, this.publicOrigin);
    url.searchParams.set('key', Buffer.from(storageKey, 'utf8').toString('base64url'));
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('max', String(max));
    url.searchParams.set('sig', sig);
    return url.toString();
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
