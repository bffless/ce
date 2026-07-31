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
        `, presignedUploads: ${
          this.hasExplicitPresignKey || hasRealPresignSecret()
            ? `enabled (${this.publicOrigin ? 'absolute' : 'relative'} URLs)`
            : 'disabled (no real signing secret)'
        }`,
    );
  }

  /** Marker used to narrow the active adapter without instanceof across module boundaries. */
  readonly isLocalAdapter = true;

  /** Absolute storage root. Used by the presigned-upload route and the temp-file sweeper. */
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
    // Percent-encode each path segment (not the whole key, which would also
    // encode the `/` separators): a raw key can contain characters that are
    // invalid in an HTTP header when this URL is later used as a redirect
    // Location (e.g. a macOS screenshot filename with U+202F narrow no-break
    // space), which throws ERR_INVALID_CHAR from Node's setHeader. Express
    // decodes route params on the serving side, so resolution is unchanged.
    const encodedKey = sanitizedKey.split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/${encodedKey}`;
  }

  /**
   * Local storage supports presigned uploads via a same-origin, HMAC-signed
   * PUT route, mounted on the app's own host (see the per-domain nginx
   * templates' `location = /api/storage/presigned/local`). Because the URL is
   * relative by default (`getPresignedUploadUrl` below), minting one needs no
   * resolvable public origin — only real signing material: either an
   * explicitly configured `presignKey`, or a non-default secret in the
   * environment (`hasRealPresignSecret`). `publicOrigin` is now an explicit
   * override for callers that need an absolute URL, not a precondition.
   *
   * Without real signing material, `derivePresignKey()` above degrades to a
   * hardcoded dev-fallback string rather than throwing (so construction never
   * crashes), but that fallback is a PUBLIC CONSTANT — the sole
   * "authorization" on the upload route would then be forgeable by anyone.
   * Fail closed here instead: don't advertise presigned support when the only
   * signing material backing it is public. `ENCRYPTION_KEY` is mandatory in
   * CE setup, so this should never trigger in practice — but
   * ENABLE_LOCAL_PRESIGNED_UPLOADS defaults to on, so this is the backstop
   * for a misconfigured install rather than a theoretical concern.
   */
  supportsPresignedUrls(): boolean {
    return this.hasExplicitPresignKey || hasRealPresignSecret();
  }

  /**
   * Mint a signed, time-bounded, size-capped upload URL.
   *
   * The signature covers the PREFIXED key so it matches exactly what the route
   * will write, and `max` is signed so a client cannot raise its own cap.
   *
   * Shape: RELATIVE (`/api/storage/presigned/local?...`) unless `publicOrigin`
   * was explicitly configured, in which case the URL is absolute as before.
   * A relative URL is resolved by the browser against whichever host served
   * the page, which is exactly the app's own host — the per-domain nginx
   * templates proxy this path there unrewritten. That makes "same-origin, no
   * CORS" true by construction instead of by assuming the mint-time origin
   * matches the app's serving host (it didn't -- an absolute URL minted at
   * PRIMARY_DOMAIN pointed at an nginx vhost that doesn't route /api to the
   * backend at all; see
   * docs/superpowers/specs/2026-07-30-local-fs-presigned-uploads-design.md,
   * section "Correction: upload URL routing").
   *
   * `maxBytes`, when provided, NARROWS the signed `max` below the adapter's
   * own ceiling (`this.maxUploadBytes`, normally `DEFAULT_MAX_UPLOAD_BYTES`).
   * It can only tighten, never widen: a step configuring a larger
   * `maxFileSize` than the adapter's own cap still gets the adapter's cap.
   * This lets a pipeline step's `maxFileSize` (e.g. a public
   * `/api/uploads/prepare` rule meant only for small avatars) actually bound
   * what gets signed, instead of every presigned URL always carrying the
   * same 100 MiB ceiling regardless of the step's own configured limit.
   */
  async getPresignedUploadUrl(
    key: string,
    expiresIn = MAX_EXPIRES_IN_SECONDS,
    maxBytes?: number,
  ): Promise<string> {
    if (!Number.isFinite(expiresIn)) {
      throw new TypeError('expiresIn must be a finite number');
    }

    const storageKey = this.prefixKey(this.sanitizeKey(key));
    const ttl = Math.min(Math.max(1, Math.floor(expiresIn)), MAX_EXPIRES_IN_SECONDS);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const max =
      typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.min(this.maxUploadBytes, Math.floor(maxBytes))
        : this.maxUploadBytes;
    const sig = signLocalUpload({ key: storageKey, exp, max }, this.presignKey);

    const params = new URLSearchParams();
    params.set('key', Buffer.from(storageKey, 'utf8').toString('base64url'));
    params.set('exp', String(exp));
    params.set('max', String(max));
    params.set('sig', sig);

    if (!this.publicOrigin) {
      return `${LOCAL_PRESIGN_PATH}?${params.toString()}`;
    }

    const url = new URL(LOCAL_PRESIGN_PATH, this.publicOrigin);
    url.search = params.toString();
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

/**
 * Narrow the active (possibly wrapped) storage adapter down to a
 * `LocalStorageAdapter`, or `null` when the active backend isn't local.
 *
 * The active `IStorageAdapter` may be a `DynamicStorageAdapter`
 * (`getUnderlyingAdapter()`) and/or a `CachingStorageAdapter`
 * (`getWrappedAdapter()`), and in production both together: the setup-wizard
 * flow wraps as `DynamicStorageAdapter(CachingStorageAdapter(LocalStorageAdapter))`.
 * This checks the adapter itself, one level of unwrapping, and — for that
 * nested case — a second level from whichever wrapper was found first, so it
 * resolves correctly regardless of which single wrapper (or both, in that
 * order) is present.
 *
 * Shared by the presigned-upload route and the temp-file sweep cron so there
 * is exactly one place that understands this wrapping, instead of each
 * caller re-deriving (and potentially under-handling) it.
 *
 * MAXIMUM SUPPORTED WRAPPER DEPTH IS 2 (bare adapter, or one wrapper, or two
 * nested wrappers — Dynamic(Caching(Local)) or Caching(Dynamic(Local))). If a
 * third wrapper is ever introduced around the local adapter, this function
 * returns `null` for it — i.e. it fails CLOSED (every caller here treats
 * `null` as "not local", which is the safe direction: the presigned route
 * 404s instead of misrouting a signed upload, and the sweeper simply skips a
 * backend it doesn't recognize). That reads as "the feature stopped working
 * for no reason" rather than crashing, so if presigned uploads or the sweep
 * mysteriously stop finding a local adapter after a storage-layer refactor,
 * check whether a new wrapper was added and extend the `candidates` walk
 * below to match.
 */
export function resolveLocalAdapter(adapter: unknown): LocalStorageAdapter | null {
  const candidates: unknown[] = [adapter];
  const wrapper = adapter as {
    getUnderlyingAdapter?: () => unknown;
    getWrappedAdapter?: () => unknown;
  };
  if (wrapper?.getUnderlyingAdapter) candidates.push(wrapper.getUnderlyingAdapter());
  if (wrapper?.getWrappedAdapter) candidates.push(wrapper.getWrappedAdapter());

  for (const candidate of candidates) {
    const c = candidate as { isLocalAdapter?: boolean } & Record<string, unknown>;
    if (c?.isLocalAdapter) return c as unknown as LocalStorageAdapter;
    const inner = ((c as any)?.getUnderlyingAdapter?.() ?? (c as any)?.getWrappedAdapter?.()) as
      | ({ isLocalAdapter?: boolean } & Record<string, unknown>)
      | undefined;
    if (inner?.isLocalAdapter) return inner as unknown as LocalStorageAdapter;
  }
  return null;
}
