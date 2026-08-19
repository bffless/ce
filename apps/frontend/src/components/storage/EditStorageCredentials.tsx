import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useUpdateStorageCredentialsMutation,
  type StorageProvider,
  type StorageConfig,
  type CurrentStorageConfigResponse,
} from '@/services/setupApi';
import { AlertTriangle, CheckCircle, KeyRound, Loader2 } from 'lucide-react';
import { storageDocsFor } from '@/lib/docsLinks';
import { DocsInlineLink } from '@/components/common/DocsLink';

interface EditStorageCredentialsProps {
  currentProvider: StorageProvider;
  /** Non-sensitive current config used to pre-fill the form. */
  currentConfig?: CurrentStorageConfigResponse;
  onDone?: () => void;
  onCancel?: () => void;
}

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'sa-east-1',
  'ca-central-1',
];

const providerLabels: Record<string, string> = {
  s3: 'S3 / S3-Compatible',
  minio: 'MinIO',
  gcs: 'Google Cloud Storage',
  azure: 'Azure Blob Storage',
  local: 'Local Filesystem',
};

export function EditStorageCredentials({
  currentProvider,
  currentConfig,
  onDone,
  onCancel,
}: EditStorageCredentialsProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [updateCredentials, { isLoading }] = useUpdateStorageCredentialsMutation();

  // S3 / S3-compatible ----------------------------------------------------
  const s3IsCompatible = currentProvider === 's3' && !!currentConfig?.isS3Compatible;
  const [s3Region, setS3Region] = useState(currentConfig?.region || 'us-east-1');
  const [s3Endpoint, setS3Endpoint] = useState(currentConfig?.endpoint || '');
  const [s3Bucket, setS3Bucket] = useState(currentConfig?.bucket || '');
  const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState('');

  // MinIO -----------------------------------------------------------------
  const [minioEndpoint, setMinioEndpoint] = useState(currentConfig?.endpoint || '');
  const [minioPort, setMinioPort] = useState<number>(currentConfig?.port ?? 9000);
  const [minioBucket, setMinioBucket] = useState(currentConfig?.bucket || '');
  const [minioAccessKey, setMinioAccessKey] = useState('');
  const [minioSecretKey, setMinioSecretKey] = useState('');

  // GCS -------------------------------------------------------------------
  const [gcsProjectId, setGcsProjectId] = useState(currentConfig?.projectId || '');
  const [gcsBucket, setGcsBucket] = useState(currentConfig?.bucket || '');
  const [gcsCredentialsJson, setGcsCredentialsJson] = useState('');

  // Azure -----------------------------------------------------------------
  const [azureAccountName, setAzureAccountName] = useState(currentConfig?.accountName || '');
  const [azureContainerName, setAzureContainerName] = useState(currentConfig?.containerName || '');
  const [azureAccountKey, setAzureAccountKey] = useState('');

  // Local -----------------------------------------------------------------
  const [localPath, setLocalPath] = useState(currentConfig?.localPath || './uploads');

  const providerLabel = providerLabels[currentProvider] || currentProvider;
  const providerDocs = storageDocsFor(currentProvider);

  // Build the config payload. Secret fields left blank are omitted so the
  // backend keeps the currently-stored value.
  const buildConfig = (): { config: StorageConfig } | { error: string } => {
    switch (currentProvider) {
      case 's3': {
        const config: Record<string, unknown> = { bucket: s3Bucket };
        if (s3IsCompatible) {
          config.endpoint = s3Endpoint;
        } else {
          config.region = s3Region;
        }
        if (s3AccessKeyId.trim()) config.accessKeyId = s3AccessKeyId.trim();
        if (s3SecretAccessKey) config.secretAccessKey = s3SecretAccessKey;
        return { config: config as unknown as StorageConfig };
      }
      case 'minio': {
        const config: Record<string, unknown> = {
          endpoint: minioEndpoint,
          port: minioPort,
          bucket: minioBucket,
        };
        if (minioAccessKey.trim()) config.accessKey = minioAccessKey.trim();
        if (minioSecretKey) config.secretKey = minioSecretKey;
        return { config: config as unknown as StorageConfig };
      }
      case 'gcs': {
        const config: Record<string, unknown> = {
          projectId: gcsProjectId,
          bucket: gcsBucket,
        };
        if (gcsCredentialsJson.trim()) {
          try {
            config.credentials = JSON.parse(gcsCredentialsJson);
          } catch {
            return { error: 'Service Account JSON is not valid JSON.' };
          }
        }
        return { config: config as unknown as StorageConfig };
      }
      case 'azure': {
        const config: Record<string, unknown> = {
          accountName: azureAccountName,
          containerName: azureContainerName,
        };
        if (azureAccountKey) config.accountKey = azureAccountKey;
        return { config: config as unknown as StorageConfig };
      }
      case 'local': {
        return { config: { localPath } as unknown as StorageConfig };
      }
      default:
        return { error: `Editing credentials for ${currentProvider} is not supported.` };
    }
  };

  const handleSubmit = async () => {
    setError(null);
    const result = buildConfig();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    try {
      await updateCredentials({
        storageProvider: currentProvider,
        config: result.config,
      }).unwrap();
      setSuccess(true);
      // Give the user a moment to see the success state, then close.
      setTimeout(() => onDone?.(), 1200);
    } catch (err: unknown) {
      const e = err as { data?: { message?: string } };
      setError(e.data?.message || 'Failed to update storage credentials.');
    }
  };

  const renderFields = () => {
    switch (currentProvider) {
      case 's3':
        return (
          <div className="space-y-4">
            {s3IsCompatible ? (
              <div className="space-y-2">
                <Label htmlFor="editS3Endpoint">Endpoint *</Label>
                <Input
                  id="editS3Endpoint"
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                  placeholder="https://nyc3.digitaloceanspaces.com"
                  className="font-mono text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="editS3Region">AWS Region</Label>
                <Select value={s3Region} onValueChange={setS3Region}>
                  <SelectTrigger id="editS3Region">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {AWS_REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="editS3Bucket">Bucket Name *</Label>
              <Input
                id="editS3Bucket"
                value={s3Bucket}
                onChange={(e) => setS3Bucket(e.target.value)}
                placeholder="my-deployment-assets"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editS3AccessKey">Access Key ID</Label>
              <Input
                id="editS3AccessKey"
                value={s3AccessKeyId}
                onChange={(e) => setS3AccessKeyId(e.target.value)}
                placeholder="Leave blank to keep current"
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editS3SecretKey">Secret Access Key</Label>
              <Input
                id="editS3SecretKey"
                type="password"
                value={s3SecretAccessKey}
                onChange={(e) => setS3SecretAccessKey(e.target.value)}
                placeholder="Leave blank to keep current"
                className="font-mono"
                autoComplete="new-password"
              />
            </div>
          </div>
        );

      case 'minio':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editMinioEndpoint">Endpoint *</Label>
                <Input
                  id="editMinioEndpoint"
                  value={minioEndpoint}
                  onChange={(e) => setMinioEndpoint(e.target.value)}
                  placeholder="minio.example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editMinioPort">Port</Label>
                <Input
                  id="editMinioPort"
                  type="number"
                  value={minioPort}
                  onChange={(e) => setMinioPort(parseInt(e.target.value) || 9000)}
                  placeholder="9000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editMinioBucket">Bucket Name *</Label>
              <Input
                id="editMinioBucket"
                value={minioBucket}
                onChange={(e) => setMinioBucket(e.target.value)}
                placeholder="my-bucket"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editMinioAccessKey">Access Key</Label>
                <Input
                  id="editMinioAccessKey"
                  value={minioAccessKey}
                  onChange={(e) => setMinioAccessKey(e.target.value)}
                  placeholder="Leave blank to keep current"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editMinioSecretKey">Secret Key</Label>
                <Input
                  id="editMinioSecretKey"
                  type="password"
                  value={minioSecretKey}
                  onChange={(e) => setMinioSecretKey(e.target.value)}
                  placeholder="Leave blank to keep current"
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
                <Label htmlFor="editGcsProject">Project ID *</Label>
                <Input
                  id="editGcsProject"
                  value={gcsProjectId}
                  onChange={(e) => setGcsProjectId(e.target.value)}
                  placeholder="my-project-123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editGcsBucket">Bucket Name *</Label>
                <Input
                  id="editGcsBucket"
                  value={gcsBucket}
                  onChange={(e) => setGcsBucket(e.target.value)}
                  placeholder="my-bucket"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editGcsCredentials">Service Account JSON</Label>
              <Textarea
                id="editGcsCredentials"
                value={gcsCredentialsJson}
                onChange={(e) => setGcsCredentialsJson(e.target.value)}
                placeholder="Leave blank to keep current credentials"
                className="font-mono text-xs h-32"
              />
            </div>
          </div>
        );

      case 'azure':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editAzureAccount">Account Name *</Label>
                <Input
                  id="editAzureAccount"
                  value={azureAccountName}
                  onChange={(e) => setAzureAccountName(e.target.value)}
                  placeholder="mystorageaccount"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editAzureContainer">Container Name *</Label>
                <Input
                  id="editAzureContainer"
                  value={azureContainerName}
                  onChange={(e) => setAzureContainerName(e.target.value)}
                  placeholder="my-container"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editAzureKey">Account Key</Label>
              <Input
                id="editAzureKey"
                type="password"
                value={azureAccountKey}
                onChange={(e) => setAzureAccountKey(e.target.value)}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
              />
            </div>
          </div>
        );

      case 'local':
        return (
          <div className="space-y-2">
            <Label htmlFor="editLocalPath">Storage Path *</Label>
            <Input
              id="editLocalPath"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="./uploads"
            />
            <p className="text-xs text-muted-foreground">
              Path relative to the backend working directory
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Edit {providerLabel} Credentials
        </CardTitle>
        <CardDescription>
          Update the connection details for your current storage provider — for example, rotating an
          access key — without migrating any files.
          {providerDocs && (
            <>
              {' '}
              <DocsInlineLink href={providerDocs.href}>Where to find these values</DocsInlineLink>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertDescription>
            Leave secret fields blank to keep the current value. Your new credentials are verified
            with a live connection test before anything is saved, so a bad key can&apos;t lock you
            out of your storage.
          </AlertDescription>
        </Alert>

        {renderFields()}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="bg-green-500/10 border-green-500/20">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              Storage credentials updated successfully.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || success}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying &amp; saving...
              </>
            ) : (
              'Test & Save'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
