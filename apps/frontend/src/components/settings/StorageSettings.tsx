import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useGetSetupStatusQuery,
  useGetCurrentStorageConfigQuery,
  useGetConstraintsQuery,
  useGetAvailableOptionsQuery,
} from '@/services/setupApi';
import { useGetMigrationJobQuery } from '@/services/migrationApi';
import { MigrationWizard } from '@/components/storage/MigrationWizard';
import { MigrationProgress } from '@/components/storage/MigrationProgress';
import {
  Database,
  HardDrive,
  Cloud,
  Server,
  ArrowRightLeft,
  Loader2,
  CheckCircle,
  Globe,
  AlertTriangle,
  Shield,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const providerIcons: Record<string, typeof Cloud> = {
  managed: Shield,
  s3: Cloud,
  gcs: Cloud,
  azure: Cloud,
  minio: Server,
  local: HardDrive,
};

// Get a more descriptive name based on the config
const getProviderDisplayName = (
  provider: string,
  isS3Compatible?: boolean
): string => {
  if (provider === 's3') {
    return isS3Compatible ? 'S3-Compatible Storage' : 'AWS S3';
  }
  const names: Record<string, string> = {
    managed: 'Managed Storage',
    gcs: 'Google Cloud Storage',
    azure: 'Azure Blob Storage',
    minio: 'MinIO',
    local: 'Local Filesystem',
  };
  return names[provider] || provider;
};

export function StorageSettings() {
  const [showMigrationWizard, setShowMigrationWizard] = useState(false);
  const { data: setupStatus, isLoading: isLoadingStatus } = useGetSetupStatusQuery();
  const { data: storageConfig, isLoading: isLoadingConfig } = useGetCurrentStorageConfigQuery();
  const { data: migrationJob } = useGetMigrationJobQuery();
  const { data: constraints } = useGetConstraintsQuery();
  const { data: availableOptions } = useGetAvailableOptionsQuery();

  // Check if currently using MinIO but it's now disabled via ENABLE_MINIO=false
  const minioDisabledButInUse =
    setupStatus?.storageProvider === 'minio' && constraints?.minio.enabled === false;

  // Check if using managed storage
  const isUsingManagedStorage = setupStatus?.storageProvider === 'managed';

  // Calculate available provider count to determine if migration is possible
  const getAvailableProviderCount = () => {
    if (!availableOptions?.storage) return 5; // Default CE: all except managed
    const opts = availableOptions.storage;
    let count = 0;
    if (opts.managed) count++;
    if (opts.s3) count++;
    if (opts.gcs) count++;
    if (opts.azure) count++;
    if (opts.minio && constraints?.minio.enabled !== false) count++;
    if (opts.local) count++;
    return count;
  };

  const canMigrate = getAvailableProviderCount() > 1;

  // Only poll when there's an active migration
  const hasMigrationInProgress =
    migrationJob &&
    migrationJob.status !== 'none' &&
    migrationJob.status !== 'completed' &&
    migrationJob.status !== 'failed' &&
    migrationJob.status !== 'cancelled';

  // Re-fetch with polling only when migration is active
  useGetMigrationJobQuery(undefined, {
    pollingInterval: hasMigrationInProgress ? 5000 : 0,
    skip: !hasMigrationInProgress,
  });

  const currentProvider = setupStatus?.storageProvider || 'unknown';
  const isS3Compatible = storageConfig?.isS3Compatible;
  const ProviderIcon = currentProvider === 's3' && isS3Compatible ? Globe : (providerIcons[currentProvider] || Database);
  const providerName = getProviderDisplayName(currentProvider, isS3Compatible);

  const handleMigrationComplete = () => {
    setShowMigrationWizard(false);
    // The setup status query will automatically refetch due to cache invalidation
  };

  if (isLoadingStatus || isLoadingConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Storage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show migration wizard if active
  if (showMigrationWizard) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Storage Migration
          </CardTitle>
          <CardDescription>
            Migrate your data to a new storage provider
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MigrationWizard
            currentProvider={currentProvider}
            onComplete={handleMigrationComplete}
            onCancel={() => setShowMigrationWizard(false)}
          />
        </CardContent>
      </Card>
    );
  }

  // Show migration progress if there's an active migration
  if (hasMigrationInProgress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Storage Migration In Progress
          </CardTitle>
          <CardDescription>
            Migrating from {migrationJob.sourceProvider} to {migrationJob.targetProvider}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MigrationProgress onComplete={handleMigrationComplete} />
        </CardContent>
      </Card>
    );
  }

  // Helper to render storage config details based on provider
  const renderStorageDetails = () => {
    if (!storageConfig?.isConfigured) return null;

    const details: { label: string; value: string | undefined }[] = [];

    switch (currentProvider) {
      case 's3':
        if (isS3Compatible && storageConfig.endpoint) {
          details.push({ label: 'Endpoint', value: storageConfig.endpoint });
        } else if (storageConfig.region) {
          details.push({ label: 'Region', value: storageConfig.region });
        }
        if (storageConfig.bucket) {
          details.push({ label: 'Bucket', value: storageConfig.bucket });
        }
        break;

      case 'gcs':
        if (storageConfig.projectId) {
          details.push({ label: 'Project', value: storageConfig.projectId });
        }
        if (storageConfig.bucket) {
          details.push({ label: 'Bucket', value: storageConfig.bucket });
        }
        if (storageConfig.storageClass) {
          details.push({ label: 'Storage Class', value: storageConfig.storageClass });
        }
        break;

      case 'azure':
        if (storageConfig.accountName) {
          details.push({ label: 'Account', value: storageConfig.accountName });
        }
        if (storageConfig.containerName) {
          details.push({ label: 'Container', value: storageConfig.containerName });
        }
        if (storageConfig.accessTier) {
          details.push({ label: 'Access Tier', value: storageConfig.accessTier });
        }
        break;

      case 'minio':
        if (storageConfig.endpoint) {
          const portStr = storageConfig.port ? `:${storageConfig.port}` : '';
          details.push({ label: 'Endpoint', value: `${storageConfig.endpoint}${portStr}` });
        }
        if (storageConfig.bucket) {
          details.push({ label: 'Bucket', value: storageConfig.bucket });
        }
        break;

      case 'local':
        if (storageConfig.localPath) {
          details.push({ label: 'Path', value: storageConfig.localPath });
        }
        break;
    }

    if (details.length === 0) return null;

    return (
      <div className="border-t pt-3 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {details.map((detail, idx) => (
          <div key={idx}>
            <span className="text-muted-foreground">{detail.label}:</span>
            <span className="ml-2 font-mono text-xs">{detail.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Storage
        </CardTitle>
        <CardDescription>
          Manage your storage provider configuration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration Mismatch Warning */}
        {minioDisabledButInUse && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Configuration Mismatch</AlertTitle>
            <AlertDescription>
              You're currently using MinIO storage, but{' '}
              <code className="bg-destructive/20 px-1 rounded">ENABLE_MINIO=false</code> is set in
              your .env file. MinIO will not start on the next restart. Please either:
              <ul className="list-disc list-inside mt-2">
                <li>Migrate to a different storage provider below</li>
                <li>
                  Or remove{' '}
                  <code className="bg-destructive/20 px-1 rounded">ENABLE_MINIO=false</code> from
                  .env and restart
                </li>
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Current Provider */}
        <div className="p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${isUsingManagedStorage ? 'bg-primary/10' : 'bg-primary/10'}`}>
                <ProviderIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Current Storage Provider</p>
                  {isUsingManagedStorage && (
                    <Badge variant="secondary" className="text-xs">
                      <Shield className="w-3 h-3 mr-1" />
                      Platform
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{providerName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">Active</span>
            </div>
          </div>
          {/* Storage Configuration Details */}
          {renderStorageDetails()}

          {/* Managed Storage Info */}
          {isUsingManagedStorage && (
            <div className="border-t pt-3 mt-3">
              <div className="flex items-center text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span>Platform-managed with automatic workspace isolation</span>
              </div>
              <div className="flex items-center text-sm text-muted-foreground mt-1">
                <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                <span>No configuration required</span>
              </div>
            </div>
          )}
        </div>

        {/* Migration Info - only show if migration is possible */}
        {canMigrate && (
          <>
            <Alert>
              <ArrowRightLeft className="h-4 w-4" />
              <AlertDescription>
                Need to switch storage providers? Use the migration wizard to safely copy all your
                files to a new provider before switching.
              </AlertDescription>
            </Alert>

            {/* Migration Button */}
            <div className="flex justify-end">
              <Button onClick={() => setShowMigrationWizard(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Migrate Storage
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
