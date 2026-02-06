import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useGetEnvStorageConfigQuery,
  useGetConstraintsQuery,
  useGetAvailableOptionsQuery,
  useConfigureStorageFromEnvMutation,
  useConfigureStorageMutation,
  useTestStorageMutation,
  StorageProvider,
  LocalStorageConfig,
  S3StorageConfig,
  GCSStorageConfig,
  AzureStorageConfig,
} from '@/services/setupApi';
import {
  nextWizardStep,
  prevWizardStep,
  setStorageProvider,
  setConnectionResult,
  setWizardError,
} from '@/store/slices/setupSlice';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Server,
  HardDrive,
  Cloud,
  AlertTriangle,
  Globe,
  Upload,
  Ban,
  Shield,
} from 'lucide-react';

const storageProviders = [
  {
    value: 'managed' as StorageProvider,
    label: 'Managed Storage',
    description: 'Platform-provided S3-compatible storage (recommended)',
    isPlatform: true,
  },
  {
    value: 'minio' as StorageProvider,
    label: 'MinIO',
    description: 'S3-compatible object storage (pre-configured)',
    isPlatform: false,
  },
  {
    value: 'local' as StorageProvider,
    label: 'Local Filesystem',
    description: 'Store files on local disk',
    isPlatform: false,
  },
  {
    value: 's3' as StorageProvider,
    label: 'S3 / S3-Compatible',
    description: 'AWS S3, DigitalOcean Spaces, Backblaze B2, etc.',
    isPlatform: false,
  },
  {
    value: 'gcs' as StorageProvider,
    label: 'Google Cloud Storage',
    description: 'GCP cloud storage',
    isPlatform: false,
  },
  {
    value: 'azure' as StorageProvider,
    label: 'Azure Blob Storage',
    description: 'Microsoft Azure storage',
    isPlatform: false,
  },
];

export function StorageStep() {
  const dispatch = useDispatch();
  const {
    storageProvider,
    connectionTested,
    connectionSuccess,
    error: wizardError,
  } = useSelector((state: RootState) => state.setup.wizard);

  // Local storage config state
  const [localPath, setLocalPath] = useState('./uploads');

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
  const [gcsAuthMethod, setGcsAuthMethod] = useState<'credentials' | 'file' | 'adc'>('credentials');
  const [gcsCredentialsJson, setGcsCredentialsJson] = useState('');

  // Azure config state
  const [azureConfig, setAzureConfig] = useState<AzureStorageConfig>({
    accountName: '',
    containerName: '',
    accessTier: 'Hot',
  });
  const [azureAuthMethod, setAzureAuthMethod] = useState<'key' | 'connection' | 'managed'>('key');

  const { data: envConfig, isLoading: isLoadingEnvConfig } = useGetEnvStorageConfigQuery();
  const { data: constraints, isLoading: isLoadingConstraints } = useGetConstraintsQuery();
  const { data: availableOptions, isLoading: isLoadingOptions } = useGetAvailableOptionsQuery();
  const [configureFromEnv, { isLoading: isConfiguringEnv }] = useConfigureStorageFromEnvMutation();
  const [configureStorage, { isLoading: isConfiguringManual }] = useConfigureStorageMutation();
  const [testStorage, { isLoading: isTesting }] = useTestStorageMutation();

  const isConfiguring = isConfiguringEnv || isConfiguringManual;

  // Check if MinIO is disabled via ENABLE_MINIO=false
  const minioDisabled = constraints?.minio.enabled === false;

  // Filter providers based on feature flags
  const filteredProviders = storageProviders.filter((provider) => {
    if (!availableOptions?.storage) {
      // Default to showing CE providers if options not loaded
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

  // Auto-select first available provider when options load or if current selection is unavailable
  useEffect(() => {
    if (filteredProviders.length > 0) {
      const isCurrentProviderAvailable = filteredProviders.some((p) => p.value === storageProvider);
      if (!storageProvider || !isCurrentProviderAvailable) {
        dispatch(setStorageProvider(filteredProviders[0].value));
      }
    }
  }, [filteredProviders, storageProvider, dispatch]);

  const handleProviderChange = (value: string) => {
    dispatch(setStorageProvider(value as StorageProvider));
    // Reset connection test when provider changes
    dispatch(setConnectionResult({ tested: false, success: false }));
  };

  const handleConfigureAndTest = async () => {
    try {
      dispatch(setWizardError(null));

      if (storageProvider === 'managed') {
        // Managed storage uses platform-provided credentials (no config needed from user)
        await configureStorage({ storageProvider: 'managed', config: {} }).unwrap();
      } else if (storageProvider === 'minio') {
        // Use environment variables for MinIO
        await configureFromEnv().unwrap();
      } else if (storageProvider === 'local') {
        // Configure local storage with user-provided path
        const config: LocalStorageConfig = { localPath };
        await configureStorage({ storageProvider: 'local', config }).unwrap();
      } else if (storageProvider === 's3') {
        // Validate S3 config
        if (!s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
          dispatch(setWizardError('Please fill in all required S3 fields'));
          return;
        }
        await configureStorage({ storageProvider: 's3', config: s3Config }).unwrap();
      } else if (storageProvider === 'gcs') {
        // Validate GCS config
        if (!gcsConfig.projectId || !gcsConfig.bucket) {
          dispatch(setWizardError('Please fill in Project ID and Bucket Name'));
          return;
        }

        // Build GCS config based on auth method
        const submitConfig: GCSStorageConfig = {
          projectId: gcsConfig.projectId,
          bucket: gcsConfig.bucket,
          storageClass: gcsConfig.storageClass,
        };

        if (gcsAuthMethod === 'credentials') {
          if (!gcsCredentialsJson) {
            dispatch(setWizardError('Please provide service account credentials'));
            return;
          }
          try {
            const parsed = JSON.parse(gcsCredentialsJson);
            submitConfig.credentials = {
              client_email: parsed.client_email,
              private_key: parsed.private_key,
            };
            // Use project ID from credentials if not already set
            if (!submitConfig.projectId && parsed.project_id) {
              submitConfig.projectId = parsed.project_id;
            }
          } catch {
            dispatch(setWizardError('Invalid JSON in service account credentials'));
            return;
          }
        } else if (gcsAuthMethod === 'file') {
          if (!gcsConfig.keyFilename) {
            dispatch(setWizardError('Please provide a key file path'));
            return;
          }
          submitConfig.keyFilename = gcsConfig.keyFilename;
        } else if (gcsAuthMethod === 'adc') {
          submitConfig.useApplicationDefaultCredentials = true;
        }

        await configureStorage({ storageProvider: 'gcs', config: submitConfig }).unwrap();
      } else if (storageProvider === 'azure') {
        // Validate Azure config
        if (!azureConfig.accountName || !azureConfig.containerName) {
          dispatch(setWizardError('Please fill in Account Name and Container Name'));
          return;
        }

        // Build Azure config based on auth method
        const submitConfig: AzureStorageConfig = {
          accountName: azureConfig.accountName,
          containerName: azureConfig.containerName,
          accessTier: azureConfig.accessTier,
        };

        if (azureAuthMethod === 'key') {
          if (!azureConfig.accountKey) {
            dispatch(setWizardError('Please provide account key'));
            return;
          }
          submitConfig.accountKey = azureConfig.accountKey;
        } else if (azureAuthMethod === 'connection') {
          if (!azureConfig.connectionString) {
            dispatch(setWizardError('Please provide connection string'));
            return;
          }
          submitConfig.connectionString = azureConfig.connectionString;
          // Extract account name from connection string if not already set
          if (!submitConfig.accountName) {
            const match = azureConfig.connectionString.match(/AccountName=([^;]+)/);
            if (match) {
              submitConfig.accountName = match[1];
            }
          }
        } else if (azureAuthMethod === 'managed') {
          submitConfig.useManagedIdentity = true;
          if (azureConfig.managedIdentityClientId) {
            submitConfig.managedIdentityClientId = azureConfig.managedIdentityClientId;
          }
        }

        await configureStorage({ storageProvider: 'azure', config: submitConfig }).unwrap();
      } else {
        dispatch(setWizardError('Please select a storage provider'));
        return;
      }

      // Then test connection
      const result = await testStorage().unwrap();
      dispatch(setConnectionResult({ tested: true, success: result.success }));

      if (!result.success) {
        dispatch(setWizardError(result.error || 'Connection test failed'));
      }
    } catch (error: unknown) {
      dispatch(setConnectionResult({ tested: true, success: false }));
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to configure storage'));
    }
  };

  const handleContinue = () => {
    if (connectionSuccess) {
      dispatch(nextWizardStep());
    }
  };

  if (isLoadingEnvConfig || isLoadingConstraints || isLoadingOptions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // MinIO is available if: env config is set AND constraints allow it
  const minioAvailable =
    envConfig?.isConfigured && envConfig?.storageProvider === 'minio' && !minioDisabled;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Configure Storage</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose where to store your deployed assets.
        </p>
      </div>

      {/* Storage Provider Selection */}
      <div>
        <Label>Storage Provider</Label>
        <Select
          value={storageProvider || ''}
          onValueChange={handleProviderChange}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select storage provider" />
          </SelectTrigger>
          <SelectContent>
            {filteredProviders.map((provider) => {
              const isMinioDisabled = provider.value === 'minio' && minioDisabled;
              return (
                <SelectItem
                  key={provider.value}
                  value={provider.value}
                  disabled={isMinioDisabled}
                  className={isMinioDisabled ? 'opacity-50' : ''}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{provider.label}</span>
                      {provider.isPlatform && (
                        <Badge variant="secondary" className="text-xs py-0 px-1.5">
                          <Shield className="w-3 h-3 mr-1" />
                          Platform
                        </Badge>
                      )}
                      {isMinioDisabled && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-xs py-0 px-1.5">
                                <Ban className="w-3 h-3 mr-1" />
                                Disabled
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{constraints?.minio.reason}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{provider.description}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Managed Storage (Platform-provided) */}
      {storageProvider === 'managed' && (
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
      )}

      {/* MinIO Configuration (from env) */}
      {storageProvider === 'minio' && (
        <div className="space-y-4">
          {minioDisabled ? (
            /* MinIO disabled via ENABLE_MINIO=false */
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <div className="flex items-start">
                <Ban className="w-5 h-5 text-destructive mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-destructive">MinIO Service Disabled</h4>
                  <p className="text-sm text-destructive/80 mt-1">{constraints?.minio.reason}</p>
                  <p className="text-sm text-destructive/80 mt-2">To enable MinIO:</p>
                  <ol className="text-sm text-destructive/80 mt-1 space-y-1 list-decimal list-inside">
                    <li>
                      Remove <code className="bg-destructive/20 px-1 rounded">ENABLE_MINIO=false</code>{' '}
                      from your <code className="bg-destructive/20 px-1 rounded">.env</code> file
                    </li>
                    <li>
                      Restart Docker:{' '}
                      <code className="bg-destructive/20 px-1 rounded">
                        docker compose down && ./start.sh
                      </code>
                    </li>
                  </ol>
                  <p className="text-sm text-muted-foreground mt-3">
                    Or select a different storage provider above.
                  </p>
                </div>
              </div>
            </div>
          ) : minioAvailable ? (
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center">
                <Server className="w-5 h-5 text-muted-foreground mr-3" />
                <div>
                  <h4 className="font-medium">MinIO Object Storage</h4>
                  <p className="text-sm text-muted-foreground">
                    Pre-configured from environment variables
                  </p>
                </div>
              </div>

              <div className="border-t pt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Endpoint:</span>
                  <span className="ml-2 font-mono">{envConfig?.endpoint}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Port:</span>
                  <span className="ml-2 font-mono">{envConfig?.port}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Bucket:</span>
                  <span className="ml-2 font-mono">{envConfig?.bucket}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">SSL:</span>
                  <span className="ml-2">{envConfig?.useSSL ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-400">
                    MinIO Not Configured
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-500 mt-1">
                    MinIO credentials are not found in environment variables. Please add the
                    following to your <code className="bg-yellow-500/20 px-1 rounded">.env</code>{' '}
                    file:
                  </p>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-500 mt-2 space-y-1 font-mono text-xs">
                    <li>MINIO_ENDPOINT=localhost</li>
                    <li>MINIO_PORT=9000</li>
                    <li>MINIO_ACCESS_KEY=minioadmin</li>
                    <li>MINIO_SECRET_KEY=minioadmin</li>
                    <li>MINIO_BUCKET=assets</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Local Storage Configuration */}
      {storageProvider === 'local' && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center mb-3">
              <HardDrive className="w-5 h-5 text-muted-foreground mr-3" />
              <div>
                <h4 className="font-medium">Local Filesystem</h4>
                <p className="text-sm text-muted-foreground">
                  Files will be stored on the server's local disk
                </p>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="localPath">Storage Path</Label>
            <Input
              id="localPath"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="./uploads"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Directory path for storing uploaded files (relative to backend)
            </p>
          </div>
        </div>
      )}

      {/* S3 Configuration */}
      {storageProvider === 's3' && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center mb-3">
              <Globe className="w-5 h-5 text-muted-foreground mr-3" />
              <div>
                <h4 className="font-medium">
                  {isS3Compatible ? 'S3-Compatible Storage' : 'AWS S3 Storage'}
                </h4>
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
              <div>
                <Label htmlFor="s3Endpoint">Custom Endpoint</Label>
                <Input
                  id="s3Endpoint"
                  value={s3Config.endpoint || ''}
                  onChange={(e) =>
                    setS3Config({ ...s3Config, endpoint: e.target.value || undefined })
                  }
                  placeholder="https://sfo3.digitaloceanspaces.com"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Region endpoint only - do NOT include the bucket name (e.g.,
                  https://sfo3.digitaloceanspaces.com)
                </p>
              </div>
            </div>
          )}

          {/* Region Selection - only show for AWS S3 */}
          {!isS3Compatible && (
            <div>
              <Label htmlFor="s3Region">AWS Region</Label>
              <Select
                value={s3Config.region}
                onValueChange={(value) => setS3Config({ ...s3Config, region: value })}
              >
                <SelectTrigger id="s3Region" className="mt-1">
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
                  <SelectItem value="ap-northeast-1">
                    Asia Pacific (Tokyo) - ap-northeast-1
                  </SelectItem>
                  <SelectItem value="ap-northeast-2">
                    Asia Pacific (Seoul) - ap-northeast-2
                  </SelectItem>
                  <SelectItem value="ap-southeast-1">
                    Asia Pacific (Singapore) - ap-southeast-1
                  </SelectItem>
                  <SelectItem value="ap-southeast-2">
                    Asia Pacific (Sydney) - ap-southeast-2
                  </SelectItem>
                  <SelectItem value="sa-east-1">South America (São Paulo) - sa-east-1</SelectItem>
                  <SelectItem value="ca-central-1">Canada (Central) - ca-central-1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Bucket Name */}
          <div>
            <Label htmlFor="s3Bucket">Bucket Name</Label>
            <Input
              id="s3Bucket"
              value={s3Config.bucket}
              onChange={(e) => setS3Config({ ...s3Config, bucket: e.target.value })}
              placeholder={isS3Compatible ? 'my-space-name' : 'my-deployment-assets'}
              className="mt-1"
            />
          </div>

          {/* Credentials */}
          <div className="space-y-4 pt-2">
            <div className="text-sm text-muted-foreground">
              <strong>{isS3Compatible ? 'Access Credentials' : 'AWS Credentials'}</strong> - Access
              keys are required. IAM roles are not supported.
            </div>

            <div>
              <Label htmlFor="s3AccessKeyId">Access Key ID</Label>
              <Input
                id="s3AccessKeyId"
                value={s3Config.accessKeyId}
                onChange={(e) => setS3Config({ ...s3Config, accessKeyId: e.target.value })}
                placeholder={isS3Compatible ? 'DO00EXAMPLE...' : 'AKIAIOSFODNN7EXAMPLE'}
                className="mt-1 font-mono"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>

            <div>
              <Label htmlFor="s3SecretAccessKey">Secret Access Key</Label>
              <Input
                id="s3SecretAccessKey"
                type="password"
                value={s3Config.secretAccessKey}
                onChange={(e) => setS3Config({ ...s3Config, secretAccessKey: e.target.value })}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className="mt-1 font-mono"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
          </div>
        </div>
      )}

      {/* GCS Configuration */}
      {storageProvider === 'gcs' && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center mb-3">
              <Cloud className="w-5 h-5 text-muted-foreground mr-3" />
              <div>
                <h4 className="font-medium">Google Cloud Storage</h4>
                <p className="text-sm text-muted-foreground">
                  Connect to Google Cloud Platform storage
                </p>
              </div>
            </div>
          </div>

          {/* Project ID */}
          <div>
            <Label htmlFor="gcsProjectId">Project ID</Label>
            <Input
              id="gcsProjectId"
              value={gcsConfig.projectId}
              onChange={(e) => setGcsConfig({ ...gcsConfig, projectId: e.target.value })}
              placeholder="my-project-123"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Found in GCP Console → Project settings
            </p>
          </div>

          {/* Bucket Name */}
          <div>
            <Label htmlFor="gcsBucket">Bucket Name</Label>
            <Input
              id="gcsBucket"
              value={gcsConfig.bucket}
              onChange={(e) => setGcsConfig({ ...gcsConfig, bucket: e.target.value })}
              placeholder="my-deployment-assets"
              className="mt-1"
            />
          </div>

          {/* Authentication Method */}
          <div className="space-y-4">
            <Label>Authentication Method</Label>
            <Tabs
              value={gcsAuthMethod}
              onValueChange={(v) => setGcsAuthMethod(v as 'credentials' | 'file' | 'adc')}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="credentials">JSON Key</TabsTrigger>
                <TabsTrigger value="file">Key File Path</TabsTrigger>
                <TabsTrigger value="adc">ADC</TabsTrigger>
              </TabsList>

              <TabsContent value="credentials" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="gcsCredentials">Service Account Key (JSON)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('gcs-file-upload')?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload File
                    </Button>
                    <input
                      id="gcs-file-upload"
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const content = event.target?.result as string;
                            setGcsCredentialsJson(content);
                            // Try to extract project ID
                            try {
                              const parsed = JSON.parse(content);
                              if (parsed.project_id && !gcsConfig.projectId) {
                                setGcsConfig((prev) => ({ ...prev, projectId: parsed.project_id }));
                              }
                            } catch {
                              // Ignore parse errors
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </div>
                  <Textarea
                    id="gcsCredentials"
                    value={gcsCredentialsJson}
                    onChange={(e) => setGcsCredentialsJson(e.target.value)}
                    placeholder='{"type": "service_account", "project_id": "...", ...}'
                    rows={8}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Download from GCP Console → IAM → Service Accounts → Keys
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="file" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="gcsKeyFilename">Key File Path</Label>
                  <Input
                    id="gcsKeyFilename"
                    value={gcsConfig.keyFilename || ''}
                    onChange={(e) =>
                      setGcsConfig({ ...gcsConfig, keyFilename: e.target.value || undefined })
                    }
                    placeholder="/path/to/service-account.json"
                  />
                  <p className="text-xs text-muted-foreground">
                    Path on the server where the key file is located
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="adc" className="pt-4">
                <div className="p-4 bg-muted rounded-md">
                  <p className="text-sm">
                    <strong>Application Default Credentials (ADC)</strong> will be used. This works
                    automatically when running on GCP (GKE, Cloud Run, GCE).
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    For local development, run:{' '}
                    <code className="bg-background px-1 py-0.5 rounded">
                      gcloud auth application-default login
                    </code>
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Storage Class */}
          <div>
            <Label htmlFor="gcsStorageClass">Storage Class</Label>
            <Select
              value={gcsConfig.storageClass || 'STANDARD'}
              onValueChange={(value) =>
                setGcsConfig({
                  ...gcsConfig,
                  storageClass: value as GCSStorageConfig['storageClass'],
                })
              }
            >
              <SelectTrigger id="gcsStorageClass" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">Standard (frequent access)</SelectItem>
                <SelectItem value="NEARLINE">Nearline (monthly access)</SelectItem>
                <SelectItem value="COLDLINE">Coldline (quarterly access)</SelectItem>
                <SelectItem value="ARCHIVE">Archive (yearly access)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Recommended: Standard for deployment assets
            </p>
          </div>
        </div>
      )}

      {/* Azure Blob Storage Configuration */}
      {storageProvider === 'azure' && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center mb-3">
              <Cloud className="w-5 h-5 text-muted-foreground mr-3" />
              <div>
                <h4 className="font-medium">Azure Blob Storage</h4>
                <p className="text-sm text-muted-foreground">Connect to Microsoft Azure storage</p>
              </div>
            </div>
          </div>

          {/* Account Name */}
          <div>
            <Label htmlFor="azureAccountName">Storage Account Name</Label>
            <Input
              id="azureAccountName"
              value={azureConfig.accountName}
              onChange={(e) => setAzureConfig({ ...azureConfig, accountName: e.target.value })}
              placeholder="mystorageaccount"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Found in Azure Portal → Storage accounts → Overview
            </p>
          </div>

          {/* Container Name */}
          <div>
            <Label htmlFor="azureContainerName">Container Name</Label>
            <Input
              id="azureContainerName"
              value={azureConfig.containerName}
              onChange={(e) => setAzureConfig({ ...azureConfig, containerName: e.target.value })}
              placeholder="deployments"
              className="mt-1"
            />
          </div>

          {/* Authentication Method */}
          <div className="space-y-4">
            <Label>Authentication Method</Label>
            <Tabs
              value={azureAuthMethod}
              onValueChange={(v) => setAzureAuthMethod(v as 'key' | 'connection' | 'managed')}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="key">Account Key</TabsTrigger>
                <TabsTrigger value="connection">Connection String</TabsTrigger>
                <TabsTrigger value="managed">Managed Identity</TabsTrigger>
              </TabsList>

              <TabsContent value="key" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="azureAccountKey">Account Key</Label>
                  <Input
                    id="azureAccountKey"
                    type="password"
                    value={azureConfig.accountKey || ''}
                    onChange={(e) =>
                      setAzureConfig({ ...azureConfig, accountKey: e.target.value || undefined })
                    }
                    placeholder="Enter account key"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in Azure Portal → Storage account → Access keys
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="connection" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="azureConnectionString">Connection String</Label>
                  <Textarea
                    id="azureConnectionString"
                    value={azureConfig.connectionString || ''}
                    onChange={(e) =>
                      setAzureConfig({
                        ...azureConfig,
                        connectionString: e.target.value || undefined,
                      })
                    }
                    placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                    rows={3}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in Azure Portal → Storage account → Access keys → Connection string
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="managed" className="pt-4 space-y-4">
                <div className="p-4 bg-muted rounded-md">
                  <p className="text-sm">
                    <strong>Managed Identity</strong> will be used. This works automatically when
                    running on Azure (VMs, AKS, App Service, Functions).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureManagedIdentityClientId">
                    User-Assigned Identity Client ID (optional)
                  </Label>
                  <Input
                    id="azureManagedIdentityClientId"
                    value={azureConfig.managedIdentityClientId || ''}
                    onChange={(e) =>
                      setAzureConfig({
                        ...azureConfig,
                        managedIdentityClientId: e.target.value || undefined,
                      })
                    }
                    placeholder="Leave empty for system-assigned identity"
                  />
                  <p className="text-xs text-muted-foreground">
                    Only needed if using a user-assigned managed identity
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Access Tier */}
          <div>
            <Label htmlFor="azureAccessTier">Access Tier</Label>
            <Select
              value={azureConfig.accessTier || 'Hot'}
              onValueChange={(value) =>
                setAzureConfig({
                  ...azureConfig,
                  accessTier: value as AzureStorageConfig['accessTier'],
                })
              }
            >
              <SelectTrigger id="azureAccessTier" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Hot">Hot (frequent access)</SelectItem>
                <SelectItem value="Cool">Cool (infrequent access)</SelectItem>
                <SelectItem value="Archive">Archive (rare access)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Recommended: Hot for deployment assets
            </p>
          </div>
        </div>
      )}

      {/* Connection Test Result */}
      {connectionTested && (
        <div
          className={`flex items-center p-4 rounded-md ${
            connectionSuccess
              ? 'bg-green-500/10 border border-green-500/20'
              : 'bg-destructive/10 border border-destructive/20'
          }`}
        >
          {connectionSuccess ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              <span className="text-green-700 dark:text-green-400">Connection successful!</span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-destructive mr-2 flex-shrink-0" />
              <span className="text-destructive">
                {wizardError || 'Connection failed. Check your storage service is running.'}
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>

        <div className="space-x-2">
          <Button
            variant="outline"
            onClick={handleConfigureAndTest}
            disabled={
              isConfiguring ||
              isTesting ||
              (storageProvider === 'minio' && !minioAvailable) ||
              (storageProvider === 's3' &&
                (!s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey)) ||
              (storageProvider === 'gcs' && (!gcsConfig.projectId || !gcsConfig.bucket)) ||
              (storageProvider === 'azure' &&
                (!azureConfig.accountName || !azureConfig.containerName)) ||
              (storageProvider !== 'managed' &&
                storageProvider !== 'minio' &&
                storageProvider !== 'local' &&
                storageProvider !== 's3' &&
                storageProvider !== 'gcs' &&
                storageProvider !== 'azure')
            }
          >
            {isConfiguring || isTesting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {storageProvider === 'managed' ? 'Configuring...' : 'Testing...'}
              </>
            ) : storageProvider === 'managed' ? (
              'Configure Storage'
            ) : (
              'Test Connection'
            )}
          </Button>

          <Button onClick={handleContinue} disabled={!connectionSuccess}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
