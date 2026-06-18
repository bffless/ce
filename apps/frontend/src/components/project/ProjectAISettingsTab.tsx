import { useState, useMemo, useEffect } from 'react';
import {
  useGetProjectAIStatusQuery,
  useAddProjectAIProviderMutation,
  useRemoveProjectAIProviderMutation,
  useSetProjectDefaultAIProviderMutation,
  useTestProjectAIMutation,
  useGetAvailableAIProvidersQuery,
  usePreviewProviderModelsMutation,
  useGetProjectAIServicesQuery,
  useAddProjectAIServiceMutation,
  useRemoveProjectAIServiceMutation,
  useTestProjectAIServiceMutation,
  AIProviderType,
  AIServiceType,
  ConfiguredProvider,
  ModelInfo,
  ModelTier,
  Project,
} from '@/services/projectsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Bot,
  AlertTriangle,
  Plus,
  Trash2,
  Star,
  Zap,
  DollarSign,
  Brain,
  ChevronsUpDown,
  Check,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ProjectAIPluginsSection } from './ProjectAIPluginsSection';
import { ProjectSecretsSection } from './ProjectSecretsSection';

// AI Service display config
const SERVICE_CONFIG: Record<string, { name: string; color: string; bgColor: string; description: string }> = {
  replicate: {
    name: 'Replicate',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    description: 'Run ML models (CLIP embeddings, image generation, transcription, etc.)',
  },
};

// AI Services section component
function ProjectAIServicesSection({ project }: { project: Project }) {
  const { data: servicesStatus } = useGetProjectAIServicesQuery(project.id);
  const [addService, { isLoading: isAdding }] = useAddProjectAIServiceMutation();
  const [removeService] = useRemoveProjectAIServiceMutation();
  const [testService] = useTestProjectAIServiceMutation();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addToken, setAddToken] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [removingService, setRemovingService] = useState<string | null>(null);
  const [testingToken, setTestingToken] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const configuredServices = servicesStatus?.services || [];
  const hasReplicate = configuredServices.some((s) => s.service === 'replicate');

  const handleAdd = async () => {
    try {
      setAddError(null);
      await addService({
        projectId: project.id,
        service: 'replicate' as AIServiceType,
        apiToken: addToken.trim(),
      }).unwrap();
      setShowAddDialog(false);
      setAddToken('');
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setAddError(err.data?.message || 'Failed to add service');
    }
  };

  const handleRemove = async (service: string) => {
    try {
      setRemovingService(service);
      await removeService({
        projectId: project.id,
        service: service as AIServiceType,
      }).unwrap();
    } catch (error) {
      console.error('Failed to remove service:', error);
    } finally {
      setRemovingService(null);
    }
  };

  const handleTest = async () => {
    if (!testingToken.trim()) return;
    try {
      setTestResult(null);
      const result = await testService({
        projectId: project.id,
        service: 'replicate' as AIServiceType,
        apiToken: testingToken.trim(),
      }).unwrap();
      setTestResult({
        success: result.success,
        message: result.message || (result.success ? 'Connection successful' : 'Connection failed'),
      });
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setTestResult({
        success: false,
        message: err.data?.message || 'Test failed',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              AI Services
            </CardTitle>
            <CardDescription>
              Configure external ML services for pipeline steps.
            </CardDescription>
          </div>
          {!hasReplicate && (
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Service
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {configuredServices.length > 0 ? (
          <div className="space-y-3">
            {configuredServices.map((svc) => {
              const meta = SERVICE_CONFIG[svc.service] || { name: svc.service, color: 'text-gray-600', bgColor: 'bg-gray-50', description: '' };
              return (
                <div key={svc.service} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn('p-2 rounded-lg', meta.bgColor)}>
                        <Zap className={cn('w-5 h-5', meta.color)} />
                      </div>
                      <div>
                        <h4 className="font-medium">{meta.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Token: <span className="font-mono text-xs">{svc.apiToken}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(svc.service)}
                      disabled={removingService === svc.service}
                      className="text-destructive hover:text-destructive"
                      title="Remove service"
                    >
                      {removingService === svc.service ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
              <span className="text-muted-foreground">No AI services configured</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Add an AI service to enable Replicate ML model pipelines.
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Service
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={showAddDialog} onOpenChange={(open) => {
        setShowAddDialog(open);
        if (!open) {
          setAddToken('');
          setAddError(null);
          setTestingToken('');
          setTestResult(null);
        }
      }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Add Replicate</DialogTitle>
            <DialogDescription>
              Add your Replicate API token to enable ML model pipelines.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="replicate-token">API Token</Label>
              <Input
                id="replicate-token"
                type="password"
                value={addToken}
                onChange={(e) => {
                  setAddToken(e.target.value);
                  setTestingToken(e.target.value);
                }}
                placeholder="r8_..."
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Get your API token from{' '}
                <a
                  href="https://replicate.com/account/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  replicate.com/account/api-tokens
                </a>
              </p>
            </div>

            {addToken.trim() && (
              <div>
                <Button variant="outline" size="sm" onClick={handleTest}>
                  <Zap className="h-4 w-4 mr-1" />
                  Test Connection
                </Button>
                {testResult && (
                  <div className={cn(
                    'mt-2 p-2 rounded text-sm flex items-center gap-2',
                    testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  )}>
                    {testResult.success ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </div>
                )}
              </div>
            )}

            {addError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!addToken.trim() || isAdding}
            >
              {isAdding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Replicate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Provider display config
const PROVIDER_CONFIG: Record<string, { color: string; bgColor: string; displayName: string }> = {
  openai: { color: 'text-green-600', bgColor: 'bg-green-50', displayName: 'OpenAI' },
  anthropic: { color: 'text-orange-500', bgColor: 'bg-orange-50', displayName: 'Anthropic' },
  google: { color: 'text-blue-500', bgColor: 'bg-blue-50', displayName: 'Google AI' },
};

// Tier display config
const TIER_CONFIG: Record<ModelTier, { label: string; icon: React.ElementType; color: string; description: string }> = {
  economy: { label: 'Economy', icon: DollarSign, color: 'text-green-600', description: 'Fast & affordable' },
  balanced: { label: 'Balanced', icon: Zap, color: 'text-yellow-600', description: 'Good balance' },
  premium: { label: 'Premium', icon: Brain, color: 'text-purple-600', description: 'Most capable' },
};

function TierBadge({ tier }: { tier: ModelTier }) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('text-xs', config.color)}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

// Model selector with typeahead
function ModelSelector({
  value,
  onChange,
  suggestedModels,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestedModels: ModelInfo[];
}) {
  const [open, setOpen] = useState(false);

  // Group models by tier
  const groupedModels = useMemo(() => {
    const groups: Record<ModelTier, ModelInfo[]> = {
      premium: [],
      balanced: [],
      economy: [],
    };
    suggestedModels.forEach((model) => {
      groups[model.tier].push(model);
    });
    return groups;
  }, [suggestedModels]);

  const selectedModel = suggestedModels.find((m) => m.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm">{value}</span>
              {selectedModel && <TierBadge tier={selectedModel.tier} />}
            </span>
          ) : (
            <span className="text-muted-foreground">Select or type a model...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or type model name..."
            value={value}
            onValueChange={onChange}
          />
          <CommandList>
            <CommandEmpty>
              <div className="py-2 text-sm text-muted-foreground">
                Using custom model: <span className="font-mono">{value}</span>
              </div>
            </CommandEmpty>
            {(['premium', 'balanced', 'economy'] as ModelTier[]).map((tier) => {
              const models = groupedModels[tier];
              if (models.length === 0) return null;
              const tierConfig = TIER_CONFIG[tier];
              const TierIcon = tierConfig.icon;
              return (
                <CommandGroup
                  key={tier}
                  heading={
                    <span className={cn('flex items-center gap-1', tierConfig.color)}>
                      <TierIcon className="w-3 h-3" />
                      {tierConfig.label} - {tierConfig.description}
                    </span>
                  }
                >
                  {models.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={model.id}
                      onSelect={() => {
                        onChange(model.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === model.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-mono text-sm">{model.id}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Configured provider card
function ProviderCard({
  provider,
  onRemove,
  onSetDefault,
  onTest,
  isRemoving,
  isTesting,
  testResult,
}: {
  provider: ConfiguredProvider;
  onRemove: () => void;
  onSetDefault: () => void;
  onTest: () => void;
  isRemoving: boolean;
  isTesting: boolean;
  testResult?: { success: boolean; message: string; latencyMs?: number } | null;
}) {
  const config = PROVIDER_CONFIG[provider.provider] || { color: 'text-gray-600', bgColor: 'bg-gray-50', displayName: provider.provider };

  return (
    <div className={cn('border rounded-lg p-4', provider.isDefault && 'ring-2 ring-primary')}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', config.bgColor)}>
            <Bot className={cn('w-5 h-5', config.color)} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{config.displayName}</h4>
              {provider.isDefault && (
                <Badge variant="secondary" className="text-xs">
                  <Star className="w-3 h-3 mr-1 fill-current" />
                  Default
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">API key configured</p>
            {provider.defaultModel && (
              <p className="text-xs text-muted-foreground mt-1">
                Model: <span className="font-mono">{provider.defaultModel}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            title="Test connection"
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
          </Button>
          {!provider.isDefault && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSetDefault}
              title="Set as default"
            >
              <Star className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={isRemoving}
            className="text-destructive hover:text-destructive"
            title="Remove provider"
          >
            {isRemoving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {testResult && (
        <div className={cn(
          'mt-3 p-2 rounded text-sm flex items-center gap-2',
          testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        )}>
          {testResult.success ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {testResult.message}
          {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
        </div>
      )}
    </div>
  );
}

// Add provider dialog
function AddProviderDialog({
  open,
  onOpenChange,
  projectId,
  availableProviders,
  onAdd,
  isAdding,
  error,
  isFirstProvider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  availableProviders: { provider: AIProviderType; displayName: string; models: ModelInfo[] }[];
  onAdd: (provider: AIProviderType, apiKey: string, defaultModel: string, isDefault: boolean) => void;
  isAdding: boolean;
  error: string | null;
  isFirstProvider: boolean;
}) {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderType | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  // First provider is always default
  const [isDefault, setIsDefault] = useState(isFirstProvider);
  // Live model list fetched with the entered key (overrides the static catalog)
  const [liveModels, setLiveModels] = useState<ModelInfo[] | null>(null);

  const [previewModels, { isLoading: isLoadingModels }] = usePreviewProviderModelsMutation();

  const selectedProviderInfo = availableProviders.find((p) => p.provider === selectedProvider);

  // When a plausible key is entered, fetch the live model list (debounced) so the
  // default-model picker reflects models that key can actually access.
  useEffect(() => {
    if (!selectedProvider || apiKey.trim().length < 8) {
      setLiveModels(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const result = await previewModels({
          projectId,
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        }).unwrap();
        setLiveModels(result.models?.length ? result.models : null);
      } catch {
        setLiveModels(null); // fall back to the static catalog
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [apiKey, selectedProvider, projectId, previewModels]);

  // Prefer live models when available, otherwise the static catalog
  const modelOptions = liveModels ?? selectedProviderInfo?.models ?? [];

  const handleSubmit = () => {
    if (selectedProvider && apiKey.trim()) {
      onAdd(selectedProvider, apiKey.trim(), defaultModel, isDefault);
    }
  };

  const handleClose = () => {
    setSelectedProvider(null);
    setApiKey('');
    setDefaultModel('');
    setLiveModels(null);
    setIsDefault(isFirstProvider); // Reset to true for first provider
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add AI Provider</DialogTitle>
          <DialogDescription>
            Configure a new AI provider for this project's chat pipelines.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div>
            <Label className="mb-2 block">Provider</Label>
            <div className="grid grid-cols-1 gap-2">
              {availableProviders.map((provider) => {
                const config = PROVIDER_CONFIG[provider.provider] || { color: 'text-gray-600', bgColor: 'bg-gray-50', displayName: provider.displayName };
                return (
                  <button
                    key={provider.provider}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(provider.provider);
                      setDefaultModel(provider.models[0]?.id || '');
                    }}
                    className={cn(
                      'p-3 border rounded-lg text-left transition-colors flex items-start gap-3',
                      selectedProvider === provider.provider
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <div className={cn('p-2 rounded-lg', config.bgColor)}>
                      <Bot className={cn('w-4 h-4', config.color)} />
                    </div>
                    <div>
                      <span className="font-medium text-sm">{provider.displayName}</span>
                      <p className="text-xs text-muted-foreground">
                        {provider.models.length} models available
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider Config */}
          {selectedProvider && selectedProviderInfo && (
            <>
              <div>
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    selectedProvider === 'openai'
                      ? 'sk-...'
                      : selectedProvider === 'anthropic'
                        ? 'sk-ant-...'
                        : 'Your API key'
                  }
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedProvider === 'openai' && (
                    <>Get your API key from the <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI dashboard</a></>
                  )}
                  {selectedProvider === 'anthropic' && (
                    <>Get your API key from the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Anthropic console</a></>
                  )}
                  {selectedProvider === 'google' && (
                    <>Get your API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google AI Studio</a></>
                  )}
                </p>
              </div>

              <div>
                <Label htmlFor="default-model">Default Model</Label>
                <div className="mt-1">
                  <ModelSelector
                    value={defaultModel}
                    onChange={setDefaultModel}
                    suggestedModels={modelOptions}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isLoadingModels
                    ? 'Fetching available models for this key…'
                    : liveModels
                      ? 'Showing models available to this API key. You can also type any model ID.'
                      : 'Choose a suggested model or type any model ID. Can be overridden per-pipeline.'}
                </p>
              </div>

              {/* Only show checkbox when adding additional providers */}
              {!isFirstProvider && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is-default"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="is-default" className="text-sm font-normal">
                    Set as default provider
                  </Label>
                </div>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedProvider || !apiKey.trim() || isAdding}
          >
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Provider'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectAISettingsTabProps {
  project: Project;
}

export function ProjectAISettingsTab({ project }: ProjectAISettingsTabProps) {
  const { data: aiStatus, isLoading: isLoadingStatus } = useGetProjectAIStatusQuery(project.id);
  const { data: providersData } = useGetAvailableAIProvidersQuery(project.id);
  const [addProvider, { isLoading: isAdding }] = useAddProjectAIProviderMutation();
  const [removeProvider] = useRemoveProjectAIProviderMutation();
  const [setDefaultProvider] = useSetProjectDefaultAIProviderMutation();
  const [testAI] = useTestProjectAIMutation();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingProvider, setRemovingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; latencyMs?: number }>>({});

  // Filter out already configured providers
  const availableToAdd = useMemo(() => {
    if (!providersData?.providers) return [];
    const configuredIds = new Set(aiStatus?.providers?.map((p) => p.provider) || []);
    return providersData.providers.filter((p) => !configuredIds.has(p.provider));
  }, [providersData, aiStatus]);

  const handleAddProvider = async (
    provider: AIProviderType,
    apiKey: string,
    defaultModel: string,
    isDefault: boolean
  ) => {
    try {
      setAddError(null);
      await addProvider({
        projectId: project.id,
        dto: {
          provider,
          config: {
            apiKey,
            defaultModel: defaultModel || undefined,
          },
          isDefault,
        },
      }).unwrap();
      setShowAddDialog(false);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setAddError(err.data?.message || 'Failed to add provider');
    }
  };

  const handleRemoveProvider = async (provider: string) => {
    try {
      setRemovingProvider(provider);
      await removeProvider({
        projectId: project.id,
        provider: provider as AIProviderType,
      }).unwrap();
    } catch (error) {
      console.error('Failed to remove provider:', error);
    } finally {
      setRemovingProvider(null);
    }
  };

  const handleSetDefault = async (provider: string) => {
    try {
      await setDefaultProvider({
        projectId: project.id,
        provider: provider as AIProviderType,
      }).unwrap();
    } catch (error) {
      console.error('Failed to set default provider:', error);
    }
  };

  const handleTestProvider = async (provider: string) => {
    try {
      setTestingProvider(provider);
      setTestResults((prev) => ({ ...prev, [provider]: undefined as unknown as { success: boolean; message: string } }));
      const result = await testAI({
        projectId: project.id,
        provider: provider as AIProviderType,
      }).unwrap();
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          success: result.success,
          message: result.message || (result.success ? 'Connection successful' : 'Connection failed'),
        },
      }));
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          success: false,
          message: err.data?.message || 'Test failed',
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  if (isLoadingStatus) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Settings
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

  const configuredProviders = aiStatus?.providers || [];
  const hasProviders = configuredProviders.length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Settings
              </CardTitle>
              <CardDescription>
                Configure AI providers for chat pipelines in this project.
              </CardDescription>
            </div>
            {availableToAdd.length > 0 && (
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasProviders ? (
            <div className="space-y-3">
              <div className="flex items-center text-sm mb-4">
                <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                <span className="text-muted-foreground">
                  {configuredProviders.length} provider{configuredProviders.length > 1 ? 's' : ''} configured
                </span>
              </div>
              {configuredProviders.map((provider) => (
                <ProviderCard
                  key={provider.provider}
                  provider={provider}
                  onRemove={() => handleRemoveProvider(provider.provider)}
                  onSetDefault={() => handleSetDefault(provider.provider)}
                  onTest={() => handleTestProvider(provider.provider)}
                  isRemoving={removingProvider === provider.provider}
                  isTesting={testingProvider === provider.provider}
                  testResult={testResults[provider.provider]}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
                <span className="text-muted-foreground">No AI providers configured</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Add an AI provider to enable chat pipelines and AI-powered features for this project.
              </p>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectAIPluginsSection project={project} />

      <ProjectAIServicesSection project={project} />

      <ProjectSecretsSection project={project} />

      <AddProviderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        projectId={project.id}
        availableProviders={availableToAdd}
        onAdd={handleAddProvider}
        isAdding={isAdding}
        error={addError}
        isFirstProvider={!hasProviders}
      />
    </div>
  );
}
