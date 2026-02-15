import { Injectable, Logger } from '@nestjs/common';
import { IStorageAdapter, FileMetadata } from './storage.interface';
import * as Minio from 'minio';

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  /** Optional key prefix for workspace/tenant isolation */
  keyPrefix?: string;
}

/**
 * MinIO Storage Adapter
 *
 * S3-compatible object storage adapter for MinIO.
 * Can also be used with S3-compatible services.
 */
@Injectable()
export class MinioStorageAdapter implements IStorageAdapter {
  protected readonly logger: Logger;
  protected readonly adapterName: string;
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly keyPrefix: string;

  constructor(config: MinioConfig, adapterName: string = 'MinioStorageAdapter') {
    this.adapterName = adapterName;
    this.logger = new Logger(adapterName);
    this.bucket = config.bucket;
    this.region = config.region || 'us-east-1';
    this.keyPrefix = config.keyPrefix || '';

    this.client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });

    this.logger.log(
      `Initialized ${this.adapterName} with endpoint: ${config.endPoint}:${config.port}, bucket: ${this.bucket}` +
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
   * Upload a file to MinIO
   */
  async upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    // Prepare metadata for MinIO
    const minioMetadata: Record<string, string> = {};
    if (metadata) {
      // Convert metadata values to strings (MinIO requirement)
      for (const [k, v] of Object.entries(metadata)) {
        if (v !== undefined && v !== null) {
          minioMetadata[k] = String(v);
        }
      }
    }

    // Set content type if provided
    const contentType =
      metadata?.mimeType || metadata?.['content-type'] || 'application/octet-stream';

    try {
      await this.client.putObject(this.bucket, storageKey, file, file.length, {
        'Content-Type': contentType,
        ...minioMetadata,
      });

      this.logger.log(`Uploaded file: ${storageKey}`);
      return sanitizedKey; // Return unprefixed key to caller
    } catch (error) {
      this.logger.error(`Failed to upload file: ${storageKey}`, error);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from MinIO
   */
  async download(key: string): Promise<Buffer> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      const stream = await this.client.getObject(this.bucket, storageKey);

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to download file from MinIO: ${storageKey}`, error);
      throw new Error(`MinIO download failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from MinIO
   */
  async delete(key: string): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      await this.client.removeObject(this.bucket, storageKey);
      this.logger.log(`Deleted file from MinIO: ${storageKey}`);
    } catch (error) {
      // MinIO doesn't throw error if object doesn't exist
      this.logger.warn(`Failed to delete file from MinIO: ${storageKey}`, error);
    }
  }

  /**
   * Check if a file exists in MinIO
   */
  async exists(key: string): Promise<boolean> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      await this.client.statObject(this.bucket, storageKey);
      return true;
    } catch (error) {
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get presigned URL for accessing the file (GET)
   */
  async getUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      // Generate presigned URL (default 1 hour expiration)
      const url = await this.client.presignedGetObject(this.bucket, storageKey, expiresIn);
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate presigned URL: ${storageKey}`, error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Check if presigned upload URLs are supported
   */
  supportsPresignedUrls(): boolean {
    return true;
  }

  /**
   * Generate a presigned URL for uploading a file directly to storage (PUT)
   */
  async getPresignedUploadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      const url = await this.client.presignedPutObject(this.bucket, storageKey, expiresIn);
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate presigned upload URL: ${storageKey}`, error);
      throw new Error(`Failed to generate presigned upload URL: ${error.message}`);
    }
  }

  /**
   * List all storage keys with optional prefix
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const sanitizedPrefix = prefix ? this.sanitizeKey(prefix) : '';
    // Apply key prefix for storage, combining with user-provided prefix
    const storagePrefix = this.prefixKey(sanitizedPrefix);

    const keys: string[] = [];

    try {
      const stream = this.client.listObjectsV2(
        this.bucket,
        storagePrefix,
        true, // recursive
      );

      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            // Remove key prefix before returning to caller
            keys.push(this.unprefixKey(obj.name));
          }
        });
        stream.on('end', () => resolve(keys));
        stream.on('error', (error) => {
          this.logger.error('Failed to list MinIO objects', error);
          reject(new Error(`Failed to list objects: ${error.message}`));
        });
      });
    } catch (error) {
      this.logger.error('Failed to list MinIO objects', error);
      throw new Error(`Failed to list objects: ${error.message}`);
    }
  }

  /**
   * Get file metadata without downloading
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);

    try {
      const stat = await this.client.statObject(this.bucket, storageKey);

      return {
        key: sanitizedKey, // Return unprefixed key
        size: stat.size,
        mimeType: stat.metaData?.['content-type'],
        lastModified: stat.lastModified,
        etag: stat.etag,
      };
    } catch (error) {
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to get metadata from MinIO: ${storageKey}`, error);
      throw new Error(`Failed to get metadata: ${error.message}`);
    }
  }

  /**
   * Test MinIO connection
   * Throws an error with details if connection fails
   */
  async testConnection(): Promise<boolean> {
    try {
      // Check if bucket exists
      const bucketExists = await this.client.bucketExists(this.bucket);

      if (!bucketExists) {
        this.logger.log(`Bucket ${this.bucket} does not exist, creating...`);
        await this.client.makeBucket(this.bucket, this.region);
        this.logger.log(`Created bucket: ${this.bucket}`);
      }

      // Test write access with a small test object (use prefix if configured)
      const testKey = this.prefixKey('.storage-test');
      const testData = Buffer.from('test');
      await this.client.putObject(this.bucket, testKey, testData, testData.length);

      // Test read access
      await this.client.statObject(this.bucket, testKey);

      // Clean up test object
      await this.client.removeObject(this.bucket, testKey);

      this.logger.log('MinIO connection test successful');
      return true;
    } catch (error) {
      this.logger.error(`${this.adapterName} connection test failed`, error);
      // Extract useful error message for the user
      const message = this.extractS3ErrorMessage(error);
      throw new Error(message);
    }
  }

  /**
   * Extract a user-friendly error message from S3/MinIO errors
   */
  protected extractS3ErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message;
      // Check for common S3 permission errors
      if (msg.includes('not authorized to perform')) {
        // Extract the action and resource from AWS error messages
        const actionMatch = msg.match(/perform: (s3:\w+)/);
        const resourceMatch = msg.match(/resource: "([^"]+)"/);
        const action = actionMatch?.[1] || 'the required action';
        const resource = resourceMatch?.[1] || 'the bucket';
        return `Permission denied: IAM policy missing "${action}" on ${resource}. Update your IAM policy to include this permission.`;
      }
      if (msg.includes('Access Denied') || msg.includes('AccessDenied')) {
        return `Access denied: Check that your IAM policy grants access to bucket "${this.bucket}" and the credentials are correct.`;
      }
      if (msg.includes('NoSuchBucket')) {
        return `Bucket "${this.bucket}" does not exist. Create the bucket first or check for typos.`;
      }
      if (msg.includes('InvalidAccessKeyId')) {
        return 'Invalid Access Key ID. Check that the Access Key ID is correct.';
      }
      if (msg.includes('SignatureDoesNotMatch')) {
        return 'Invalid Secret Access Key. Check that the Secret Access Key is correct.';
      }
      if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        return `Cannot reach storage endpoint. Check your network connection and endpoint URL.`;
      }
      return msg;
    }
    return 'Connection test failed: Unknown error';
  }

  /**
   * Delete all files with the given prefix
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    const sanitizedPrefix = this.sanitizeKey(prefix);
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const objects: string[] = [];
    const failed: string[] = [];

    try {
      // List all objects with prefix
      const stream = this.client.listObjectsV2(this.bucket, storagePrefix, true);

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            objects.push(obj.name);
          }
        });
        stream.on('end', () => resolve());
        stream.on('error', (error) => reject(error));
      });

      if (objects.length === 0) {
        return { deleted: 0, failed };
      }

      // Delete objects in batches (MinIO supports batch deletion)
      const batchSize = 1000;
      for (let i = 0; i < objects.length; i += batchSize) {
        const batch = objects.slice(i, i + batchSize);
        try {
          await this.client.removeObjects(this.bucket, batch);
        } catch (error) {
          // Return unprefixed keys in failed list
          failed.push(...batch.map((k) => this.unprefixKey(k)));
          this.logger.error(`Failed to delete batch starting at ${i}`, error);
        }
      }

      this.logger.log(
        `Deleted ${objects.length - failed.length} files with prefix: ${storagePrefix}`,
      );
      return { deleted: objects.length - failed.length, failed };
    } catch (error) {
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

    // Ensure key is URL-safe (includes ~ for webpack chunk names like runtime~main.js)
    if (!/^[a-zA-Z0-9\/_.\-~]+$/.test(key)) {
      throw new Error('Invalid storage key: contains unsafe characters');
    }

    // MinIO keys should not start with /
    return key;
  }
}
