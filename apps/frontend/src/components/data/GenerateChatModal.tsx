import { useState, useEffect, lazy, Suspense } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useGenerateChatSchemaMutation } from '@/services/pipelineSchemasApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';
import { useGetProjectAIStatusQuery, ConfiguredProvider, ModelInfo } from '@/services/projectsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Bot, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

// Lazy load Monaco Editor
const Editor = lazy(() => import('@monaco-editor/react'));

export type ChatScope = 'user' | 'guest';

interface GenerateChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant. Be concise and friendly in your responses.`;

/**
 * Modal for generating a chat schema with AI-powered conversation pipelines.
 * Creates conversation and message schemas with CRUD + AI chat pipelines.
 */
export function GenerateChatModal({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: GenerateChatModalProps) {
  const { toast } = useToast();
  const [schemaName, setSchemaName] = useState('');
  const [scope, setScope] = useState<ChatScope>('user');
  const [ruleSetId, setRuleSetId] = useState<string>('');
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  const [generateChatSchema, { isLoading }] = useGenerateChatSchemaMutation();
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(projectId, {
    skip: !open,
  });
  const { data: aiStatus } = useGetProjectAIStatusQuery(projectId, { skip: !open });

  // Get available models for selected provider from configured providers
  const selectedProvider = aiStatus?.providers?.find((p: ConfiguredProvider) => p.provider === provider);
  const availableModels: ModelInfo[] = selectedProvider?.models || [];

  // Initialize provider/model from AI settings (default provider)
  useEffect(() => {
    if (aiStatus?.hasAIConfigured && aiStatus.providers?.length > 0) {
      const defaultProvider = aiStatus.providers.find((p: ConfiguredProvider) => p.isDefault) || aiStatus.providers[0];
      if (defaultProvider && !provider) {
        setProvider(defaultProvider.provider);
        if (defaultProvider.defaultModel) {
          setModel(defaultProvider.defaultModel);
        } else if (defaultProvider.models?.length > 0) {
          setModel(defaultProvider.models[0].id);
        }
      }
    }
  }, [aiStatus, provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!schemaName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a schema name',
        variant: 'destructive',
      });
      return;
    }

    // Validate schema name format (lowercase, underscores, numbers)
    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(schemaName)) {
      toast({
        title: 'Invalid Schema Name',
        description:
          'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
        variant: 'destructive',
      });
      return;
    }

    if (!aiStatus?.hasAIConfigured) {
      toast({
        title: 'AI Not Configured',
        description: 'Please configure an AI provider in Site Settings first',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await generateChatSchema({
        projectId,
        name: schemaName,
        scope,
        provider: provider,
        model: model || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        ...(ruleSetId && ruleSetId !== 'new' ? { ruleSetId } : {}),
      }).unwrap();

      toast({
        title: 'Chat Schema Generated',
        description: `Created schemas "${result.conversationsSchema.name}" and "${result.messagesSchema.name}" with ${result.pipelines.length} pipeline(s)`,
      });

      onOpenChange(false);
      resetForm();
      onSuccess?.();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to generate chat schema';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setSchemaName('');
    setScope('user');
    setRuleSetId('');
    // Reset to default provider
    if (aiStatus?.hasAIConfigured && aiStatus.providers?.length > 0) {
      const defaultProvider = aiStatus.providers.find((p: ConfiguredProvider) => p.isDefault) || aiStatus.providers[0];
      setProvider(defaultProvider.provider);
      setModel(defaultProvider.defaultModel || defaultProvider.models?.[0]?.id || '');
    } else {
      setProvider('');
      setModel('');
    }
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Generate Chat Schema
          </DialogTitle>
          <DialogDescription>
            Create conversation and message schemas with AI-powered chat pipelines.
            This will generate endpoints for managing chat conversations with AI responses.
          </DialogDescription>
        </DialogHeader>

        {/* AI Configuration Warning */}
        {!aiStatus?.hasAIConfigured && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>AI provider not configured. Configure it in Site Settings first.</span>
              <Link to="/admin/settings">
                <Button variant="outline" size="sm" className="ml-2">
                  <Settings className="h-4 w-4 mr-1" />
                  Settings
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="schema-name">Chat Name</Label>
              <Input
                id="schema-name"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value.toLowerCase())}
                placeholder="e.g., support, assistant, helpdesk"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                This will create <code>{schemaName || 'name'}_conversations</code> and{' '}
                <code>{schemaName || 'name'}_messages</code> schemas.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Scope</Label>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as ChatScope)}
                disabled={isLoading}
              >
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="user" id="scope-user" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="scope-user" className="font-medium cursor-pointer">
                      User-scoped
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Conversations are isolated per authenticated user.
                      Requires authentication to access.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="guest" id="scope-guest" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="scope-guest" className="font-medium cursor-pointer">
                      Guest-scoped
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Conversations use guest ID (anonymous).
                      Can be upgraded to user when authenticated.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

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
                      setModel(newProvider.defaultModel || newProvider.models?.[0]?.id || '');
                    }
                  }}
                  disabled={isLoading || !aiStatus?.hasAIConfigured}
                >
                  <SelectTrigger id="provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {aiStatus?.providers?.map((p: ConfiguredProvider) => (
                      <SelectItem key={p.provider} value={p.provider}>
                        {p.provider}
                        {p.isDefault && ' (Default)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Select
                  value={model}
                  onValueChange={setModel}
                  disabled={isLoading || !aiStatus?.hasAIConfigured || !provider}
                >
                  <SelectTrigger id="model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m: ModelInfo) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.tier})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="system-prompt">System Prompt</Label>
              <div className="border rounded-md overflow-hidden">
                <Suspense fallback={<Skeleton className="h-[150px] w-full" />}>
                  <Editor
                    height="150px"
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
              <p className="text-xs text-muted-foreground">
                Instructions for the AI assistant. Can be overridden per conversation.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-set">Proxy Rule Set</Label>
              <Select
                value={ruleSetId}
                onValueChange={setRuleSetId}
                disabled={isLoading}
              >
                <SelectTrigger id="rule-set">
                  <SelectValue placeholder="Create new rule set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new rule set</SelectItem>
                  {ruleSetsData?.ruleSets?.map((ruleSet) => (
                    <SelectItem key={ruleSet.id} value={ruleSet.id}>
                      {ruleSet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Add the 5 chat pipelines to an existing rule set or create a new one.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !aiStatus?.hasAIConfigured}>
              {isLoading ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
