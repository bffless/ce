/**
 * Storage Key Format Convention (Critical for Migration & Deployments)
 *
 * GitHub-style format with asset type prefix that works across all storage types:
 * {owner}/{repo}/{assetType}/{identifier}/{path}/{filename}
 *
 * Asset Types:
 *   - commits: Git-versioned deployment files (identifier = commitSha)
 *   - uploads: User-uploaded content (future - identifier = uploadId)
 *   - static: Persistent shared assets (future - identifier = path)
 *
 * Commit Examples:
 *   "owner/repo/commits/abc123def456/index.html"
 *   "owner/repo/commits/abc123def456/css/style.css"
 *   "owner/repo/commits/abc123def456/images/logo.png"
 *
 * Benefits:
 * - Matches GitHub repository structure (intuitive)
 * - Asset type prefix enables future expansion (uploads, static assets)
 * - SHA provides immutability and uniqueness (no UUID needed)
 * - Preserves directory structure within deployment
 * - Aligns with SHA-based deployment URLs: /public/{owner}/{repo}/commits/{sha}/{path}
 * - No leading/trailing slashes (works on local + object storage)
 * - URL-safe characters only
 * - Easy to migrate between storage backends
 * - Easy to find all files for a specific commit: listKeys("owner/repo/commits/abc123/")
 */

/**
 * Injection token for the storage adapter
 */
export const STORAGE_ADAPTER = 'STORAGE_ADAPTER';

export interface FileMetadata {
  key: string;
  size: number;
  mimeType?: string;
  lastModified?: Date;
  etag?: string;
}

/**
 * Result from downloadWithCacheInfo including cache status
 */
export interface DownloadResult {
  data: Buffer;
  /**
   * Cache status:
   * - 'memory': Served from in-memory cache
   * - 'redis': Served from Redis cache
   * - 'miss': Cache miss, fetched from storage
   * - 'none': No caching layer (direct storage access)
   */
  cacheHit: 'memory' | 'redis' | 'miss' | 'none';
}

export interface IStorageAdapter {
  /**
   * Upload a file to storage
   * @param file - File buffer
   * @param key - Storage key/path (use GitHub-style format)
   * @param metadata - Optional metadata (mimeType, etc.)
   * @returns Storage key of uploaded file
   */
  upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string>;

  /**
   * Download a file from storage
   * @param key - Storage key/path
   * @returns File buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Download a file from storage with cache information
   * @param key - Storage key/path
   * @param ttlHint - Optional TTL hint in seconds for cache storage (from cache rules)
   * @returns Object with file buffer and cache hit status
   */
  downloadWithCacheInfo?(key: string, ttlHint?: number): Promise<DownloadResult>;

  /**
   * Delete a file from storage
   * @param key - Storage key/path
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param key - Storage key/path
   * @returns true if file exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get a URL for accessing the file
   * @param key - Storage key/path
   * @param expiresIn - Optional expiration time in seconds (for presigned URLs)
   * @returns URL to access the file
   */
  getUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * List all storage keys with optional prefix filter
   * REQUIRED for storage migration functionality
   * @param prefix - Optional prefix to filter keys (e.g., "owner/repo/abc123/")
   * @returns Array of storage keys
   */
  listKeys(prefix?: string): Promise<string[]>;

  /**
   * Get file metadata without downloading the entire file
   * REQUIRED for efficient storage migration and scanning
   * @param key - Storage key/path
   * @returns File metadata
   */
  getMetadata(key: string): Promise<FileMetadata>;

  /**
   * Test storage connection and accessibility
   * @returns true if connection is successful
   */
  testConnection(): Promise<boolean>;

  /**
   * Delete all files with the given prefix
   * Used for batch deletion (e.g., deleting all files for a commit)
   * @param prefix - The key prefix to delete (e.g., "owner/repo/commitSha/")
   * @returns Object with count of deleted files and any failures
   */
  deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }>;

  /**
   * Check if the storage adapter supports presigned upload URLs
   * Used to determine if direct uploads from CI/CD are possible
   * @returns true if presigned URLs are supported
   */
  supportsPresignedUrls?(): boolean;

  /**
   * Generate a presigned URL for uploading a file directly to storage
   * This allows clients to upload directly without going through the backend
   * @param key - Storage key/path for the file
   * @param expiresIn - Optional expiration time in seconds (default: 3600)
   * @returns Presigned URL for PUT operation
   */
  getPresignedUploadUrl?(key: string, expiresIn?: number): Promise<string>;
}
