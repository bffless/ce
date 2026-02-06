import { Injectable, Logger } from '@nestjs/common';
import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { IStorageAdapter, FileMetadata } from './storage.interface';
import { AzureBlobStorageConfig, validateAzureConfig } from './azure.config';

/**
 * Azure Blob Storage Adapter
 *
 * Implements IStorageAdapter for Azure Blob Storage.
 * Supports account key, connection string, and managed identity authentication.
 */
@Injectable()
export class AzureBlobStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(AzureBlobStorageAdapter.name);
  private readonly containerClient: ContainerClient;
  private readonly blobServiceClient: BlobServiceClient;
  private readonly config: AzureBlobStorageConfig;
  private readonly sharedKeyCredential?: StorageSharedKeyCredential;
  private readonly keyPrefix: string;

  constructor(config: AzureBlobStorageConfig) {
    validateAzureConfig(config);

    this.config = config;
    this.keyPrefix = config.keyPrefix || '';

    // Determine endpoint
    const endpoint =
      config.endpoint || `https://${config.accountName}.blob.core.windows.net`;

    // Initialize client based on authentication method
    if (config.connectionString) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
      // Extract account key from connection string for SAS generation
      const keyMatch = config.connectionString.match(/AccountKey=([^;]+)/);
      if (keyMatch) {
        this.sharedKeyCredential = new StorageSharedKeyCredential(
          config.accountName,
          keyMatch[1],
        );
      }
    } else if (config.accountKey) {
      this.sharedKeyCredential = new StorageSharedKeyCredential(
        config.accountName,
        config.accountKey,
      );
      this.blobServiceClient = new BlobServiceClient(endpoint, this.sharedKeyCredential);
    } else if (config.useManagedIdentity) {
      // Use managed identity
      const credential = config.managedIdentityClientId
        ? new ManagedIdentityCredential(config.managedIdentityClientId)
        : new DefaultAzureCredential();
      this.blobServiceClient = new BlobServiceClient(endpoint, credential);
    } else {
      throw new Error('Azure Blob Storage requires authentication configuration');
    }

    this.containerClient = this.blobServiceClient.getContainerClient(config.containerName);

    this.logger.log(
      `Initialized AzureBlobStorageAdapter: account=${config.accountName}, container=${config.containerName}` +
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
   * Upload a file to Azure Blob Storage
   */
  async upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);

    const contentType =
      metadata?.mimeType || metadata?.['content-type'] || 'application/octet-stream';

    try {
      await blockBlobClient.upload(file, file.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
        tier: this.config.accessTier || 'Hot',
        metadata: this.normalizeMetadata(metadata),
      });

      this.logger.log(`Uploaded file to Azure Blob: ${storageKey}`);
      return sanitizedKey; // Return unprefixed key to caller
    } catch (error: any) {
      this.logger.error(`Failed to upload file to Azure Blob: ${storageKey}`, error);
      throw new Error(`Azure Blob upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from Azure Blob Storage
   */
  async download(key: string): Promise<Buffer> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);

    try {
      const downloadResponse = await blockBlobClient.download(0);

      if (!downloadResponse.readableStreamBody) {
        throw new Error('Empty response body');
      }

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to download file from Azure Blob: ${storageKey}`, error);
      throw new Error(`Azure Blob download failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from Azure Blob Storage
   */
  async delete(key: string): Promise<void> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);

    try {
      await blockBlobClient.deleteIfExists();
      this.logger.log(`Deleted file from Azure Blob: ${storageKey}`);
    } catch (error: any) {
      this.logger.warn(`Failed to delete file from Azure Blob: ${storageKey}`, error);
    }
  }

  /**
   * Check if a file exists in Azure Blob Storage
   */
  async exists(key: string): Promise<boolean> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);

    try {
      return await blockBlobClient.exists();
    } catch (error: any) {
      this.logger.error(`Failed to check existence in Azure Blob: ${storageKey}`, error);
      throw error;
    }
  }

  /**
   * Get a SAS URL for accessing the file
   */
  async getUrl(key: string, expiresIn?: number): Promise<string> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);
    const expiration = expiresIn ?? this.config.sasUrlExpiration ?? 3600;

    try {
      // If we have shared key credential, generate SAS URL
      if (this.sharedKeyCredential) {
        const sasOptions = {
          containerName: this.config.containerName,
          blobName: storageKey,
          permissions: BlobSASPermissions.parse('r'), // Read only
          startsOn: new Date(),
          expiresOn: new Date(Date.now() + expiration * 1000),
          protocol: SASProtocol.HttpsAndHttp,
        };

        const sasToken = generateBlobSASQueryParameters(
          sasOptions,
          this.sharedKeyCredential,
        ).toString();

        return `${blockBlobClient.url}?${sasToken}`;
      }

      // For managed identity, use user delegation key (requires additional setup)
      // Fall back to just returning the blob URL (requires container to be public or have other access)
      this.logger.warn(
        'SAS URL generation requires account key. Using blob URL without SAS token.',
      );
      return blockBlobClient.url;
    } catch (error: any) {
      this.logger.error(`Failed to generate SAS URL: ${storageKey}`, error);
      throw new Error(`Failed to generate SAS URL: ${error.message}`);
    }
  }

  /**
   * List all storage keys with optional prefix
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const sanitizedPrefix = prefix ? this.sanitizeKey(prefix) : '';
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const keys: string[] = [];

    try {
      const listOptions = storagePrefix ? { prefix: storagePrefix } : {};

      for await (const blob of this.containerClient.listBlobsFlat(listOptions)) {
        keys.push(this.unprefixKey(blob.name));
      }

      return keys;
    } catch (error: any) {
      this.logger.error('Failed to list Azure Blob objects', error);
      throw new Error(`Failed to list objects: ${error.message}`);
    }
  }

  /**
   * Get file metadata without downloading
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const sanitizedKey = this.sanitizeKey(key);
    const storageKey = this.prefixKey(sanitizedKey);
    const blockBlobClient = this.containerClient.getBlockBlobClient(storageKey);

    try {
      const properties = await blockBlobClient.getProperties();

      return {
        key: sanitizedKey, // Return unprefixed key
        size: properties.contentLength ?? 0,
        mimeType: properties.contentType,
        lastModified: properties.lastModified,
        etag: properties.etag?.replace(/"/g, ''),
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new Error(`File not found: ${key}`);
      }
      this.logger.error(`Failed to get metadata from Azure Blob: ${storageKey}`, error);
      throw new Error(`Failed to get metadata: ${error.message}`);
    }
  }

  /**
   * Test Azure Blob Storage connection and container accessibility
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test container exists and is accessible
      const containerExists = await this.containerClient.exists();

      if (!containerExists) {
        this.logger.log(`Container does not exist, creating: ${this.config.containerName}`);
        await this.containerClient.create();
      }

      // Test list operation
      const iterator = this.containerClient.listBlobsFlat().byPage({ maxPageSize: 1 });
      await iterator.next();

      // Test write operation with a temporary file (use prefix if configured)
      const testKey = this.prefixKey('.storage-connection-test');
      const testBlobClient = this.containerClient.getBlockBlobClient(testKey);
      const testData = Buffer.from('connection-test');

      await testBlobClient.upload(testData, testData.length);

      // Test read operation
      const exists = await testBlobClient.exists();
      if (!exists) {
        return false;
      }

      // Clean up test file
      await testBlobClient.deleteIfExists();

      this.logger.log('Azure Blob connection test successful');
      return true;
    } catch (error: any) {
      this.logger.error('Azure Blob connection test failed', error);
      return false;
    }
  }

  /**
   * Delete all files with the given prefix
   */
  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    const sanitizedPrefix = this.sanitizeKey(prefix);
    const storagePrefix = this.prefixKey(sanitizedPrefix);
    const blobNames: string[] = [];
    const failed: string[] = [];

    try {
      // List all blobs with prefix
      const listOptions = { prefix: storagePrefix };
      for await (const blob of this.containerClient.listBlobsFlat(listOptions)) {
        blobNames.push(blob.name);
      }

      if (blobNames.length === 0) {
        return { deleted: 0, failed };
      }

      // Delete blobs in batches
      const batchSize = 100;
      for (let i = 0; i < blobNames.length; i += batchSize) {
        const batch = blobNames.slice(i, i + batchSize);
        const deletePromises = batch.map(async (blobName) => {
          try {
            const blobClient = this.containerClient.getBlockBlobClient(blobName);
            await blobClient.deleteIfExists();
          } catch (error: any) {
            failed.push(this.unprefixKey(blobName));
            this.logger.error(`Failed to delete ${blobName}:`, error.message);
          }
        });
        await Promise.all(deletePromises);
      }

      this.logger.log(
        `Deleted ${blobNames.length - failed.length} files with prefix: ${storagePrefix}`,
      );
      return { deleted: blobNames.length - failed.length, failed };
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

    // Azure blob names are fairly permissive but we restrict to safe characters
    if (!/^[a-zA-Z0-9\/_.\-]+$/.test(key)) {
      throw new Error('Invalid storage key: contains unsafe characters');
    }

    return key;
  }

  /**
   * Normalize metadata for Azure Blob Storage
   * Azure metadata keys must be valid C# identifiers
   */
  private normalizeMetadata(metadata?: Record<string, any>): Record<string, string> {
    if (!metadata) return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Skip standard headers
      if (key === 'mimeType' || key === 'content-type') continue;

      // Azure metadata keys must be valid C# identifiers
      // Start with letter, contain only letters, numbers, underscores
      const normalizedKey = key
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^[^a-zA-Z]/, 'x');

      if (normalizedKey && value !== undefined && value !== null) {
        normalized[normalizedKey] = String(value).substring(0, 1024);
      }
    }
    return normalized;
  }
}
