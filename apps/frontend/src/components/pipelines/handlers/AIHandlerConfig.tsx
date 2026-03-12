import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  HelpCircle,
  ChevronDown,
  Bot,
  Zap,
  DollarSign,
  Brain,
  ChevronsUpDown,
  Check,
  AlertTriangle,
  MessageSquare,
  FileText,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useGetProjectAIStatusQuery, ConfiguredProvider } from '@/services/projectsApi';
import type { AIHandlerConfig as AIHandlerConfigType, ModelTier, ModelInfo } from './types';
import { cn } from '@/lib/utils';

// Lazy load Monaco Editor
const Editor = lazy(() => import('@monaco-editor/react'));

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Be concise and friendly in your responses.';

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

interface AIHandlerConfigProps {
  config: Partial<AIHandlerConfigType>;
  onChange: (config: AIHandlerConfigType) => void;
  projectId: string;
}

export function AIHandlerConfig({ config, onChange, projectId }: AIHandlerConfigProps) {
  const { data: aiStatus, isLoading: isLoadingAI } = useGetProjectAIStatusQuery(projectId);

  // Find default provider from configured providers
  const defaultProvider = aiStatus?.providers?.find((p: ConfiguredProvider) => p.isDefault) || aiStatus?.providers?.[0];

  const [mode, setMode] = useState<'chat' | 'completion'>(config.mode || 'completion');
  const [provider, setProvider] = useState(config.provider || '');
  const [model, setModel] = useState(config.model || '');
  const [responseMode, setResponseMode] = useState<'stream' | 'message'>(
    config.responseMode || (config.mode === 'chat' ? 'stream' : 'message')
  );
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  const [messageField, setMessageField] = useState(config.messageField || 'message');
  const [messagesField, setMessagesField] = useState(config.messagesField || 'messages');
  const [maxHistoryMessages, setMaxHistoryMessages] = useState(config.maxHistoryMessages ?? 50);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens ?? 4096);
  const [temperature, setTemperature] = useState(config.temperature ?? 0.7);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  // Initialize provider/model from AI status
  useEffect(() => {
    if (defaultProvider && !provider) {
      setProvider(defaultProvider.provider);
      if (!model && defaultProvider.defaultModel) {
        setModel(defaultProvider.defaultModel);
      } else if (!model && defaultProvider.suggestedModels?.length > 0) {
        setModel(defaultProvider.suggestedModels[0].id);
      }
    }
  }, [defaultProvider, provider, model]);

  // Update response mode default when mode changes
  useEffect(() => {
    if (mode === 'chat' && responseMode === 'message') {
      setResponseMode('stream');
    } else if (mode === 'completion' && responseMode === 'stream') {
      setResponseMode('message');
    }
  }, [mode]);

  // Get selected provider info
  const selectedProvider = aiStatus?.providers?.find((p: ConfiguredProvider) => p.provider === provider);
  const suggestedModels: ModelInfo[] = selectedProvider?.suggestedModels || [];

  // Group models by tier
  const groupedModels = useMemo(() => {
    const groups: Record<ModelTier, ModelInfo[]> = {
      premium: [],
      balanced: [],
      economy: [],
    };
    suggestedModels.forEach((m) => {
      groups[m.tier].push(m);
    });
    return groups;
  }, [suggestedModels]);

  // Update parent when values change
  useEffect(() => {
    onChange({
      mode,
      provider: provider as 'openai' | 'anthropic' | 'google' | undefined,
      model: model || undefined,
      responseMode,
      systemPrompt: systemPrompt.trim() || undefined,
      messageField: mode === 'completion' ? (messageField || 'message') : undefined,
      messagesField: mode === 'chat' ? (messagesField || 'messages') : undefined,
      maxHistoryMessages,
      maxTokens,
      temperature,
    });
  }, [mode, provider, model, responseMode, systemPrompt, messageField, messagesField, maxHistoryMessages, maxTokens, temperature, onChange]);

  // Find selected model info
  const selectedModelInfo = suggestedModels.find(m => m.id === model);

  if (isLoadingAI) {
    return <Skeleton className="h-[200px] w-full" />;
  }

  if (!aiStatus?.hasAIConfigured) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No AI providers configured for this project. Please configure an AI provider in Project Settings &gt; AI.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Mode Selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Mode</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p><strong>Chat:</strong> For useChat integration. Client sends message history, handler streams response.</p>
                <p className="mt-1"><strong>Completion:</strong> One-off AI processing. Configure message template for form processing, content generation, etc.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'completion' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('completion')}
              className="flex-1"
            >
              <FileText className="h-4 w-4 mr-2" />
              Completion
            </Button>
            <Button
              type="button"
              variant={mode === 'chat' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('chat')}
              className="flex-1"
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Chat
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'chat'
              ? 'For chat interfaces using useChat. Client sends messages array, handler manages conversation.'
              : 'For one-off AI processing. Configure a message template to process form data, generate content, etc.'}
          </p>
        </div>

        {/* Provider and Model Selection */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="provider">AI Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => {
                setProvider(value);
                // Reset model when provider changes
                const newProvider = aiStatus?.providers?.find((p: ConfiguredProvider) => p.provider === value);
                if (newProvider) {
                  setModel(newProvider.defaultModel || newProvider.suggestedModels?.[0]?.id || '');
                }
              }}
            >
              <SelectTrigger id="provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {aiStatus?.providers?.map((p: ConfiguredProvider) => (
                  <SelectItem key={p.provider} value={p.provider}>
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      {p.provider}
                      {p.isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Popover open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  {model ? (
                    <span className="flex items-center gap-2 truncate">
                      <span className="font-mono text-sm truncate">{model}</span>
                      {selectedModelInfo && <TierBadge tier={selectedModelInfo.tier} />}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select model...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[350px] p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search or type model ID..."
                    value={model}
                    onValueChange={setModel}
                  />
                  <CommandList>
                    <CommandEmpty>
                      <div className="py-2 text-sm text-muted-foreground">
                        Using: <span className="font-mono">{model}</span>
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
                              {tierConfig.label}
                            </span>
                          }
                        >
                          {models.map((m) => (
                            <CommandItem
                              key={m.id}
                              value={m.id}
                              onSelect={() => {
                                setModel(m.id);
                                setModelSelectorOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  model === m.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <div className="flex flex-col">
                                <span className="font-mono text-sm">{m.id}</span>
                                <span className="text-xs text-muted-foreground">{m.description}</span>
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
          </div>
        </div>

        {/* System Prompt */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>System Prompt</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Instructions for the AI. Configured server-side for security.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="border rounded-md overflow-hidden">
            <Suspense fallback={<Skeleton className="h-[120px] w-full" />}>
              <Editor
                height="120px"
                defaultLanguage="markdown"
                value={systemPrompt}
                onChange={(value) => setSystemPrompt(value || '')}
                options={{
                  minimap: { enabled: false },
                  lineNumbers: 'off',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  fontSize: 13,
                  tabSize: 2,
                  padding: { top: 8, bottom: 8 },
                  renderLineHighlight: 'none',
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  overviewRulerBorder: false,
                  scrollbar: {
                    vertical: 'auto',
                    horizontal: 'hidden',
                  },
                }}
                theme="vs-dark"
              />
            </Suspense>
          </div>
        </div>

        {/* Mode-specific configuration */}
        {mode === 'completion' ? (
          /* Completion Mode: Message Template */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="messageField">Message</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="cursor-help">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>The message to send to the AI. Use template variables like <code>{'{{steps.form.message}}'}</code> to include data from previous steps.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="border rounded-md overflow-hidden">
              <Suspense fallback={<Skeleton className="h-[80px] w-full" />}>
                <Editor
                  height="80px"
                  defaultLanguage="handlebars"
                  value={messageField}
                  onChange={(value) => setMessageField(value || '')}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: 'off',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    fontSize: 13,
                    tabSize: 2,
                    padding: { top: 8, bottom: 8 },
                    renderLineHighlight: 'none',
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    scrollbar: {
                      vertical: 'auto',
                      horizontal: 'hidden',
                    },
                  }}
                  theme="vs-dark"
                />
              </Suspense>
            </div>
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">{'{{variable}}'}</code> syntax for template variables (e.g., <code className="bg-muted px-1 rounded">{'{{steps.form.name}}'}</code>)
            </p>
          </div>
        ) : (
          /* Chat Mode: Messages Field */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="messagesField">Messages Field</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="cursor-help">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Field in request body containing the conversation history. For useChat, this is typically <code>messages</code>.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="messagesField"
              value={messagesField}
              onChange={(e) => setMessagesField(e.target.value)}
              placeholder="messages"
            />
            <p className="text-xs text-muted-foreground">
              Expected format: Array of <code className="bg-muted px-1 rounded">{'{role, content}'}</code> objects from useChat
            </p>
          </div>
        )}

        {/* Response Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Response Format</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p><strong>Stream:</strong> Returns Server-Sent Events for real-time UIs</p>
                <p className="mt-1"><strong>Message:</strong> Returns complete JSON response</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={responseMode === 'message' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setResponseMode('message')}
              className="flex-1"
            >
              JSON
            </Button>
            <Button
              type="button"
              variant={responseMode === 'stream' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setResponseMode('stream')}
              className="flex-1"
            >
              Stream (SSE)
            </Button>
          </div>
        </div>

        {/* Advanced Options */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              Advanced Options
              <ChevronDown className={cn('h-4 w-4 transition-transform', showAdvanced && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            {/* Max History Messages (Chat mode) */}
            {mode === 'chat' && (
              <div className="space-y-2">
                <Label htmlFor="maxHistoryMessages">Max History Messages</Label>
                <Input
                  id="maxHistoryMessages"
                  type="number"
                  value={maxHistoryMessages}
                  onChange={(e) => setMaxHistoryMessages(Number(e.target.value) || 50)}
                  min={0}
                  max={200}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum messages from history to include (older messages are trimmed)
                </p>
              </div>
            )}

            {/* Max Tokens */}
            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value) || 4096)}
                min={256}
                max={100000}
              />
            </div>

            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>0 = deterministic, 2 = most creative</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="temperature"
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value) || 0.7)}
                min={0}
                max={2}
                step={0.1}
              />
              <p className="text-xs text-muted-foreground">
                Lower = more focused, higher = more creative
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </TooltipProvider>
  );
}
