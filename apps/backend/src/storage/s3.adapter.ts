import { Injectable, Logger } from '@nestjs/common';
import { MinioStorageAdapter, MinioConfig } from './minio.adapter';
import { S3StorageConfig, validateS3Config } from './s3.config';

/**
 * AWS S3 Storage Adapter
 *
 * Extends MinioStorageAdapter to connect to AWS S3.
 * The MinIO client is fully S3-compatible - no additional dependencies needed.
 *
 * Supported:
 * - AWS S3 (native)
 * - S3-compatible services (DigitalOcean Spaces, Backblaze B2, Cloudflare R2, Wasabi)
 *
 * Authentication:
 * - Access key + secret key (required)
 * - IAM roles NOT supported (use MinIO Gateway if needed)
 */
@Injectable()
export class S3StorageAdapter extends MinioStorageAdapter {
  private readonly s3Logger = new Logger(S3StorageAdapter.name);

  constructor(config: S3StorageConfig) {
    // Validate S3-specific configuration
    validateS3Config(config);

    // Parse endpoint or construct AWS S3 endpoint
    const endpointInfo = S3StorageAdapter.parseEndpoint(config);

    // Convert S3 config to MinIO config format
    const minioConfig: MinioConfig = {
      endPoint: endpointInfo.host,
      port: endpointInfo.port,
      useSSL: endpointInfo.useSSL,
      accessKey: config.accessKeyId,
      secretKey: config.secretAccessKey,
      bucket: config.bucket,
      region: config.region,
      keyPrefix: config.keyPrefix,
    };

    // Call parent constructor with S3 adapter name for logging
    super(minioConfig, 'S3StorageAdapter');

    this.s3Logger.log(
      `Initialized S3StorageAdapter: region=${config.region}, bucket=${config.bucket}` +
        (config.endpoint ? `, endpoint=${config.endpoint}` : ' (AWS S3)'),
    );
  }

  /**
   * Parse endpoint URL or construct AWS S3 endpoint
   */
  private static parseEndpoint(config: S3StorageConfig): {
    host: string;
    port: number;
    useSSL: boolean;
  } {
    if (config.endpoint) {
      // Custom endpoint (S3-compatible service)
      try {
        const url = new URL(config.endpoint);
        return {
          host: url.hostname,
          port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
          useSSL: url.protocol === 'https:',
        };
      } catch {
        throw new Error(`Invalid endpoint URL: ${config.endpoint}`);
      }
    }

    // Default AWS S3 endpoint
    return {
      host: `s3.${config.region}.amazonaws.com`,
      port: 443,
      useSSL: true,
    };
  }
}
