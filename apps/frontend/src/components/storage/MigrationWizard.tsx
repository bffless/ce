import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useLazyCalculateMigrationScopeQuery,
  useStartMigrationMutation,
  useCompleteMigrationMutation,
  useGetMigrationJobQuery,
  type MigrationOptions,
} from '@/services/migrationApi';
import type { StorageProvider, S3StorageConfig, GCSStorageConfig } from '@/services/setupApi';
import { useGetConstraintsQuery, useGetAvailableOptionsQuery } from '@/services/setupApi';
import { MigrationProgress } from './MigrationProgress';
import { ArrowRight, AlertTriangle, Loader2, CheckCircle, Server, Cloud, Database, Globe, Shield } from 'lucide-react';

type WizardStep = 'select' | 'configure' | 'confirm' | 'progress' | 'complete';

interface MigrationWizardProps {
  currentProvider: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

const storageProviders = [
  { value: 'managed' as StorageProvider, label: 'Managed Storage', icon: Shield, description: 'Platform-provided S3-compatible storage', isPlatform: true },
  { value: 's3' as StorageProvider, label: 'S3 / S3-Compatible', icon: Globe, description: 'AWS S3, DigitalOcean Spaces, Backblaze B2, etc.', isPlatform: false },
  { value: 'gcs' as StorageProvider, label: 'Google Cloud Storage', icon: Cloud, description: 'GCP cloud storage', isPlatform: false },
  { value: 'azure' as StorageProvider, label: 'Azure Blob Storage', icon: Cloud, description: 'Microsoft Azure storage', isPlatform: false },
  { value: 'minio' as StorageProvider, label: 'MinIO', icon: Server, description: 'S3-compatible object storage', isPlatform: false },
  { value: 'local' as StorageProvider, label: 'Local Filesystem', icon: Database, description: 'Local disk storage', isPlatform: false },
];

export function MigrationWizard({ currentProvider, onComplete, onCancel }: MigrationWizardProps) {
  const [step, setStep] = useState<WizardStep>('select');
  const [targetProvider, setTargetProvider] = useState<StorageProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // S3 config state
  const [s3Config, setS3Config] = useState<S3StorageConfig>({
    region: 'us-east-1',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  const [isS3Compatible, setIsS3Compatible] = useState(false);

  // GCS config state
  const [gcsConfig, setGcsConfig] = useState<GCSStorageConfig>({
    projectId: '',
    bucket: '',
  });
  const [gcsAuthMethod, setGcsAuthMethod] = useState<'credentials' | 'adc'>('credentials');
  const [gcsCredentialsJson, setGcsCredentialsJson] = useState('');

  // Azure config state
  const [azureConfig, setAzureConfig] = useState({
    accountName: '',
    containerName: '',
    accountKey: '',
    accessTier: 'Hot' as 'Hot' | 'Cool' | 'Archive',
  });

  // MinIO config state
  const [minioConfig, setMinioConfig] = useState({
    endpoint: '',
    port: 9000,
    bucket: '',
    accessKey: '',
    secretKey: '',
    useSSL: false,
  });

  // Local config state
  const [localPath, setLocalPath] = useState('./uploads');

  // Migration options
  const [options] = useState<MigrationOptions>({
    continueOnError: true,
    concurrency: 5,
    verifyIntegrity: true,
  });

  // API hooks
  const [calculateScope, { data: scope, isLoading: isCalculating }] = useLazyCalculateMigrationScopeQuery();
  const [startMigration, { isLoading: isStarting }] = useStartMigrationMutation();
  const [completeMigration, { isLoading: isCompleting }] = useCompleteMigrationMutation();
  // Always check for active migration on mount and during progress step
  const { data: currentJob } = useGetMigrationJobQuery(undefined, {
    pollingInterval: step === 'progress' || step === 'select' ? 1000 : undefined,
  });
  // Get service constraints to check if MinIO is disabled
  const { data: constraints } = useGetConstraintsQuery();
  const { data: availableOptions } = useGetAvailableOptionsQuery();
  const minioDisabled = constraints?.minio.enabled === false;

  // Filter providers based on feature flags
  const filteredProviders = storageProviders.filter((provider) => {
    // Always exclude current provider
    if (provider.value === currentProvider) return false;

    if (!availableOptions?.storage) {
      // Default to CE behavior (all except managed)
      return provider.value !== 'managed';
    }
    const opts = availableOptions.storage;
    switch (provider.value) {
      case 'managed':
        return opts.managed;
      case 'minio':
        return opts.minio && !minioDisabled;
      case 'local':
        return opts.local;
      case 's3':
        return opts.s3;
      case 'gcs':
        return opts.gcs;
      case 'azure':
        return opts.azure;
      default:
        return true;
    }
  });

  const handleProviderSelect = async (provider: StorageProvider) => {
    setTargetProvider(provider);
    setError(null);
    setStep('configure');
  };

  const getConfig = (): Record<string, unknown> => {
    switch (targetProvider) {
      case 'managed':
        return {}; // Managed storage uses platform credentials
      case 's3':
        return { ...s3Config };
      case 'gcs':
        if (gcsAuthMethod === 'credentials' && gcsCredentialsJson) {
          try {
            const parsed = JSON.parse(gcsCredentialsJson);
            return {
              ...gcsConfig,
              credentials: {
                client_email: parsed.client_email,
                private_key: parsed.private_key,
              },
            };
          } catch {
            return { ...gcsConfig };
          }
        }
        return { ...gcsConfig, useApplicationDefaultCredentials: gcsAuthMethod === 'adc' };
      case 'azure':
        return { ...azureConfig };
      case 'minio':
        return { ...minioConfig };
      case 'local':
        return { localPath };
      default:
        return {};
    }
  };

  const validateConfig = (): boolean => {
    setError(null);

    switch (targetProvider) {
      case 'managed':
        return true; // Managed storage requires no user configuration
      case 's3':
        if (!s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
          setError('Please fill in all required S3 fields');
          return false;
        }
        break;
      case 'gcs':
        if (!gcsConfig.projectId || !gcsConfig.bucket) {
          setError('Please fill in Project ID and Bucket Name');
          return false;
        }
        if (gcsAuthMethod === 'credentials' && !gcsCredentialsJson) {
          setError('Please provide service account credentials');
          return false;
        }
        break;
      case 'azure':
        if (!azureConfig.accountName || !azureConfig.containerName || !azureConfig.accountKey) {
          setError('Please fill in all required Azure fields');
          return false;
        }
        break;
      case 'minio':
        if (!minioConfig.endpoint || !minioConfig.bucket || !minioConfig.accessKey || !minioConfig.secretKey) {
          setError('Please fill in all required MinIO fields');
          return false;
        }
        break;
      case 'local':
        if (!localPath) {
          setError('Please provide a local path');
          return false;
        }
        break;
    }
    return true;
  };

  const handleConfigSubmit = async () => {
    if (!validateConfig()) return;

    // Calculate scope before confirming
    await calculateScope();
    setStep('confirm');
  };

  const handleStartMigration = async () => {
    if (!targetProvider) return;

    try {
      setError(null);
      await startMigration({
        provider: targetProvider,
        config: getConfig(),
        options,
      }).unwrap();

      setStep('progress');
    } catch (err: unknown) {
      const error = err as { data?: { message?: string } };
      setError(error.data?.message || 'Failed to start migration');
    }
  };

  const handleMigrationComplete = () => {
    setStep('complete');
  };

  const handleFinish = async () => {
    if (!targetProvider) return;

    try {
      setError(null);
      await completeMigration({
        provider: targetProvider,
        config: getConfig(),
      }).unwrap();

      onComplete?.();
    } catch (err: unknown) {
      const error = err as { data?: { message?: string } };
      setError(error.data?.message || 'Failed to complete migration');
    }
  };

  const renderProviderConfig = () => {
    switch (targetProvider) {
      case 'managed':
        return (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center">
                <Shield className="w-5 h-5 text-primary mr-3" />
                <div>
                  <h4 className="font-medium">Platform Managed Storage</h4>
                  <p className="text-sm text-muted-foreground">
                    Storage is automatically configured and managed by the platform
                  </p>
                </div>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">
                    S3-compatible storage with automatic credentials
                  </span>
                </div>
                <div className="flex items-center text-sm mt-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">
                    Workspace-isolated with automatic key prefix
                  </span>
                </div>
                <div className="flex items-center text-sm mt-2">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">No configuration required</span>
                </div>
              </div>
            </div>
          </div>
        );
      case 's3':
        return (
          <div className="space-y-4">
            {/* Header with dynamic title based on S3-compatible toggle */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <Globe className="w-5 h-5 text-muted-foreground mr-3" />
                <div>
                  <h4 className="font-medium">{isS3Compatible ? 'S3-Compatible Storage' : 'AWS S3 Storage'}</h4>
                  <p className="text-sm text-muted-foreground">
                    {isS3Compatible
                      ? 'Connect to DigitalOcean Spaces, Backblaze B2, Cloudflare R2, etc.'
                      : 'Connect to Amazon Web Services S3'}
                  </p>
                </div>
              </div>
            </div>

            {/* S3-Compatible Toggle - FIRST */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="s3-compatible"
                checked={isS3Compatible}
                onCheckedChange={(checked) => {
                  setIsS3Compatible(checked as boolean);
                  if (!checked) {
                    setS3Config({ ...s3Config, endpoint: undefined });
                  }
                }}
              />
              <Label htmlFor="s3-compatible" className="text-sm cursor-pointer">
                S3-compatible service (DigitalOcean Spaces, Backblaze B2, Cloudflare R2, Wasabi)
              </Label>
            </div>

            {/* S3-Compatible Endpoint - show when checked */}
            {isS3Compatible && (
              <div className="pl-6 border-l-2 border-muted space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="s3Endpoint">Custom Endpoint</Label>
                  <Input
                    id="s3Endpoint"
                    value={s3Config.endpoint || ''}
                    onChange={(e) => setS3Config({ ...s3Config, endpoint: e.target.value || undefined })}
                    placeholder="https://sfo3.digitaloceanspaces.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Region endpoint only - do NOT include the bucket name (e.g., https://sfo3.digitaloceanspaces.com)
                  </p>
                </div>
              </div>
            )}

            {/* Region Selection - only show for AWS S3 */}
            {!isS3Compatible && (
              <div className="space-y-2">
                <Label htmlFor="s3Region">AWS Region</Label>
                <Select
                  value={s3Config.region}
                  onValueChange={(value) => setS3Config({ ...s3Config, region: value })}
                >
                  <SelectTrigger id="s3Region">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us-east-1">US East (N. Virginia) - us-east-1</SelectItem>
                    <SelectItem value="us-east-2">US East (Ohio) - us-east-2</SelectItem>
                    <SelectItem value="us-west-1">US West (N. California) - us-west-1</SelectItem>
                    <SelectItem value="us-west-2">US West (Oregon) - us-west-2</SelectItem>
                    <SelectItem value="eu-west-1">Europe (Ireland) - eu-west-1</SelectItem>
                    <SelectItem value="eu-west-2">Europe (London) - eu-west-2</SelectItem>
                    <SelectItem value="eu-west-3">Europe (Paris) - eu-west-3</SelectItem>
                    <SelectItem value="eu-central-1">Europe (Frankfurt) - eu-central-1</SelectItem>
                    <SelectItem value="ap-northeast-1">Asia Pacific (Tokyo) - ap-northeast-1</SelectItem>
                    <SelectItem value="ap-northeast-2">Asia Pacific (Seoul) - ap-northeast-2</SelectItem>
                    <SelectItem value="ap-southeast-1">Asia Pacific (Singapore) - ap-southeast-1</SelectItem>
                    <SelectItem value="ap-southeast-2">Asia Pacific (Sydney) - ap-southeast-2</SelectItem>
                    <SelectItem value="sa-east-1">South America (São Paulo) - sa-east-1</SelectItem>
                    <SelectItem value="ca-central-1">Canada (Central) - ca-central-1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Bucket Name */}
            <div className="space-y-2">
              <Label htmlFor="s3Bucket">Bucket Name *</Label>
              <Input
                id="s3Bucket"
                value={s3Config.bucket}
                onChange={(e) => setS3Config({ ...s3Config, bucket: e.target.value })}
                placeholder={isS3Compatible ? "my-space-name" : "my-deployment-assets"}
              />
            </div>

            {/* Credentials */}
            <div className="space-y-4 pt-2">
              <div className="text-sm text-muted-foreground">
                <strong>{isS3Compatible ? 'Access Credentials' : 'AWS Credentials'}</strong> - Access keys are required.
              </div>

              <div className="space-y-2">
                <Label htmlFor="s3AccessKey">Access Key ID *</Label>
                <Input
                  id="s3AccessKey"
                  value={s3Config.accessKeyId}
                  onChange={(e) => setS3Config({ ...s3Config, accessKeyId: e.target.value })}
                  placeholder={isS3Compatible ? "DO00EXAMPLE..." : "AKIAIOSFODNN7EXAMPLE"}
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s3SecretKey">Secret Access Key *</Label>
                <Input
                  id="s3SecretKey"
                  type="password"
                  value={s3Config.secretAccessKey}
                  onChange={(e) => setS3Config({ ...s3Config, secretAccessKey: e.target.value })}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  className="font-mono"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
        );

      case 'gcs':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gcsProject">Project ID *</Label>
                <Input
                  id="gcsProject"
                  value={gcsConfig.projectId}
                  onChange={(e) => setGcsConfig({ ...gcsConfig, projectId: e.target.value })}
                  placeholder="my-project-123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gcsBucket">Bucket Name *</Label>
                <Input
                  id="gcsBucket"
                  value={gcsConfig.bucket}
                  onChange={(e) => setGcsConfig({ ...gcsConfig, bucket: e.target.value })}
                  placeholder="my-bucket"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Authentication Method</Label>
              <Tabs value={gcsAuthMethod} onValueChange={(v) => setGcsAuthMethod(v as 'credentials' | 'adc')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="credentials">Service Account JSON</TabsTrigger>
                  <TabsTrigger value="adc">Application Default</TabsTrigger>
                </TabsList>
                <TabsContent value="credentials" className="mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="gcsCredentials">Service Account JSON</Label>
                    <Textarea
                      id="gcsCredentials"
                      value={gcsCredentialsJson}
                      onChange={(e) => setGcsCredentialsJson(e.target.value)}
                      placeholder='{"type": "service_account", "project_id": "...", ...}'
                      className="font-mono text-xs h-32"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="adc" className="mt-4">
                  <Alert>
                    <AlertDescription>
                      Application Default Credentials will be used. Make sure ADC is configured on the server.
                    </AlertDescription>
                  </Alert>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        );

      case 'azure':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="azureAccount">Account Name *</Label>
                <Input
                  id="azureAccount"
                  value={azureConfig.accountName}
                  onChange={(e) => setAzureConfig({ ...azureConfig, accountName: e.target.value })}
                  placeholder="mystorageaccount"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azureContainer">Container Name *</Label>
                <Input
                  id="azureContainer"
                  value={azureConfig.containerName}
                  onChange={(e) => setAzureConfig({ ...azureConfig, containerName: e.target.value })}
                  placeholder="my-container"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="azureKey">Account Key *</Label>
              <Input
                id="azureKey"
                type="password"
                value={azureConfig.accountKey}
                onChange={(e) => setAzureConfig({ ...azureConfig, accountKey: e.target.value })}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azureTier">Access Tier</Label>
              <Select
                value={azureConfig.accessTier}
                onValueChange={(v) => setAzureConfig({ ...azureConfig, accessTier: v as 'Hot' | 'Cool' | 'Archive' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hot">Hot</SelectItem>
                  <SelectItem value="Cool">Cool</SelectItem>
                  <SelectItem value="Archive">Archive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'minio':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minioEndpoint">Endpoint *</Label>
                <Input
                  id="minioEndpoint"
                  value={minioConfig.endpoint}
                  onChange={(e) => setMinioConfig({ ...minioConfig, endpoint: e.target.value })}
                  placeholder="minio.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minioPort">Port</Label>
                <Input
                  id="minioPort"
                  type="number"
                  value={minioConfig.port}
                  onChange={(e) => setMinioConfig({ ...minioConfig, port: parseInt(e.target.value) || 9000 })}
                  placeholder="9000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="minioBucket">Bucket Name *</Label>
              <Input
                id="minioBucket"
                value={minioConfig.bucket}
                onChange={(e) => setMinioConfig({ ...minioConfig, bucket: e.target.value })}
                placeholder="my-bucket"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minioAccessKey">Access Key *</Label>
                <Input
                  id="minioAccessKey"
                  value={minioConfig.accessKey}
                  onChange={(e) => setMinioConfig({ ...minioConfig, accessKey: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minioSecretKey">Secret Key *</Label>
                <Input
                  id="minioSecretKey"
                  type="password"
                  value={minioConfig.secretKey}
                  onChange={(e) => setMinioConfig({ ...minioConfig, secretKey: e.target.value })}
                />
              </div>
            </div>
          </div>
        );

      case 'local':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="localPath">Storage Path *</Label>
              <Input
                id="localPath"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="./uploads"
              />
              <p className="text-xs text-muted-foreground">
                Path relative to the backend working directory
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Check if there's an active migration (in_progress or completed but not yet switched)
  if (currentJob && currentJob.status === 'in_progress') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration In Progress</CardTitle>
          <CardDescription>
            Migrating from {currentJob.sourceProvider} to {currentJob.targetProvider}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MigrationProgress onComplete={handleMigrationComplete} />
        </CardContent>
      </Card>
    );
  }

  // Check if migration completed (show complete step even after refresh)
  if (currentJob && currentJob.status === 'completed' && step !== 'complete') {
    const handleFinishFromJob = async () => {
      if (!currentJob.targetProvider || !currentJob.targetConfig) {
        setError('Migration data not available');
        return;
      }

      try {
        setError(null);
        await completeMigration({
          provider: currentJob.targetProvider,
          config: currentJob.targetConfig,
        }).unwrap();

        onComplete?.();
      } catch (err: unknown) {
        const error = err as { data?: { message?: string } };
        setError(error.data?.message || 'Failed to complete migration');
      }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Migration Complete
          </CardTitle>
          <CardDescription>
            All files have been migrated to {currentJob.targetProvider}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-green-500/10 border-green-500/20">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              Your files have been successfully migrated. Click &quot;Switch Provider&quot; to start using the new
              storage provider.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleFinishFromJob} disabled={isCompleting}>
              {isCompleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Switching...
                </>
              ) : (
                'Switch Provider'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'progress') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration In Progress</CardTitle>
          <CardDescription>
            Migrating from {currentProvider} to {targetProvider}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MigrationProgress onComplete={handleMigrationComplete} />
        </CardContent>
      </Card>
    );
  }

  if (step === 'complete') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Migration Complete
          </CardTitle>
          <CardDescription>
            All files have been migrated to {targetProvider}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-green-500/10 border-green-500/20">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              Your files have been successfully migrated. Click &quot;Switch Provider&quot; to start using the new
              storage provider.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleFinish} disabled={isCompleting}>
              {isCompleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Switching...
                </>
              ) : (
                'Switch Provider'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Select Provider */}
      {step === 'select' && (
        <Card>
          <CardHeader>
            <CardTitle>Select Target Provider</CardTitle>
            <CardDescription>Choose the storage provider to migrate to</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProviders.map((provider) => {
                const Icon = provider.icon;
                return (
                  <button
                    key={provider.value}
                    className="p-4 border rounded-lg text-left transition-colors hover:bg-muted/50"
                    onClick={() => handleProviderSelect(provider.value)}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${provider.isPlatform ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="font-medium">{provider.label}</span>
                      {provider.isPlatform && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          Platform
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{provider.description}</p>
                  </button>
                );
              })}
            </div>

            {onCancel && (
              <div className="mt-6">
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Configure */}
      {step === 'configure' && targetProvider && (
        <Card>
          <CardHeader>
            <CardTitle>Configure {storageProviders.find((p) => p.value === targetProvider)?.label}</CardTitle>
            <CardDescription>Enter your storage credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderProviderConfig()}

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button onClick={handleConfigSubmit} disabled={isCalculating}>
                {isCalculating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && scope && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Migration</CardTitle>
            <CardDescription>Review the migration details before starting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Migration will copy all files from {currentProvider} to {targetProvider}. This process
                may take a while for large datasets.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Files to migrate</p>
                <p className="text-2xl font-bold">{scope.fileCount.toLocaleString()}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total size</p>
                <p className="text-2xl font-bold">{scope.formattedSize}</p>
              </div>
            </div>

            <div className="p-4 border rounded-lg">
              <p className="text-sm text-muted-foreground">Estimated duration</p>
              <p className="text-lg font-semibold">{scope.estimatedDuration}</p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-4 pt-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-medium">{currentProvider}</span>
                <ArrowRight className="h-4 w-4" />
                <span className="font-medium">{targetProvider}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('configure')}>
                  Back
                </Button>
                <Button onClick={handleStartMigration} disabled={isStarting}>
                  {isStarting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    'Start Migration'
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
