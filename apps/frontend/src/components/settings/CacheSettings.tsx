import { useState, useEffect } from 'react';
import {
  useGetCacheConfigQuery,
  useSaveCacheConfigMutation,
  useGetRedisDefaultsQuery,
  useTestRedisConnectionMutation,
  useGetCacheStatsQuery,
  useClearCacheMutation,
  useGetConstraintsQuery,
  useGetAvailableOptionsQuery,
  CacheConfig,
} from '@/services/setupApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Edit2,
  Trash2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

export function CacheSettings() {
  const { data: cacheConfig, isLoading: isLoadingConfig } = useGetCacheConfigQuery();
  const { data: redisDefaults } = useGetRedisDefaultsQuery();
  const { data: constraints } = useGetConstraintsQuery();
  const { data: availableOptions } = useGetAvailableOptionsQuery();
  const { data: cacheStats, refetch: refetchStats } = useGetCacheStatsQuery();
  const [saveConfig, { isLoading: isSaving }] = useSaveCacheConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestRedisConnectionMutation();
  const [clearCache, { isLoading: isClearing }] = useClearCacheMutation();

  // Check cache options from available options (feature flags)
  const isManagedRedisAvailable = availableOptions?.cache?.managedRedis === true;
  const isLocalRedisAvailable = availableOptions?.cache?.localRedis === true;
  const isExternalRedisAvailable = availableOptions?.cache?.externalRedis !== false;

  // Check if Docker Redis is disabled via ENABLE_REDIS=false (CE only)
  const isDockerRedisDisabled = constraints?.redis.enabled === false;

  // Warning: Currently using Docker Redis but it's disabled in .env
  const redisDisabledButInUse =
    cacheConfig?.type === 'redis' &&
    cacheConfig?.redisSource === 'local' &&
    isDockerRedisDisabled;

  const [isEditing, setIsEditing] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<{
    success: boolean;
    clearedItems: number;
  } | null>(null);

  // Form state
  const [config, setConfig] = useState<CacheConfig>({
    enabled: true,
    type: 'memory',
    redisSource: 'local',
    defaultTtl: 3600,
    maxSizeMb: 100,
    maxFileSizeMb: 10,
  });

  // Initialize form from current config when editing starts
  useEffect(() => {
    if (isEditing && cacheConfig) {
      // Validate redisSource against what's actually available
      let validatedRedisSource = cacheConfig.redisSource ?? 'local';
      if (validatedRedisSource === 'local' && !isLocalRedisAvailable) {
        validatedRedisSource = isExternalRedisAvailable ? 'external' : 'local';
      } else if (validatedRedisSource === 'external' && !isExternalRedisAvailable) {
        validatedRedisSource = isLocalRedisAvailable ? 'local' : 'external';
      }

      setConfig({
        enabled: cacheConfig.enabled ?? true,
        type: cacheConfig.type ?? 'memory',
        redisSource: validatedRedisSource,
        defaultTtl: cacheConfig.defaultTtl ?? 3600,
        maxSizeMb: cacheConfig.maxSizeMb ?? 100,
        maxFileSizeMb: cacheConfig.maxFileSizeMb ?? 10,
        redis: cacheConfig.redisHost
          ? {
              host: cacheConfig.redisHost,
              port: cacheConfig.redisPort ?? 6379,
            }
          : undefined,
      });
    }
  }, [isEditing, cacheConfig, isLocalRedisAvailable, isExternalRedisAvailable]);

  const handleStartEditing = () => {
    setIsEditing(true);
    setTestResult(null);
    setUpdateError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTestResult(null);
    setUpdateError(null);
  };

  const handleSave = async () => {
    try {
      setUpdateError(null);

      // If Redis is selected and local, use defaults
      const configToSave = { ...config };
      if (configToSave.type === 'redis' && configToSave.redisSource === 'local' && redisDefaults) {
        configToSave.redis = {
          host: redisDefaults.host,
          port: redisDefaults.port,
        };
      }

      await saveConfig(configToSave).unwrap();
      setIsEditing(false);
      setTestResult(null);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setUpdateError(err.data?.message || 'Failed to save cache configuration');
    }
  };

  const handleTestConnection = async () => {
    if (config.type !== 'redis') return;

    try {
      setTestResult(null);

      let testConfig:
        | { host: string; port: number; password?: string; useLocalPassword?: boolean; useManagedConfig?: boolean }
        | undefined;
      if (config.redisSource === 'managed') {
        // For managed Redis, let the backend use the MANAGED_REDIS_* env vars
        testConfig = { host: '', port: 0, useManagedConfig: true };
      } else if (config.redisSource === 'local' && redisDefaults) {
        // For local Docker Redis, use server-side password from REDIS_PASSWORD env var
        testConfig = { host: redisDefaults.host, port: redisDefaults.port, useLocalPassword: true };
      } else if (config.redis) {
        testConfig = {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
        };
      }

      if (!testConfig) {
        setTestResult({ success: false, error: 'No Redis configuration to test' });
        return;
      }

      const result = await testConnection(testConfig).unwrap();
      setTestResult(result);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setTestResult({
        success: false,
        error: err.data?.message || 'Connection test failed',
      });
    }
  };

  const handleClearCache = async () => {
    try {
      setClearResult(null);
      const result = await clearCache().unwrap();
      setClearResult(result);
      refetchStats();
    } catch {
      setClearResult({ success: false, clearedItems: 0 });
    }
  };

  const formatHitRate = (rate: number) => {
    return `${(rate * 100).toFixed(1)}%`;
  };

  if (isLoadingConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Cache Settings
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Cache Settings
        </CardTitle>
        <CardDescription>
          Configure caching to reduce storage latency and costs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Warning: Configuration Mismatch */}
        {redisDisabledButInUse && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Configuration Mismatch:</strong> You're currently using Docker Redis, but{' '}
              <code className="bg-destructive/20 px-1 rounded">ENABLE_REDIS=false</code> is set in
              your .env file. Redis will not start on the next restart.
              <ul className="list-disc list-inside mt-2 text-sm">
                <li>Switch to memory caching or external Redis below</li>
                <li>
                  Or remove <code className="bg-destructive/20 px-1 rounded">ENABLE_REDIS=false</code>{' '}
                  from .env and restart
                </li>
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {!isEditing ? (
          // View mode
          <>
            <div className="space-y-3">
              <div className="flex items-center text-sm">
                {cacheConfig?.enabled ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                    <span className="text-muted-foreground">
                      Caching enabled ({cacheConfig.type === 'redis' ? 'Redis' : 'In-Memory LRU'})
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-yellow-500 mr-2" />
                    <span className="text-muted-foreground">Caching disabled</span>
                  </>
                )}
              </div>

              {cacheConfig?.enabled && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Type:</span>{' '}
                    <span className="font-medium">
                      {cacheConfig.type === 'redis'
                        ? `Redis (${
                            cacheConfig.redisSource === 'managed'
                              ? 'Managed/Shared'
                              : cacheConfig.redisSource === 'local'
                                ? 'Local Docker'
                                : 'External'
                          })`
                        : 'In-Memory (LRU)'}
                    </span>
                  </div>

                  {cacheConfig.type === 'redis' && cacheConfig.redisHost && (
                    <div>
                      <span className="text-muted-foreground">Host:</span>{' '}
                      <span className="font-mono">
                        {cacheConfig.redisHost}:{cacheConfig.redisPort}
                      </span>
                    </div>
                  )}

                  <div>
                    <span className="text-muted-foreground">Default TTL:</span>{' '}
                    <span className="font-medium">{cacheConfig.defaultTtl}s</span>
                  </div>

                  {cacheConfig.type === 'memory' && (
                    <div>
                      <span className="text-muted-foreground">Max Size:</span>{' '}
                      <span className="font-medium">{cacheConfig.maxSizeMb}MB</span>
                    </div>
                  )}

                  <div>
                    <span className="text-muted-foreground">Max File Size:</span>{' '}
                    <span className="font-medium">{cacheConfig.maxFileSizeMb}MB</span>
                  </div>
                </div>
              )}

              {/* Cache Statistics */}
              {cacheStats && cacheConfig?.enabled && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="font-medium mb-2">Cache Statistics</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <span className="text-muted-foreground block">Hit Rate</span>
                      <span className="font-medium text-lg">{formatHitRate(cacheStats.hitRate)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Items</span>
                      <span className="font-medium text-lg">{cacheStats.itemCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Size</span>
                      <span className="font-medium text-lg">{cacheStats.formattedSize}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Hits: {cacheStats.hits} | Misses: {cacheStats.misses}
                  </div>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={handleStartEditing}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Configuration
                </Button>
                {cacheConfig?.enabled && (
                  <>
                    <Button variant="outline" onClick={() => refetchStats()}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh Stats
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleClearCache}
                      disabled={isClearing}
                    >
                      {isClearing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Clear Cache
                    </Button>
                  </>
                )}
              </div>

              {clearResult && (
                <Alert variant={clearResult.success ? 'default' : 'destructive'}>
                  {clearResult.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {clearResult.success
                      ? `Cache cleared (${clearResult.clearedItems} items removed)`
                      : 'Failed to clear cache'}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </>
        ) : (
          // Edit mode
          <div className="space-y-4">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="cache-enabled">Enable Caching</Label>
                <p className="text-xs text-muted-foreground">
                  Cache storage assets to reduce latency and costs
                </p>
              </div>
              <Switch
                id="cache-enabled"
                checked={config.enabled}
                onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
              />
            </div>

            {config.enabled && (
              <>
                {/* Restart Warning - only show for self-hosted CE, not PaaS */}
                {cacheConfig && config.type !== cacheConfig.type && !isManagedRedisAvailable && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Switching cache backends requires a container restart to take effect.
                      Run <code className="bg-muted px-1 rounded">docker compose restart backend</code> after saving.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Cache Type Selection */}
                <div>
                  <Label className="mb-2 block">Cache Backend</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, type: 'memory' })}
                      className={`p-3 border rounded-lg text-left transition-colors ${
                        config.type === 'memory'
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div className="font-medium text-sm">In-Memory (LRU)</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fast, single-instance cache. Lost on restart.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, type: 'redis' })}
                      className={`p-3 border rounded-lg text-left transition-colors ${
                        config.type === 'redis'
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div className="font-medium text-sm">Redis</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Persistent cache that survives restarts.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Redis Configuration */}
                {config.type === 'redis' && (
                  <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                    <Label className="mb-2 block">Redis Source</Label>
                    <div className="space-y-2">
                      {/* Managed Redis (Shared) - Platform/PaaS only */}
                      {isManagedRedisAvailable && (
                        <label className="flex items-start space-x-3 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
                          <input
                            type="radio"
                            name="redisSource"
                            value="managed"
                            checked={config.redisSource === 'managed'}
                            onChange={() =>
                              setConfig({ ...config, redisSource: 'managed', redis: undefined })
                            }
                            className="mt-1"
                          />
                          <div>
                            <div className="font-medium">Managed Redis (Shared)</div>
                            <div className="text-sm text-muted-foreground">
                              Platform-provided Redis with automatic workspace isolation.
                            </div>
                          </div>
                        </label>
                      )}

                      {/* Local Redis (Docker) - CE only, not available on PaaS */}
                      {isLocalRedisAvailable && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <label
                                className={`flex items-start space-x-3 p-3 border rounded-md ${
                                  isDockerRedisDisabled
                                    ? 'opacity-60 cursor-not-allowed'
                                    : 'cursor-pointer hover:bg-muted/50'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="redisSource"
                                  value="local"
                                  checked={config.redisSource === 'local'}
                                  disabled={isDockerRedisDisabled}
                                  onChange={() =>
                                    setConfig({ ...config, redisSource: 'local', redis: undefined })
                                  }
                                  className="mt-1"
                                />
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div className="font-medium">Local Redis (Docker)</div>
                                    {isDockerRedisDisabled && (
                                      <Badge variant="outline" className="text-xs">
                                        Unavailable
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    Use the bundled Redis service from Docker Compose.
                                  </div>
                                </div>
                              </label>
                            </TooltipTrigger>
                            {isDockerRedisDisabled && (
                              <TooltipContent side="bottom" className="max-w-xs">
                                <p>{constraints?.redis.reason}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      )}

                      {/* External Redis - BYOB option */}
                      {isExternalRedisAvailable && (
                        <label className="flex items-start space-x-3 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
                          <input
                            type="radio"
                            name="redisSource"
                            value="external"
                            checked={config.redisSource === 'external'}
                            onChange={() =>
                              setConfig({
                                ...config,
                                redisSource: 'external',
                                redis: { host: '', port: 6379 },
                              })
                            }
                            className="mt-1"
                          />
                          <div>
                            <div className="font-medium">External Redis</div>
                            <div className="text-sm text-muted-foreground">
                              AWS ElastiCache, Redis Cloud, Upstash, or self-hosted.
                            </div>
                          </div>
                        </label>
                      )}
                    </div>

                    {/* External Redis Connection Settings */}
                    {config.redisSource === 'external' && (
                      <div className="space-y-4 mt-4 p-3 bg-background rounded-md">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="redis-host">Host</Label>
                            <Input
                              id="redis-host"
                              value={config.redis?.host || ''}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  redis: {
                                    ...config.redis,
                                    host: e.target.value,
                                    port: config.redis?.port || 6379,
                                  },
                                })
                              }
                              placeholder="redis.example.com"
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label htmlFor="redis-port">Port</Label>
                            <Input
                              id="redis-port"
                              type="number"
                              value={config.redis?.port || 6379}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  redis: {
                                    ...config.redis,
                                    host: config.redis?.host || '',
                                    port: parseInt(e.target.value) || 6379,
                                  },
                                })
                              }
                              placeholder="6379"
                              className="mt-1"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="redis-password">Password</Label>
                          <Input
                            id="redis-password"
                            type="password"
                            value={config.redis?.password || ''}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                redis: {
                                  ...config.redis,
                                  host: config.redis?.host || '',
                                  port: config.redis?.port || 6379,
                                  password: e.target.value || undefined,
                                },
                              })
                            }
                            placeholder="Required for most cloud providers"
                            className="mt-1"
                          />
                        </div>
                      </div>
                    )}

                    {/* Managed Redis Info */}
                    {config.redisSource === 'managed' && (
                      <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-md">
                        <p className="text-sm text-green-800 dark:text-green-200">
                          <strong>Ready to use!</strong> Platform-managed Redis with automatic
                          workspace key prefix for data isolation.
                        </p>
                      </div>
                    )}

                    {/* Local Redis Info */}
                    {config.redisSource === 'local' && redisDefaults && (
                      <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-md">
                        <p className="text-sm text-green-800 dark:text-green-200">
                          <strong>Ready to use!</strong> Local Redis is available at{' '}
                          <code className="bg-green-100 dark:bg-green-900 px-1 rounded">
                            {redisDefaults.host}:{redisDefaults.port}
                          </code>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Memory Cache Settings */}
                {config.type === 'memory' && (
                  <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                    <div>
                      <Label htmlFor="max-size">Max Cache Size (MB)</Label>
                      <Input
                        id="max-size"
                        type="number"
                        value={config.maxSizeMb || 100}
                        onChange={(e) =>
                          setConfig({ ...config, maxSizeMb: parseInt(e.target.value) || 100 })
                        }
                        min={10}
                        max={1000}
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}

                {/* Common Settings */}
                <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="default-ttl">Default TTL (seconds)</Label>
                    <Input
                      id="default-ttl"
                      type="number"
                      value={config.defaultTtl || 3600}
                      onChange={(e) =>
                        setConfig({ ...config, defaultTtl: parseInt(e.target.value) || 3600 })
                      }
                      min={60}
                      max={86400}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      How long to cache files. HTML uses shorter TTL automatically.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="max-file-size">Max File Size to Cache (MB)</Label>
                    <Input
                      id="max-file-size"
                      type="number"
                      value={config.maxFileSizeMb || 10}
                      onChange={(e) =>
                        setConfig({ ...config, maxFileSizeMb: parseInt(e.target.value) || 10 })
                      }
                      min={1}
                      max={50}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Files larger than this will not be cached.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* Test Result */}
            {testResult && (
              <Alert variant={testResult.success ? 'default' : 'destructive'}>
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertDescription>
                  {testResult.success
                    ? `Connection successful${testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ''}`
                    : testResult.error || 'Connection failed'}
                </AlertDescription>
              </Alert>
            )}

            {/* Update Error */}
            {updateError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{updateError}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              {config.type === 'redis' && (
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || (config.redisSource === 'external' && !config.redis?.host)}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
              )}
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
