import { Injectable, Logger } from '@nestjs/common';
import { Storage, Bucket, GetSignedUrlConfig } from '@google-cloud/storage';
import { IStorageAdapter, FileMetadata } from './storage.interface';
import { GcsStorageConfig, validateGcsConfig } from './gcs.config';

/**
 * Google Cloud Storage Adapter
 *
 * Implements IStorageAdapter for Google Cloud Storage.
 * Supports service account authentication, workload identity, and ADC.
 */
@Injectable()
export class GcsStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(GcsStorageAdapter.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly config: GcsStorageConfig;
  private readonly keyPrefix: string;

  constructor(config: GcsStorageConfig) {
    validateGcsConfig(config);

    this.config = config;
    this.keyPrefix = config.keyPrefix || '';

    // Initialize Storage client with appropriate credentials
    const storageOptions: ConstructorParameters<typeof Storage>[0] = {
      projectId: config.projectId,
    };

    if (config.keyFilename) {
      storageOptions.keyFilename = config.keyFilename;
    } else if (config.credentials) {
      storageOptions.credentials = {
        client_email: config.credentials.client_email,
        private_key: config.credentials.private_key,
      };
    }
    // If useApplicationDefaultCredentials is true or no auth specified,
    // Storage client will use ADC automatically

    this.storage = new Storage(storageOptions);
    this.bucket = this.storage.bucket(config.bucket);

    this.logger.log(
      `Initialized GcsStorageAdapter: project=${config.projectId}, bucket=${config.bucket}` +
        (this.keyPrefix ? `, keyPrefix=${this.keyPrefix}` : ''),
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
   * Upload a file to GCS
   */
  async upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);

    const contentType =
      metadata?.mimeType || metadata?.['content-type'] || 'application/octet-stream';

    try {
      await blob.save(file, {
        contentType,
        metadata: {
          metadata: this.normalizeMetadata(metadata),
        },
        // Set storage class if configured
        ...(this.config.storageClass && {
          storageClass: this.config.storageClass,
        }),
      });

      this.logger.log(`Uploaded file to GCS: ${storageKey}`);
      return sanitizedKey; // Return unprefixed key to caller
    } catch (error: any) {
      this.logger.error(`Failed to upload file to GCS: ${storageKey}`, error);
      throw new Error(`GCS upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from GCS
   */
  async download(key: string): Promise<Buffer> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);

    try {
      const [content] = await blob.download();
      return content;
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to download file from GCS: ${storageKey}`, error);
      throw new Error(`GCS download failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from GCS
   */
  async delete(key: string): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);

    try {
      await blob.delete({ ignoreNotFound: true });
      this.logger.log(`Deleted file from GCS: ${storageKey}`);
    } catch (error: any) {
      this.logger.warn(`Failed to delete file from GCS: ${storageKey}`, error);
    }
  }

  /**
   * Check if a file exists in GCS
   */
  async exists(key: string): Promise<boolean> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);

    try {
      const [exists] = await blob.exists();
      return exists;
    } catch (error: any) {
      this.logger.error(`Failed to check existence in GCS: ${storageKey}`, error);
      throw error;
    }
  }

  /**
   * Get a signed URL for accessing the file (read)
   */
  async getUrl(key: string, expiresIn?: number): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);
    const expiration = expiresIn ?? this.config.signedUrlExpiration ?? 3600;

    const options: GetSignedUrlConfig = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiration * 1000,
    };

    try {
      const [url] = await blob.getSignedUrl(options);
      return url;
    } catch (error: any) {
      this.logger.error(`Failed to generate signed URL: ${storageKey}`, error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Check if presigned upload URLs are supported
   */
  supportsPresignedUrls(): boolean {
    return true;
  }

  /**
   * Generate a signed URL for uploading a file directly to storage (write)
   */
  async getPresignedUploadUrl(key: string, expiresIn?: number): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);
    const expiration = expiresIn ?? this.config.signedUrlExpiration ?? 3600;

    const options: GetSignedUrlConfig = {
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiration * 1000,
    };

    try {
      const [url] = await blob.getSignedUrl(options);
      return url;
    } catch (error: any) {
      this.logger.error(`Failed to generate signed upload URL: ${storageKey}`, error);
      throw new Error(`Failed to generate signed upload URL: ${error.message}`);
    }
  }

  /**
   * List all storage keys with optional prefix
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const sanitizedPrefix = prefix ? this.sanitizeKey(prefix) : '';
    const storagePrefix = this.prefixKey(sanitizedPrefix);

    try {
      const [files] = await this.bucket.getFiles({
        prefix: storagePrefix || undefined,
        autoPaginate: true,
      });

      return files.map((file) => this.unprefixKey(file.name));
    } catch (error: any) {
      this.logger.error('Failed to list GCS objects', error);
      throw new Error(`Failed to list objects: ${error.message}`);
    }
  }

  /**
   * Get file metadata without downloading
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blob = this.bucket.file(storageKey);

    try {
      const [metadata] = await blob.getMetadata();

      return {
        key: sanitizedKey, // Return unprefixed key
        size: parseInt(metadata.size as string, 10) || 0,
        mimeType: metadata.contentType,
        lastModified: metadata.updated ? new Date(metadata.updated) : undefined,
        etag: metadata.etag?.replace(/"/g, ''),
      };
    } catch (error: any) {
      if (error.code === 404) {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to get metadata from GCS: ${storageKey}`, error);
      throw new Error(`Failed to get metadata: ${error.message}`);
    }
  }

  /**
   * Test GCS connection and bucket accessibility
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test bucket exists and is accessible
      const [bucketExists] = await this.bucket.exists();
      if (!bucketExists) {
        throw new Error(`GCS bucket '${this.config.bucket}' does not exist or is not accessible`);
      }

      // Test list operation
      await this.bucket.getFiles({ maxResults: 1 });

      // Test write operation with a temporary file (use prefix if configured)
      const testKey = this.prefixKey('.storage-connection-test');
      const testBlob = this.bucket.file(testKey);
      const testData = Buffer.from('connection-test');

      await testBlob.save(testData);

      // Test read operation
      const [exists] = await testBlob.exists();
      if (!exists) {
        throw new Error('Failed to verify test file after upload');
      }

      // Clean up test file
      await testBlob.delete({ ignoreNotFound: true });

      this.logger.log('GCS connection test successful');
      return true;
    } catch (error: any) {
      this.logger.error('GCS connection test failed');
      this.logger.error(error.message || error);
      // Re-throw with the original error message for better debugging
      throw new Error(error.message || 'GCS connection test failed');
    }
  }

  /**
   * Delete all files with the given prefix
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    const sanitizedPrefix = this.sanitizeKey(prefix);
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const failed: string[] = [];

    try {
      // List all files with prefix
      const [files] = await this.bucket.getFiles({
        prefix: storagePrefix,
        autoPaginate: true,
      });

      if (files.length === 0) {
        return { deleted: 0, failed };
      }

      // Delete files in batches
      const batchSize = 100;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const deletePromises = batch.map(async (file) => {
          try {
            await file.delete({ ignoreNotFound: true });
          } catch (error: any) {
            failed.push(this.unprefixKey(file.name));
            this.logger.error(`Failed to delete ${file.name}:`, error.message);
          }
        });
        await Promise.all(deletePromises);
      }

      this.logger.log(
        `Deleted ${files.length - failed.length} files with prefix: ${storagePrefix}`,
      );
      return { deleted: files.length - failed.length, failed };
    } catch (error: any) {
      this.logger.error(`Failed to delete prefix: ${storagePrefix}`, error);
      throw new Error(`Failed to delete prefix: ${error.message}`);
    }
  }

  /**
   * Sanitize storage key to prevent issues
   */
  private sanitizeKey(key: string): string {
    // Remove leading/trailing slashes
    key = key.replace(/^\/+|\/+$/g, '');

    // Prevent path traversal
    if (key.includes('..')) {
      throw new Error('Invalid storage key: path traversal detected');
    }

    // GCS is fairly permissive, but we restrict to safe characters
    if (!/^[a-zA-Z0-9\/_.\-]+$/.test(key)) {
      throw new Error('Invalid storage key: contains unsafe characters');
    }

    return key;
  }

  /**
   * Normalize metadata for GCS
   * GCS custom metadata keys must be lowercase
   */
  private normalizeMetadata(metadata?: Record<string, any>): Record<string, string> {
    if (!metadata) return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Skip standard headers
      if (key === 'mimeType' || key === 'content-type') continue;

      // GCS metadata keys must be lowercase
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      if (normalizedKey && value !== undefined && value !== null) {
        normalized[normalizedKey] = String(value).substring(0, 1024);
      }
    }
    return normalized;
  }
}
