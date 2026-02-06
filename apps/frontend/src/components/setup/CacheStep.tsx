import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useGetCacheConfigQuery,
  useSaveCacheConfigMutation,
  useGetRedisDefaultsQuery,
  useTestRedisConnectionMutation,
  useGetConstraintsQuery,
  useGetAvailableOptionsQuery,
  CacheConfig,
} from '@/services/setupApi';
import {
  nextWizardStep,
  prevWizardStep,
  setCacheConfigured,
  setCacheSkipped,
  setWizardError,
} from '@/store/slices/setupSlice';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  AlertTriangle,
  HardDrive,
  Server,
  Shield,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

type ConfigMode = 'configure' | 'skip';
type CacheType = 'memory' | 'redis' | 'managed';
type RedisSource = 'local' | 'external' | 'managed';

export function CacheStep() {
  const dispatch = useDispatch();
  const { cacheConfigured } = useSelector((state: RootState) => state.setup.wizard);

  const [configMode, setConfigMode] = useState<ConfigMode>('configure');
  const [cacheType, setCacheType] = useState<CacheType>('memory');
  const [redisSource, setRedisSource] = useState<RedisSource>('local');
  const [connectionTested, setConnectionTested] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);

  // Form state
  const [redisHost, setRedisHost] = useState('');
  const [redisPort, setRedisPort] = useState(6379);
  const [redisPassword, setRedisPassword] = useState('');
  const [defaultTtl, setDefaultTtl] = useState(3600);
  const [maxSizeMb, setMaxSizeMb] = useState(100);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(10);

  const { data: currentConfig, isLoading: isLoadingConfig } = useGetCacheConfigQuery();
  const { data: redisDefaults } = useGetRedisDefaultsQuery();
  const { data: constraints } = useGetConstraintsQuery();
  const { data: availableOptions, isLoading: isLoadingOptions } = useGetAvailableOptionsQuery();
  const [saveConfig, { isLoading: isSaving }] = useSaveCacheConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestRedisConnectionMutation();

  // Check if Docker Redis is disabled via ENABLE_REDIS=false
  const isDockerRedisDisabled = constraints?.redis.enabled === false;

  // Get cache options from feature flags
  const cacheOptions = availableOptions?.cache;
  const shouldSkipStep = cacheOptions?.skipStep ?? false;
  const defaultCacheType = (cacheOptions?.defaultType as CacheType) || 'memory';
  const enableManagedRedis = cacheOptions?.managedRedis ?? false;
  const enableLocalRedis = cacheOptions?.localRedis ?? true;
  const enableExternalRedis = cacheOptions?.externalRedis ?? true;
  const enableLruCache = cacheOptions?.lru ?? true;

  // Initialize form from existing config
  useEffect(() => {
    if (currentConfig) {
      setCacheType(currentConfig.type || 'memory');
      if (currentConfig.redisSource) {
        // Validate redisSource against what's actually available
        // If local was saved but is no longer available, switch to external
        const savedSource = currentConfig.redisSource;
        if (savedSource === 'local' && !enableLocalRedis) {
          setRedisSource('external');
        } else if (savedSource === 'external' && !enableExternalRedis) {
          setRedisSource(enableLocalRedis ? 'local' : 'external');
        } else {
          setRedisSource(savedSource);
        }
      }
      if (currentConfig.defaultTtl) {
        setDefaultTtl(currentConfig.defaultTtl);
      }
      if (currentConfig.maxSizeMb) {
        setMaxSizeMb(currentConfig.maxSizeMb);
      }
      if (currentConfig.maxFileSizeMb) {
        setMaxFileSizeMb(currentConfig.maxFileSizeMb);
      }
      if (currentConfig.redisHost) {
        setRedisHost(currentConfig.redisHost);
      }
      if (currentConfig.redisPort) {
        setRedisPort(currentConfig.redisPort);
      }
    }
  }, [currentConfig, enableLocalRedis, enableExternalRedis]);

  // Set defaults for local Redis
  useEffect(() => {
    if (redisDefaults && redisSource === 'local') {
      setRedisHost(redisDefaults.host);
      setRedisPort(redisDefaults.port);
    }
  }, [redisDefaults, redisSource]);


  // Set initial cache type from default
  useEffect(() => {
    if (cacheOptions && !currentConfig?.isConfigured) {
      if (enableManagedRedis) {
        setCacheType('managed');
        setRedisSource('managed');
      } else if (defaultCacheType) {
        setCacheType(defaultCacheType);
      }
    }
  }, [cacheOptions, enableManagedRedis, defaultCacheType, currentConfig?.isConfigured]);

  const handleTestConnection = async () => {
    try {
      dispatch(setWizardError(null));
      setConnectionTested(false);
      setConnectionSuccess(false);
      setTestLatency(null);

      const host = redisSource === 'local' ? (redisDefaults?.host || 'redis') : redisHost;
      const port = redisSource === 'local' ? (redisDefaults?.port || 6379) : redisPort;

      const result = await testConnection({
        host,
        port,
        password: redisPassword || undefined,
        useLocalPassword: redisSource === 'local', // Use server-side password for local Redis
      }).unwrap();

      setConnectionTested(true);
      setConnectionSuccess(result.success);
      setTestLatency(result.latencyMs || null);

      if (!result.success) {
        dispatch(setWizardError(result.error || 'Redis connection test failed'));
      }
    } catch (error: unknown) {
      setConnectionTested(true);
      setConnectionSuccess(false);
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to test Redis connection'));
    }
  };

  const handleConfigureAndContinue = async () => {
    try {
      dispatch(setWizardError(null));

      const config: CacheConfig = {
        enabled: true,
        type: cacheType === 'managed' ? 'redis' : cacheType,
        defaultTtl,
        maxSizeMb,
        maxFileSizeMb,
      };

      if (cacheType === 'managed') {
        // Managed Redis uses platform-provided credentials
        config.redisSource = 'managed' as 'local' | 'external';
      } else if (cacheType === 'redis') {
        config.redisSource = redisSource;
        config.redis = {
          host: redisSource === 'local' ? (redisDefaults?.host || 'redis') : redisHost,
          port: redisSource === 'local' ? (redisDefaults?.port || 6379) : redisPort,
          password: redisPassword || undefined,
        };
      }

      await saveConfig(config).unwrap();
      dispatch(setCacheConfigured(true));
      dispatch(nextWizardStep());
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to save cache configuration'));
    }
  };

  const handleSkip = () => {
    dispatch(setCacheSkipped(true));
    dispatch(nextWizardStep());
  };

  const handleContinue = () => {
    dispatch(nextWizardStep());
  };

  if (isLoadingConfig || isLoadingOptions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If we should skip this step, show a read-only pre-configured view
  if (shouldSkipStep) {
    const cacheTypeName = defaultCacheType === 'managed' ? 'Platform Managed Redis' :
                          defaultCacheType === 'redis' ? 'Redis' : 'In-Memory (LRU)';

    const handleSkipContinue = async () => {
      // Save the pre-configured settings and continue
      const autoConfig: CacheConfig = {
        enabled: true,
        type: defaultCacheType === 'managed' ? 'redis' : (defaultCacheType as 'memory' | 'redis'),
        defaultTtl: 3600,
        maxSizeMb: 100,
        maxFileSizeMb: 10,
      };

      if (defaultCacheType === 'managed') {
        autoConfig.redisSource = 'managed';
      }

      try {
        await saveConfig(autoConfig).unwrap();
        dispatch(setCacheConfigured(true));
        dispatch(nextWizardStep());
      } catch {
        dispatch(setWizardError('Failed to configure cache'));
      }
    };

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">Cache Configuration</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cache has been pre-configured for this workspace.
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <CheckCircle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">{cacheTypeName}</p>
              <p className="text-sm text-muted-foreground">
                {defaultCacheType === 'managed'
                  ? 'Platform-managed Redis cache with automatic configuration'
                  : defaultCacheType === 'redis'
                  ? 'Redis cache for high-performance caching'
                  : 'In-memory LRU cache for fast, local caching'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
            Back
          </Button>
          <Button onClick={handleSkipContinue} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </div>
    );
  }

  const canContinue =
    cacheConfigured ||
    (configMode === 'configure' &&
      (cacheType === 'memory' ||
        cacheType === 'managed' ||
        (cacheType === 'redis' && connectionSuccess)));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Cache Configuration</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure caching to improve performance and reduce cloud storage costs. Cache frequently
          accessed files in memory or Redis.
        </p>
      </div>

      {/* Configuration Mode Selection */}
      <div className="space-y-3">
        {/* Configure Option */}
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            configMode === 'configure'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="configMode"
            value="configure"
            checked={configMode === 'configure'}
            onChange={() => setConfigMode('configure')}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <div className="flex items-center">
              <Database className="w-4 h-4 mr-2 text-muted-foreground" />
              <span className="font-medium">Configure Caching</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose between in-memory (LRU) or Redis caching
            </p>
          </div>
        </label>

        {/* Skip Option */}
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            configMode === 'skip'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="configMode"
            value="skip"
            checked={configMode === 'skip'}
            onChange={() => setConfigMode('skip')}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500" />
              <span className="font-medium">Skip for Now (Use Defaults)</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              In-memory caching will be enabled by default
            </p>
          </div>
        </label>
      </div>

      {/* Cache Type Selection and Configuration */}
      {configMode === 'configure' && (
        <div className="space-y-4">
          {/* Cache Type Cards - vertical layout for better readability */}
          <div className="flex flex-col gap-3">
            {/* Managed Redis (Platform) */}
            {enableManagedRedis && (
              <button
                type="button"
                onClick={() => {
                  setCacheType('managed');
                  setRedisSource('managed');
                  setConnectionTested(false);
                  setConnectionSuccess(false);
                }}
                className={`flex items-start gap-4 p-4 border rounded-lg text-left transition-colors ${
                  cacheType === 'managed'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <Shield className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">Managed Redis</span>
                    <Badge variant="secondary" className="text-xs">Platform</Badge>
                    <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                      Recommended
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Platform-managed Redis with automatic configuration and workspace isolation.
                  </p>
                </div>
              </button>
            )}

            {/* Memory Cache */}
            {enableLruCache && (
              <button
                type="button"
                onClick={() => {
                  setCacheType('memory');
                  setConnectionTested(false);
                  setConnectionSuccess(false);
                }}
                className={`flex items-start gap-4 p-4 border rounded-lg text-left transition-colors ${
                  cacheType === 'memory'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <HardDrive className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium">In-Memory (LRU)</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Fast, single-instance cache. Lost on restart. Best for development or single-server deployments.
                  </p>
                </div>
              </button>
            )}

            {/* Redis Cache (Local/External) - BYOB option */}
            {(enableLocalRedis || enableExternalRedis) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isDockerRedisDisabled || enableExternalRedis) {
                          setCacheType('redis');
                          const newSource = enableLocalRedis && !isDockerRedisDisabled ? 'local' : 'external';
                          setRedisSource(newSource);
                          // Clear host when switching to external to avoid showing local defaults
                          if (newSource === 'external') {
                            setRedisHost('');
                          }
                          setConnectionTested(false);
                          setConnectionSuccess(false);
                        }
                      }}
                      disabled={isDockerRedisDisabled && !enableExternalRedis}
                      className={`flex items-start gap-4 p-4 border rounded-lg text-left transition-colors ${
                        cacheType === 'redis'
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : isDockerRedisDisabled && !enableExternalRedis
                            ? 'border-border opacity-60 cursor-not-allowed'
                            : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <Server className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {enableManagedRedis ? 'External Redis' : 'Redis'}
                          </span>
                          {isDockerRedisDisabled && !enableExternalRedis && (
                            <Badge variant="outline" className="text-xs">Unavailable</Badge>
                          )}
                          {enableManagedRedis && (
                            <Badge variant="outline" className="text-xs">BYOB</Badge>
                          )}
                          {!enableManagedRedis && !(isDockerRedisDisabled && !enableExternalRedis) && (
                            <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {enableManagedRedis
                            ? 'Bring your own Redis (AWS ElastiCache, Upstash, Redis Cloud, etc.)'
                            : 'Persistent cache that survives restarts. Faster than memory for large datasets.'}
                        </p>
                      </div>
                    </button>
                  </TooltipTrigger>
                  {isDockerRedisDisabled && !enableExternalRedis && (
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>{constraints?.redis.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        You can still use external Redis by selecting memory cache and then configuring
                        external Redis in admin settings after setup.
                      </p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Managed Redis Info */}
          {cacheType === 'managed' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center">
                <Shield className="w-5 h-5 text-primary mr-3" />
                <div>
                  <h4 className="font-medium">Platform Managed Redis</h4>
                  <p className="text-sm text-muted-foreground">
                    Redis is automatically configured and managed by the platform
                  </p>
                </div>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">
                    Shared Redis with automatic credentials
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
          )}

          {/* Redis Configuration */}
          {cacheType === 'redis' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium">Redis Configuration</h4>

              {/* Redis Source Selection - only show if both options are available */}
              {enableLocalRedis && enableExternalRedis && (
                <div className="space-y-3">
                  <Label>Redis Source</Label>
                  <div className="space-y-2">
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
                              checked={redisSource === 'local'}
                              disabled={isDockerRedisDisabled}
                              onChange={() => {
                                setRedisSource('local');
                                setConnectionTested(false);
                                setConnectionSuccess(false);
                              }}
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
                                Use the bundled Redis service from Docker Compose. No additional setup
                                required.
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

                    <label className="flex items-start space-x-3 p-3 border rounded-md cursor-pointer hover:bg-muted/50">
                      <input
                        type="radio"
                        name="redisSource"
                        value="external"
                        checked={redisSource === 'external'}
                        onChange={() => {
                          setRedisSource('external');
                          setRedisHost('');
                          setConnectionTested(false);
                          setConnectionSuccess(false);
                        }}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-medium">External Redis</div>
                        <div className="text-sm text-muted-foreground">
                          Connect to AWS ElastiCache, Google Memorystore, Azure Cache, Redis Cloud, or
                          self-hosted Redis.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* External Redis Connection Settings */}
              {redisSource === 'external' && (
                <div className="space-y-4 mt-4 p-3 bg-background rounded-md border">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="redisHost">Host</Label>
                      <Input
                        id="redisHost"
                        value={redisHost}
                        onChange={(e) => setRedisHost(e.target.value)}
                        placeholder="redis.example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="redisPort">Port</Label>
                      <Input
                        id="redisPort"
                        type="number"
                        value={redisPort}
                        onChange={(e) => setRedisPort(parseInt(e.target.value) || 6379)}
                        placeholder="6379"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="redisPassword">Password (optional)</Label>
                    <Input
                      id="redisPassword"
                      type="password"
                      value={redisPassword}
                      onChange={(e) => setRedisPassword(e.target.value)}
                      placeholder="Required for most cloud providers"
                    />
                  </div>
                </div>
              )}

              {/* Local Redis Info - only show if local Redis is enabled */}
              {enableLocalRedis && redisSource === 'local' && (
                <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-md">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Local Redis is available at{' '}
                    <code className="bg-green-100 dark:bg-green-900 px-1 rounded">
                      {redisDefaults?.host || 'redis'}:{redisDefaults?.port || 6379}
                    </code>
                  </p>
                </div>
              )}

              {/* Test Connection Button */}
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={
                  isTesting || (redisSource === 'external' && (!redisHost || !redisPort))
                }
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
            </div>
          )}

          {/* Memory Cache Settings */}
          {cacheType === 'memory' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium">Memory Cache Settings</h4>
              <div className="space-y-2">
                <Label htmlFor="maxSizeMb">Max Cache Size (MB)</Label>
                <Input
                  id="maxSizeMb"
                  type="number"
                  value={maxSizeMb}
                  onChange={(e) => setMaxSizeMb(parseInt(e.target.value) || 100)}
                  min={10}
                  max={1000}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum memory allocated for caching
                </p>
              </div>
            </div>
          )}

          {/* Common Settings */}
          <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium">Cache Settings</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="defaultTtl">Default TTL (seconds)</Label>
                <Input
                  id="defaultTtl"
                  type="number"
                  value={defaultTtl}
                  onChange={(e) => setDefaultTtl(parseInt(e.target.value) || 3600)}
                  min={60}
                  max={86400}
                />
                <p className="text-xs text-muted-foreground">How long to cache files</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxFileSizeMb">Max File Size (MB)</Label>
                <Input
                  id="maxFileSizeMb"
                  type="number"
                  value={maxFileSizeMb}
                  onChange={(e) => setMaxFileSizeMb(parseInt(e.target.value) || 10)}
                  min={1}
                  max={50}
                />
                <p className="text-xs text-muted-foreground">Files larger than this are not cached</p>
              </div>
            </div>
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
              <span className="text-green-700 dark:text-green-400">
                Redis connection successful!
                {testLatency && ` (${testLatency}ms)`}
              </span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-destructive mr-2" />
              <span className="text-destructive">
                Redis connection failed. Check your configuration.
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
          {configMode === 'skip' ? (
            <Button onClick={handleSkip}>Skip & Continue</Button>
          ) : (
            <>
              {cacheType === 'redis' && !connectionSuccess && (
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={
                    isTesting || (redisSource === 'external' && (!redisHost || !redisPort))
                  }
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
              )}

              {cacheType === 'memory' ? (
                <Button onClick={handleConfigureAndContinue} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save & Continue'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={canContinue ? handleConfigureAndContinue : handleContinue}
                  disabled={!canContinue || isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save & Continue'
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
