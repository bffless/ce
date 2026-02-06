/**
 * AWS S3 Storage Configuration
 *
 * Supports native AWS S3 and S3-compatible services
 * (DigitalOcean Spaces, Backblaze B2, Cloudflare R2, Wasabi, etc.)
 *
 * Uses MinIO client internally - fully S3-compatible.
 */
export interface S3StorageConfig {
  /**
   * AWS region (e.g., 'us-east-1', 'eu-west-1')
   * For S3-compatible services, use 'auto' or the service's region
   */
  region: string;

  /**
   * S3 bucket name
   */
  bucket: string;

  /**
   * AWS access key ID (required)
   * Note: IAM roles not supported with MinIO client approach
   */
  accessKeyId: string;

  /**
   * AWS secret access key (required)
   */
  secretAccessKey: string;

  /**
   * Custom endpoint for S3-compatible services
   * If not provided, defaults to AWS S3: s3.{region}.amazonaws.com
   *
   * Examples:
   *   - DigitalOcean: 'https://nyc3.digitaloceanspaces.com'
   *   - Backblaze: 'https://s3.us-west-000.backblazeb2.com'
   *   - Cloudflare R2: 'https://<account-id>.r2.cloudflarestorage.com'
   *   - Wasabi: 'https://s3.us-east-1.wasabisys.com'
   */
  endpoint?: string;

  /**
   * Force path-style URLs instead of virtual-hosted style
   * Required for some S3-compatible services (Backblaze, R2)
   * Default: false
   */
  forcePathStyle?: boolean;

  /**
   * Default presigned URL expiration in seconds
   * Default: 3600 (1 hour)
   * Maximum: 604800 (7 days)
   */
  presignedUrlExpiration?: number;

  /**
   * Optional key prefix for workspace/tenant isolation
   * All keys will be prefixed with this value (e.g., 'workspace-123/')
   */
  keyPrefix?: string;
}

/**
 * Validate S3 configuration
 * @throws Error if configuration is invalid
 */
export function validateS3Config(config: S3StorageConfig): void {
  if (!config.region) {
    throw new Error('S3 configuration requires region');
  }

  if (!config.bucket) {
    throw new Error('S3 configuration requires bucket name');
  }

  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new Error('S3 configuration requires accessKeyId and secretAccessKey');
  }

  // Validate presigned URL expiration
  if (config.presignedUrlExpiration !== undefined) {
    if (config.presignedUrlExpiration < 1 || config.presignedUrlExpiration > 604800) {
      throw new Error('presignedUrlExpiration must be between 1 and 604800 seconds');
    }
  }

  // Validate endpoint URL if provided
  if (config.endpoint) {
    try {
      new URL(config.endpoint);
    } catch {
      throw new Error(`Invalid endpoint URL: ${config.endpoint}`);
    }
  }
}
