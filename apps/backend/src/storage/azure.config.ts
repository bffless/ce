/**
 * Azure Blob Storage Configuration
 *
 * Supports account key, connection string, and managed identity authentication
 */
export interface AzureBlobStorageConfig {
  /**
   * Azure Storage account name
   */
  accountName: string;

  /**
   * Blob container name
   */
  containerName: string;

  /**
   * Storage account access key
   * Mutually exclusive with 'connectionString' and 'useManagedIdentity'
   */
  accountKey?: string;

  /**
   * Full Azure Storage connection string
   * Mutually exclusive with 'accountKey' and 'useManagedIdentity'
   */
  connectionString?: string;

  /**
   * Use Azure Managed Identity
   * Mutually exclusive with 'accountKey' and 'connectionString'
   * Works on Azure VMs, AKS, App Service, Functions
   */
  useManagedIdentity?: boolean;

  /**
   * Client ID for user-assigned managed identity
   * Only applicable when useManagedIdentity is true
   */
  managedIdentityClientId?: string;

  /**
   * Blob access tier for new objects
   * Default: 'Hot'
   */
  accessTier?: 'Hot' | 'Cool' | 'Archive';

  /**
   * SAS URL expiration in seconds
   * Default: 3600 (1 hour)
   */
  sasUrlExpiration?: number;

  /**
   * Custom endpoint URL (for Azure Government, China, etc.)
   * Default: https://{accountName}.blob.core.windows.net
   */
  endpoint?: string;

  /**
   * Optional key prefix for workspace/tenant isolation
   * All storage keys will be prefixed with this value
   */
  keyPrefix?: string;
}

/**
 * Validate Azure Blob Storage configuration
 */
export function validateAzureConfig(config: AzureBlobStorageConfig): void {
  if (!config.accountName) {
    throw new Error('Azure configuration requires accountName');
  }

  if (!config.containerName) {
    throw new Error('Azure configuration requires containerName');
  }

  // Check authentication method
  const authMethods = [
    config.accountKey,
    config.connectionString,
    config.useManagedIdentity,
  ].filter(Boolean);

  if (authMethods.length === 0) {
    throw new Error(
      'Azure configuration requires authentication: accountKey, connectionString, or useManagedIdentity',
    );
  }

  if (authMethods.length > 1) {
    throw new Error(
      'Azure configuration requires only one authentication method: accountKey, connectionString, or useManagedIdentity',
    );
  }

  // Validate access tier
  const validAccessTiers = ['Hot', 'Cool', 'Archive'];
  if (config.accessTier && !validAccessTiers.includes(config.accessTier)) {
    throw new Error(`Invalid access tier: ${config.accessTier}`);
  }

  // Validate SAS expiration
  if (config.sasUrlExpiration !== undefined) {
    if (config.sasUrlExpiration < 1) {
      throw new Error('sasUrlExpiration must be at least 1 second');
    }
  }

  // Managed identity client ID requires managed identity enabled
  if (config.managedIdentityClientId && !config.useManagedIdentity) {
    throw new Error('managedIdentityClientId requires useManagedIdentity to be true');
  }
}
