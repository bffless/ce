import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  Database,
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
import type { PreviousStep } from './AvailableVariables';
import { ExpressionInput } from './ExpressionInput';
import { SchemaPicker } from './SchemaPicker';
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
  previousSteps?: PreviousStep[];
}

export function AIHandlerConfig({ config, onChange, projectId, previousSteps = [] }: AIHandlerConfigProps) {
  const { data: aiStatus, isLoading: isLoadingAI } = useGetProjectAIStatusQuery(projectId);

  // Use ref to store onChange to avoid useEffect re-triggering on callback changes
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
  const [messagesField, setMessagesField] = useState(config.messagesField || 'request.body.messages');
  const [maxHistoryMessages, setMaxHistoryMessages] = useState(config.maxHistoryMessages ?? 50);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens ?? 4096);
  const [temperature, setTemperature] = useState(config.temperature ?? 0.7);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  // Message persistence state (simplified - uses smart defaults)
  const [persistMessages, setPersistMessages] = useState(config.persistMessages ?? false);
  const [persistMessagesSchemaId, setPersistMessagesSchemaId] = useState(config.persistMessagesSchemaId || '');
  const [persistConversationsSchemaId, setPersistConversationsSchemaId] = useState(config.persistConversationsSchemaId || '');
  const [conversationIdField, setConversationIdField] = useState(config.conversationIdField || 'request.body.id');
  const [showPersistence, setShowPersistence] = useState(config.persistMessages ?? false);

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
    const shouldPersist = persistMessages && mode === 'chat' && responseMode === 'stream';
    onChangeRef.current({
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
      // Message persistence (simplified - backend uses smart defaults)
      persistMessages: shouldPersist ? true : undefined,
      persistMessagesSchemaId: shouldPersist && persistMessagesSchemaId ? persistMessagesSchemaId : undefined,
      persistConversationsSchemaId: shouldPersist && persistConversationsSchemaId ? persistConversationsSchemaId : undefined,
      conversationIdField: shouldPersist && conversationIdField !== 'request.body.id' ? conversationIdField : undefined,
    });
  }, [mode, provider, model, responseMode, systemPrompt, messageField, messagesField, maxHistoryMessages, maxTokens, temperature, persistMessages, persistMessagesSchemaId, persistConversationsSchemaId, conversationIdField]);

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
                  <p>Expression for the messages array. For useChat, use <code>request.body.messages</code>.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <ExpressionInput
              value={messagesField}
              onChange={setMessagesField}
              placeholder="request.body.messages"
              previousSteps={previousSteps}
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
          {mode === 'chat' && responseMode === 'stream' && (
            <Alert className="mt-2 border-purple-500/30 bg-purple-500/5">
              <MessageSquare className="h-4 w-4 text-purple-600" />
              <AlertDescription className="text-xs">
                <strong>This step becomes the terminal response.</strong> Chat streaming sends the response directly to the client
                using the AI SDK protocol, compatible with <code className="bg-muted px-1 rounded">useChat</code>.
                Ensure this is the last step in your pipeline.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Message Persistence (Chat + Stream mode only) */}
        {mode === 'chat' && responseMode === 'stream' && (
          <Collapsible open={showPersistence} onOpenChange={setShowPersistence}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Message Persistence
                  {persistMessages && <Badge variant="secondary" className="text-xs">Enabled</Badge>}
                </span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', showPersistence && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* Enable Persistence Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="persist-messages">Save messages to schema</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically save user messages and AI responses
                  </p>
                </div>
                <Switch
                  id="persist-messages"
                  checked={persistMessages}
                  onCheckedChange={setPersistMessages}
                />
              </div>

              {persistMessages && (
                <>
                  {/* Conversations Schema */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Conversations Schema</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="cursor-help">
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Select a <code>_conversations</code> schema. Conversations are auto-created on first message.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <SchemaPicker
                      projectId={projectId}
                      value={persistConversationsSchemaId}
                      onChange={setPersistConversationsSchemaId}
                    />
                  </div>

                  {/* Messages Schema */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Messages Schema</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="cursor-help">
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Select a <code>_messages</code> schema for storing chat messages.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <SchemaPicker
                      projectId={projectId}
                      value={persistMessagesSchemaId}
                      onChange={setPersistMessagesSchemaId}
                    />
                  </div>

                  {/* Conversation ID Field */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Conversation ID Field</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="cursor-help">
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>useChat sends conversation ID as <code>id</code> in the request body.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <ExpressionInput
                      value={conversationIdField}
                      onChange={setConversationIdField}
                      placeholder="request.body.id"
                      previousSteps={previousSteps}
                    />
                  </div>

                  {/* Info about auto-behavior and required fields */}
                  <Alert className="border-blue-500/30 bg-blue-500/5">
                    <Database className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-xs space-y-2">
                      <p><strong>Auto-managed:</strong> Conversations are created on first message. Messages are saved automatically and conversation counters are updated.</p>
                      <div className="mt-2 space-y-1.5">
                        <p className="font-medium">Required schema fields:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="font-medium text-blue-700">Conversations:</p>
                            <ul className="list-disc list-inside text-muted-foreground">
                              <li><code className="bg-muted px-1 rounded">chat_id</code> (string)</li>
                              <li><code className="bg-muted px-1 rounded">model</code> (string)</li>
                              <li><code className="bg-muted px-1 rounded">message_count</code> (number)</li>
                              <li><code className="bg-muted px-1 rounded">total_tokens</code> (number)</li>
                            </ul>
                          </div>
                          <div>
                            <p className="font-medium text-blue-700">Messages:</p>
                            <ul className="list-disc list-inside text-muted-foreground">
                              <li><code className="bg-muted px-1 rounded">conversation_id</code> (string)</li>
                              <li><code className="bg-muted px-1 rounded">role</code> (string)</li>
                              <li><code className="bg-muted px-1 rounded">content</code> (text)</li>
                              <li><code className="bg-muted px-1 rounded">tokens_used</code> (number)</li>
                            </ul>
                          </div>
                        </div>
                        <p className="text-muted-foreground pt-1">
                          Tip: Use <strong>Create Chat Schema</strong> in Data Schemas to auto-generate compatible schemas.
                        </p>
                      </div>
                    </AlertDescription>
                  </Alert>
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

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
