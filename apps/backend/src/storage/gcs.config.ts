/**
 * Google Cloud Storage Configuration
 *
 * Supports service account authentication and workload identity
 */
export interface GcsStorageConfig {
  /**
   * GCP project ID
   */
  projectId: string;

  /**
   * GCS bucket name
   */
  bucket: string;

  /**
   * Path to service account JSON key file
   * Mutually exclusive with 'credentials'
   */
  keyFilename?: string;

  /**
   * Service account credentials object
   * Use this to pass credentials directly instead of file path
   * Mutually exclusive with 'keyFilename'
   */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id?: string;
  };

  /**
   * Storage class for new objects
   * Default: 'STANDARD'
   */
  storageClass?: 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE';

  /**
   * Signed URL expiration in seconds
   * Default: 3600 (1 hour)
   * Maximum: 604800 (7 days)
   */
  signedUrlExpiration?: number;

  /**
   * Use Application Default Credentials (ADC)
   * When true, ignores keyFilename and credentials
   * Useful for GKE workload identity, Cloud Run, etc.
   * Default: false
   */
  useApplicationDefaultCredentials?: boolean;

  /**
   * Optional key prefix for workspace/tenant isolation
   * All storage keys will be prefixed with this value
   */
  keyPrefix?: string;
}

/**
 * Validate GCS configuration
 */
export function validateGcsConfig(config: GcsStorageConfig): void {
  if (!config.projectId) {
    throw new Error('GCS configuration requires projectId');
  }

  if (!config.bucket) {
    throw new Error('GCS configuration requires bucket name');
  }

  // Check authentication method
  const authMethods = [
    config.keyFilename,
    config.credentials,
    config.useApplicationDefaultCredentials,
  ].filter(Boolean);

  if (authMethods.length === 0) {
    // Allow no explicit auth for ADC fallback
    console.warn(
      'GCS: No explicit authentication configured, using Application Default Credentials',
    );
  }

  if (authMethods.length > 1) {
    throw new Error(
      'GCS configuration requires only one authentication method: keyFilename, credentials, or useApplicationDefaultCredentials',
    );
  }

  // Validate credentials object if provided
  if (config.credentials) {
    if (!config.credentials.client_email || !config.credentials.private_key) {
      throw new Error('GCS credentials require client_email and private_key');
    }
  }

  // Validate signed URL expiration
  if (config.signedUrlExpiration !== undefined) {
    if (config.signedUrlExpiration < 1 || config.signedUrlExpiration > 604800) {
      throw new Error('signedUrlExpiration must be between 1 and 604800 seconds');
    }
  }

  // Validate storage class
  const validStorageClasses = ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'];
  if (config.storageClass && !validStorageClasses.includes(config.storageClass)) {
    throw new Error(`Invalid storage class: ${config.storageClass}`);
  }
}
