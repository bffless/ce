import { useState, useCallback, useMemo, useRef, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, Trash2, Send, Info, Filter } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { HandlerType, ValidatorConfig } from '@/services/pipelinesApi';
import { useGetCurrentStorageConfigQuery } from '@/services/setupApi';
import { useGetProjectSecretsQuery } from '@/services/projectsApi';
import { SecretNamesProvider } from './SecretsContext';
import type {
  PipelineStepConfig,
  PipelineConfig as PipelineConfigType,
} from '@/services/proxyRulesApi';
import {
  HandlerConfigWrapper,
  getHandlerDisplayName,
  getHandlerDescription,
  ResponseHandlerConfig,
  ProxyForwardConfig,
} from './handlers';
import { AvailableVariables, type PreviousStep } from './handlers/AvailableVariables';
import { ExpressionInput } from './handlers/ExpressionInput';
import type { ResponseHandlerConfig as ResponseConfig, ProxyForwardConfig as ProxyConfig } from './handlers/types';
import { ValidatorsConfig } from './ValidatorsConfig';

// Re-export types for convenience
export type PipelineStep = PipelineStepConfig;
export type PipelineConfigData = PipelineConfigType;

interface PipelineConfigProps {
  config: Partial<PipelineConfigData>;
  onChange: (config: PipelineConfigData) => void;
  projectId: string;
  /** Optional validators configuration */
  validators?: ValidatorConfig[];
  /** Callback when validators change (required if validators prop is provided) */
  onValidatorsChange?: (validators: ValidatorConfig[]) => void;
}

// Handler types grouped by category
const HANDLER_GROUPS: { label: string; types: HandlerType[] }[] = [
  { label: 'Input', types: ['form_handler'] },
  { label: 'Data', types: ['data_create', 'data_query', 'data_update', 'data_delete', 'data_upsert_many', 'db_aggregate'] },
  { label: 'Files', types: ['file_upload_handler', 'file_serve_handler', 'file_delete', 'image_convert_handler', 'ffmpeg_handler', 'signed_url', 'presigned_upload', 'register_upload'] },
  { label: 'AI & ML', types: ['ai_handler', 'replicate', 'embed_store', 'vector_search'] },
  { label: 'Payments', types: ['stripe_checkout', 'stripe_webhook'] },
  { label: 'Integrations', types: ['github_api', 'google_calendar'] },
  { label: 'Other', types: ['email_handler', 'function_handler', 'http_request', 'xml_feed_parse', 'delay'] },
];

function HandlerTypeSelectContent({
  unsupported,
}: {
  /** Map of handler type → reason it's disabled (e.g. storage backend can't presign) */
  unsupported?: Partial<Record<HandlerType, string>>;
}) {
  return (
    <>
      {HANDLER_GROUPS.map((group, i) => (
        <Fragment key={group.label}>
          {i > 0 && <SelectSeparator />}
          <SelectGroup>
            <SelectLabel className="text-xs text-muted-foreground font-semibold">{group.label}</SelectLabel>
            {group.types.map((type) => {
              const disabledReason = unsupported?.[type];
              return (
                <SelectItem key={type} value={type} className="py-1.5" disabled={!!disabledReason}>
                  <div>
                    <div className="font-medium">{getHandlerDisplayName(type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {disabledReason || getHandlerDescription(type)}
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </Fragment>
      ))}
    </>
  );
}

function generateId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** React key for a step card. Prefers the wire id so cards survive reorder; steps
 *  authored outside the UI have no id, so fall back to position. */
function stepKey(step: PipelineStep, index: number): string {
  return step.id ?? `idx-${index}`;
}

function toggleIndex(set: Set<number>, index: number): Set<number> {
  const next = new Set(set);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** Drop `index`, shifting everything after it down one so expansion stays with its step. */
function removeIndex(set: Set<number>, index: number): Set<number> {
  const next = new Set<number>();
  set.forEach((i) => {
    if (i < index) next.add(i);
    else if (i > index) next.add(i - 1);
  });
  return next;
}

/** Swap membership of two positions so an expanded step stays expanded when moved. */
function swapIndexes(set: Set<number>, a: number, b: number): Set<number> {
  const next = new Set(set);
  const hadA = set.has(a);
  const hadB = set.has(b);
  next.delete(a);
  next.delete(b);
  if (hadA) next.add(b);
  if (hadB) next.add(a);
  return next;
}

// Terminal step types
type TerminalStepType = 'none' | 'response' | 'proxy';

/** Handler types that produce the HTTP response and end the pipeline. */
function isTerminalHandler(step: PipelineStep): boolean {
  return step.handlerType === 'response_handler' || step.handlerType === 'proxy_forward';
}

/**
 * PipelineConfig - Full pipeline editor component.
 * Allows adding, removing, and reordering steps with their handler configs.
 * Terminal steps (response/proxy) are handled separately at the end.
 *
 * Pipeline configuration is embedded in proxy rules. Testing is done
 * via the proxy rule test endpoint (proxyRulesApi.testProxyRule).
 */
export function PipelineConfig({
  config,
  onChange,
  projectId,
  validators,
  onValidatorsChange,
}: PipelineConfigProps) {
  // Keyed by position, not step.id: `id` is optional on the wire (steps authored
  // via the CLI or imported JSON have none), so an id-keyed Set collapses every
  // id-less step onto the same `undefined` entry.
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [expandedPostSteps, setExpandedPostSteps] = useState<Set<number>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deletePostConfirm, setDeletePostConfirm] = useState<number | null>(null);
  const [deleteTerminalConfirm, setDeleteTerminalConfirm] = useState<number | null>(null);
  const [expandedTerminalSteps, setExpandedTerminalSteps] = useState<Set<number>>(new Set());

  // Direct-to-bucket uploads (presigned_upload) only work on object storage,
  // not local. Disable the option in the picker when storage can't presign.
  const { data: storageConfig } = useGetCurrentStorageConfigQuery();
  const { data: secretsData } = useGetProjectSecretsQuery(projectId, { skip: !projectId });
  const secretNames = useMemo(
    () => (secretsData?.secrets || []).map((s) => s.name),
    [secretsData],
  );
  const storageProvider = storageConfig?.storageProvider?.toLowerCase();
  const supportsPresignedUploads = !!storageProvider && storageProvider !== 'local';
  const unsupportedHandlers: Partial<Record<HandlerType, string>> = supportsPresignedUploads
    ? {}
    : { presigned_upload: 'Requires S3, GCS, MinIO, or Azure storage (not local)' };

  // The trailing contiguous run of response/proxy steps forms the terminal
  // branches; each may carry a `condition` so the pipeline can answer
  // differently per outcome (e.g. 503 when a fetch failed, 200 otherwise).
  // A terminal-type step sitting before a non-terminal step is not part of the
  // run and stays in the regular list so it remains visible and editable.
  const allSteps = config.steps || [];
  let splitIndex = allSteps.length;
  while (splitIndex > 0 && isTerminalHandler(allSteps[splitIndex - 1])) splitIndex--;
  const steps = allSteps.slice(0, splitIndex);
  const terminalSteps = allSteps.slice(splitIndex);
  const terminalStep = terminalSteps[0];

  // Post-processing steps
  const postSteps = config.postSteps || [];

  // Terminal type drives the single-branch dropdown; with 2+ branches the
  // dropdown is hidden, so it only needs to reflect the first branch.
  const terminalStepType: TerminalStepType = terminalStep
    ? terminalStep.handlerType === 'proxy_forward'
      ? 'proxy'
      : 'response'
    : 'none';

  const name = config.name || '';
  const description = config.description || '';

  // Latest values for the stable branch-edit callbacks below. Handler config
  // editors emit onChange from a mount-time effect that depends on the
  // callback's identity, so those callbacks must not be recreated per render.
  const latest = useRef({ name, description, steps, terminalSteps, postSteps, onChange });
  latest.current = { name, description, steps, terminalSteps, postSteps, onChange };

  const updateConfig = useCallback(
    (updates: Partial<PipelineConfigData>) => {
      const combine = (regularSteps: PipelineStep[]) => [...regularSteps, ...terminalSteps];

      onChange({
        name,
        description,
        steps: combine(updates.steps !== undefined ? updates.steps : steps),
        postSteps,
        ...updates,
        // Make sure steps is always the combined value
        ...(updates.steps !== undefined ? { steps: combine(updates.steps) } : {}),
      });
    },
    [name, description, steps, postSteps, terminalSteps, onChange],
  );

  // Change terminal step type (single-branch mode only — the dropdown is
  // hidden once there are multiple branches)
  const setTerminalType = useCallback(
    (type: TerminalStepType) => {
      if (type === 'none') {
        // Remove terminal step
        onChange({
          name,
          description,
          steps: steps,
          postSteps,
        });
        setExpandedTerminalSteps(new Set());
      } else if (type === 'response') {
        // Add or replace with response_handler
        const newTerminalStep: PipelineStep = {
          id: terminalStep?.id || generateId(),
          name: terminalStep?.name || 'http_response',
          handlerType: 'response_handler',
          config: {
            status: 200,
            body: '',
            contentType: 'application/json',
          },
          isEnabled: true,
        };
        onChange({
          name,
          description,
          steps: [...steps, newTerminalStep],
          postSteps,
        });
        setExpandedTerminalSteps(new Set([0]));
      } else if (type === 'proxy') {
        // Add or replace with proxy_forward
        const newTerminalStep: PipelineStep = {
          id: terminalStep?.id || generateId(),
          name: terminalStep?.name || 'proxy_forward',
          handlerType: 'proxy_forward',
          config: {
            targetUrl: '',
            includeBody: true,
            includeOriginalHeaders: true,
            timeout: 30000,
          },
          isEnabled: true,
        };
        onChange({
          name,
          description,
          steps: [...steps, newTerminalStep],
          postSteps,
        });
        setExpandedTerminalSteps(new Set([0]));
      }
    },
    [name, description, steps, postSteps, terminalStep, onChange],
  );

  const updateTerminalStep = useCallback((index: number, updates: Partial<PipelineStep>) => {
    const { name, description, steps, terminalSteps, postSteps, onChange } = latest.current;
    onChange({
      name,
      description,
      steps: [
        ...steps,
        ...terminalSteps.map((s, i) => (i === index ? { ...s, ...updates } : s)),
      ],
      postSteps,
    });
  }, []);

  // Update a branch's handler config, preserving its run condition — the
  // response/proxy editors emit only the fields they own.
  const updateTerminalConfig = useCallback(
    (index: number, newConfig: ResponseConfig | ProxyConfig) => {
      const branch = latest.current.terminalSteps[index];
      if (!branch) return;
      const currentCondition = (branch.config as Record<string, unknown>)?.condition;
      updateTerminalStep(index, {
        config: (currentCondition
          ? { ...newConfig, condition: currentCondition }
          : newConfig) as unknown as Record<string, unknown>,
      });
    },
    [updateTerminalStep],
  );

  // Stable per-branch onChange identities (see `latest` above). Depending on
  // branch count, not contents: the handlers read current state via `latest`,
  // and recreating them on every config change would refire the handler
  // editors' mount effects in a feedback loop.
  const terminalConfigHandlers = useMemo(
    () =>
      terminalSteps.map(
        (_, i) => (cfg: ResponseConfig | ProxyConfig) => updateTerminalConfig(i, cfg),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminalSteps.length, updateTerminalConfig],
  );

  const addTerminalBranch = useCallback(() => {
    const { name, description, steps, terminalSteps, postSteps, onChange } = latest.current;
    const newBranch: PipelineStep = {
      id: generateId(),
      name: generateStepName('response_handler', [...steps, ...terminalSteps, ...postSteps]),
      handlerType: 'response_handler',
      config: {
        status: 200,
        body: '',
        contentType: 'application/json',
      },
      isEnabled: true,
    };
    onChange({
      name,
      description,
      steps: [...steps, ...terminalSteps, newBranch],
      postSteps,
    });
    setExpandedTerminalSteps((prev) => new Set([...prev, terminalSteps.length]));
  }, []);

  const removeTerminalBranch = (index: number) => {
    onChange({
      name,
      description,
      steps: [...steps, ...terminalSteps.filter((_, i) => i !== index)],
      postSteps,
    });
    setExpandedTerminalSteps((prev) => removeIndex(prev, index));
    setDeleteTerminalConfirm(null);
  };

  const moveTerminalBranch = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= terminalSteps.length) return;

    const newTerminalSteps = [...terminalSteps];
    [newTerminalSteps[index], newTerminalSteps[newIndex]] = [newTerminalSteps[newIndex], newTerminalSteps[index]];
    onChange({
      name,
      description,
      steps: [...steps, ...newTerminalSteps],
      postSteps,
    });
    setExpandedTerminalSteps((prev) => swapIndexes(prev, index, newIndex));
  };

  const toggleTerminalExpanded = (index: number) => {
    setExpandedTerminalSteps((prev) => toggleIndex(prev, index));
  };

  // Calculate previous steps for response (all regular steps)
  const previousStepsForResponse: PreviousStep[] = useMemo(
    () =>
      steps.map((s) => ({
        name: s.name || getHandlerDisplayName(s.handlerType),
        handlerType: s.handlerType,
        config: s.config,
      })),
    [steps],
  );

  // Get last step name for default response preview
  const lastStepName = useMemo(() => {
    if (steps.length === 0) return 'input';
    const lastStep = steps[steps.length - 1];
    return lastStep.name || getHandlerDisplayName(lastStep.handlerType);
  }, [steps]);

  // Check if there's an AI step in chat mode with streaming (auto-terminal)
  const streamingAIStep = useMemo(() => {
    return steps.find((s) => {
      if (s.handlerType !== 'ai_handler') return false;
      const config = s.config as Record<string, unknown>;
      const mode = config?.mode || 'completion';
      const responseMode = config?.responseMode || (mode === 'chat' ? 'stream' : 'message');
      return mode === 'chat' && responseMode === 'stream';
    });
  }, [steps]);

  // AI chat streaming steps are implicitly terminal
  const hasImplicitTerminal = !!streamingAIStep;

  // Generate a unique step name based on handler type
  const generateStepName = (handlerType: HandlerType, existingSteps: PipelineStep[]) => {
    const baseName = getHandlerDisplayName(handlerType).toLowerCase().replace(/\s+/g, '_');
    const existingNames = new Set(existingSteps.map((s) => s.name));

    if (!existingNames.has(baseName)) return baseName;

    let counter = 2;
    while (existingNames.has(`${baseName}_${counter}`)) {
      counter++;
    }
    return `${baseName}_${counter}`;
  };

  const addStep = () => {
    const handlerType: HandlerType = 'form_handler';
    const newStep: PipelineStep = {
      id: generateId(),
      name: generateStepName(handlerType, steps),
      handlerType,
      config: {},
      isEnabled: true,
    };
    updateConfig({ steps: [...steps, newStep] });
    setExpandedSteps((prev) => new Set([...prev, steps.length]));
  };

  const removeStep = (index: number) => {
    updateConfig({ steps: steps.filter((_, i) => i !== index) });
    setExpandedSteps((prev) => removeIndex(prev, index));
    setDeleteConfirm(null);
  };

  const updateStep = (index: number, updates: Partial<PipelineStep>) => {
    updateConfig({
      steps: steps.map((s, i) => (i === index ? { ...s, ...updates } : s)),
    });
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    updateConfig({ steps: newSteps });
    setExpandedSteps((prev) => swapIndexes(prev, index, newIndex));
  };

  const toggleExpanded = (index: number) => {
    setExpandedSteps((prev) => toggleIndex(prev, index));
  };

  // Post-processing step management
  const addPostStep = () => {
    const handlerType: HandlerType = 'function_handler';
    const allExistingSteps = [...steps, ...postSteps];
    const newStep: PipelineStep = {
      id: generateId(),
      name: generateStepName(handlerType, allExistingSteps),
      handlerType,
      config: {},
      isEnabled: true,
    };
    updateConfig({ postSteps: [...postSteps, newStep] });
    setExpandedPostSteps((prev) => new Set([...prev, postSteps.length]));
  };

  const removePostStep = (index: number) => {
    updateConfig({ postSteps: postSteps.filter((_, i) => i !== index) });
    setExpandedPostSteps((prev) => removeIndex(prev, index));
    setDeletePostConfirm(null);
  };

  const updatePostStep = (index: number, updates: Partial<PipelineStep>) => {
    updateConfig({
      postSteps: postSteps.map((s, i) => (i === index ? { ...s, ...updates } : s)),
    });
  };

  const movePostStep = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= postSteps.length) return;

    const newPostSteps = [...postSteps];
    [newPostSteps[index], newPostSteps[newIndex]] = [newPostSteps[newIndex], newPostSteps[index]];
    updateConfig({ postSteps: newPostSteps });
    setExpandedPostSteps((prev) => swapIndexes(prev, index, newIndex));
  };

  const togglePostExpanded = (index: number) => {
    setExpandedPostSteps((prev) => toggleIndex(prev, index));
  };

  // Previous steps available for post-processing steps (all regular + terminal branches)
  const previousStepsForPost: PreviousStep[] = useMemo(
    () =>
      [...steps, ...terminalSteps].map((s) => ({
        name: s.name || getHandlerDisplayName(s.handlerType),
        handlerType: s.handlerType,
        config: s.config,
      })),
    [steps, terminalSteps],
  );

  return (
    <SecretNamesProvider secretNames={secretNames}>
    <div className="space-y-6">
      {/* Pipeline Metadata */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pipeline-name">Pipeline Name</Label>
          <Input
            id="pipeline-name"
            value={name}
            onChange={(e) => updateConfig({ name: e.target.value })}
            placeholder="Contact Form Handler"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pipeline-description">Description (optional)</Label>
          <Input
            id="pipeline-description"
            value={description}
            onChange={(e) => updateConfig({ description: e.target.value })}
            placeholder="Handles contact form submissions"
          />
        </div>
      </div>

      {/* Validators (only shown for standalone pipelines) */}
      {validators !== undefined && onValidatorsChange && (
        <ValidatorsConfig validators={validators} onChange={onValidatorsChange} />
      )}

      {/* Steps */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-base">Pipeline Steps</Label>
          <Button type="button" variant="outline" size="sm" onClick={addStep}>
            <Plus className="h-4 w-4 mr-1" />
            Add Step
          </Button>
        </div>

        {steps.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <p>No steps yet. Add a step to build your pipeline.</p>
              <Button type="button" variant="outline" size="sm" onClick={addStep} className="mt-4">
                <Plus className="h-4 w-4 mr-1" />
                Add First Step
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => {
              const isExpanded = expandedSteps.has(index);
              const key = stepKey(step, index);
              // Calculate previous steps for context
              const previousSteps = steps.slice(0, index).map((s) => ({
                name: s.name || getHandlerDisplayName(s.handlerType),
                handlerType: s.handlerType,
                config: s.config,
              }));
              return (
                <Card key={key} className={step.isEnabled === false ? 'opacity-60' : ''}>
                  <CardHeader className="py-3">
                    <div className="flex items-center gap-2">
                      {/* Drag handle placeholder */}
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />

                      {/* Step number */}
                      <Badge variant="secondary" className="font-mono">
                        {index + 1}
                      </Badge>

                      {/* Step info - clickable to expand/collapse */}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(index)}
                        className="min-w-0 flex-1 flex items-center gap-2 text-left hover:text-primary"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <CardTitle className="min-w-0 truncate text-sm font-medium">
                          {step.name || getHandlerDisplayName(step.handlerType)}
                        </CardTitle>
                        {/* Secondary handler-type hint loses to the step name on phones */}
                        <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                          {step.name && `(${getHandlerDisplayName(step.handlerType)})`}
                        </span>
                      </button>

                      {/* Move buttons */}
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === 0}
                          aria-label={`Move ${step.name || 'step'} up`}
                          onClick={() => moveStep(index, 'up')}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === steps.length - 1}
                          aria-label={`Move ${step.name || 'step'} down`}
                          onClick={() => moveStep(index, 'down')}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Enable/disable toggle */}
                      <Switch
                        checked={step.isEnabled !== false}
                        onCheckedChange={(checked) => updateStep(index, { isEnabled: checked })}
                      />

                      {/* Delete button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${step.name || 'step'}`}
                        onClick={() => setDeleteConfirm(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      {/* Step name */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`step-${key}-name`}>
                            Step Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`step-${key}-name`}
                            value={step.name || ''}
                            onChange={(e) => updateStep(index, { name: e.target.value })}
                            placeholder={getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_')}
                            className={!step.name ? 'border-destructive' : ''}
                          />
                          {!step.name && (
                            <p className="text-xs text-destructive">Required to reference step output in other steps</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`step-${key}-type`}>Handler Type</Label>
                          <Select
                            value={step.handlerType}
                            onValueChange={(v) => {
                              const newType = v as HandlerType;
                              const oldBaseName = getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_');
                              // Auto-update name if it matches the old auto-generated pattern
                              const isAutoGenerated = !step.name || step.name === oldBaseName || step.name.match(new RegExp(`^${oldBaseName}_\\d+$`));
                              updateStep(index, {
                                handlerType: newType,
                                config: {}, // Reset config when type changes
                                ...(isAutoGenerated ? { name: generateStepName(newType, steps.filter((_, i) => i !== index)) } : {}),
                              });
                            }}
                          >
                            <SelectTrigger id={`step-${key}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-[400px]">
                              <HandlerTypeSelectContent unsupported={unsupportedHandlers} />
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Run Condition (optional) */}
                      {index > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <Label htmlFor={`step-${key}-condition`}>
                              Run Condition <span className="text-muted-foreground font-normal">(optional)</span>
                            </Label>
                          </div>
                          <ExpressionInput
                            value={(step.config as Record<string, unknown>)?.condition as string || ''}
                            onChange={(value) => {
                              const currentConfig = (step.config || {}) as Record<string, unknown>;
                              updateStep(index, {
                                config: { ...currentConfig, condition: value || undefined },
                              });
                            }}
                            placeholder="e.g., steps.query or !steps.check_exists"
                            previousSteps={previousSteps}
                          />
                          <p className="text-xs text-muted-foreground">
                            Step only runs if this expression is truthy. Use to skip create when record exists, or skip update when it doesn't.
                          </p>
                        </div>
                      )}

                      {/* Handler-specific config */}
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <HandlerConfigWrapper
                          handlerType={step.handlerType}
                          config={step.config}
                          onChange={(newConfig) => {
                            // Preserve the condition field when handler config updates
                            const currentCondition = (step.config as Record<string, unknown>)?.condition;
                            updateStep(index, {
                              config: currentCondition
                                ? { ...newConfig, condition: currentCondition }
                                : newConfig,
                            });
                          }}
                          projectId={projectId}
                          previousSteps={previousSteps}
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Terminal Step Configuration */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base">
              {terminalSteps.length > 1 ? 'Terminal Branches' : 'Terminal Step'}
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!hasImplicitTerminal && terminalSteps.length <= 1 && (
              <Select
                value={terminalStepType}
                onValueChange={(v) => setTerminalType(v as TerminalStepType)}
              >
                <SelectTrigger className="w-[200px]" aria-label="Terminal step type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Default Response</SelectItem>
                  <SelectItem value="response">Custom HTTP Response</SelectItem>
                  <SelectItem value="proxy">Forward Request (Proxy)</SelectItem>
                </SelectContent>
              </Select>
            )}
            {!hasImplicitTerminal && terminalSteps.length >= 1 && (
              <Button type="button" variant="outline" size="sm" onClick={addTerminalBranch}>
                <Plus className="h-4 w-4 mr-1" />
                Add Branch
              </Button>
            )}
            {hasImplicitTerminal && (
              <Badge variant="secondary" className="text-xs">
                AI Chat (Streaming)
              </Badge>
            )}
          </div>
        </div>

        {terminalSteps.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              Branches run in order; the response comes from the last branch whose condition
              matches. A branch without a condition always matches.
            </span>
          </div>
        )}

        {terminalSteps.length >= 1 && (
          <div className="space-y-3">
            {terminalSteps.map((branch, index) => {
              const isProxy = branch.handlerType === 'proxy_forward';
              const isExpanded = expandedTerminalSteps.has(index);
              const key = stepKey(branch, index);
              const branchTitle =
                branch.name || (isProxy ? 'Forward Request' : 'HTTP Response');
              const condition = (branch.config as Record<string, unknown>)?.condition as
                | string
                | undefined;
              const showBranchControls = terminalSteps.length > 1;
              return (
                <Card
                  key={key}
                  className={isProxy ? 'border-blue-500/20 bg-blue-500/5' : 'border-primary/20 bg-primary/5'}
                >
                  <CardHeader className="py-3">
                    <div className="flex items-center gap-2">
                      {showBranchControls && (
                        <Badge variant="secondary" className="font-mono">
                          T{index + 1}
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleTerminalExpanded(index)}
                        className="flex-1 flex items-center gap-2 text-left hover:text-primary min-w-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <CardTitle className="min-w-0 text-sm font-medium flex items-center gap-2">
                          <Send className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">{branchTitle}</span>
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className={isProxy ? 'text-xs bg-blue-500/10' : 'text-xs'}
                        >
                          {isProxy ? 'Proxy' : 'Terminal'}
                        </Badge>
                        {showBranchControls && (
                          <Badge
                            variant="secondary"
                            className="text-xs font-mono max-w-[280px] truncate"
                            title={condition ? `when ${condition}` : 'always'}
                          >
                            {condition ? `when ${condition}` : 'always'}
                          </Badge>
                        )}
                      </button>
                      {showBranchControls && (
                        <>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={index === 0}
                              aria-label={`Move ${branch.name || 'branch'} up`}
                              onClick={() => moveTerminalBranch(index, 'up')}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={index === terminalSteps.length - 1}
                              aria-label={`Move ${branch.name || 'branch'} down`}
                              onClick={() => moveTerminalBranch(index, 'down')}
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${branch.name || 'branch'}`}
                            onClick={() => setDeleteTerminalConfirm(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      {/* Respond When (optional) */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Filter className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor={`terminal-${key}-condition`}>
                            Respond When{' '}
                            <span className="text-muted-foreground font-normal">(optional)</span>
                          </Label>
                        </div>
                        <ExpressionInput
                          value={condition || ''}
                          onChange={(value) => {
                            const currentConfig = (branch.config || {}) as Record<string, unknown>;
                            updateTerminalStep(index, {
                              config: { ...currentConfig, condition: value || undefined },
                            });
                          }}
                          placeholder="e.g., steps.fetch.ok or !steps.check_exists"
                          previousSteps={previousStepsForResponse}
                        />
                        <p className="text-xs text-muted-foreground">
                          This response is only used when the expression is truthy. Leave empty to
                          always respond.
                        </p>
                      </div>

                      <AvailableVariables
                        previousSteps={previousStepsForResponse}
                        syntax="template"
                        className="mb-4"
                      />
                      {isProxy ? (
                        <ProxyForwardConfig
                          config={branch.config as Partial<ProxyConfig>}
                          onChange={terminalConfigHandlers[index]}
                        />
                      ) : (
                        <ResponseHandlerConfig
                          config={branch.config as Partial<ResponseConfig>}
                          onChange={terminalConfigHandlers[index]}
                          previousSteps={previousStepsForResponse}
                        />
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {terminalStepType === 'none' && !hasImplicitTerminal && (
          // Default Response Preview
          <Card className="bg-muted/30">
            <CardHeader className="py-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Default Response</CardTitle>
              </div>
              <CardDescription className="text-xs">
                The pipeline returns a JSON response with the last step's output.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="bg-muted rounded-md p-3 font-mono text-xs">
                <div className="text-muted-foreground">// HTTP 200 OK</div>
                <div className="text-muted-foreground">// Content-Type: application/json</div>
                <pre className="mt-2 text-foreground">
{`{
  "success": true,
  "data": <output from "${lastStepName}">
}`}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Select "Custom HTTP Response" to configure status codes, headers, and templates, or
                "Forward Request" to proxy to another service.
              </p>
            </CardContent>
          </Card>
        )}

        {hasImplicitTerminal && streamingAIStep && (
          // AI Chat Streaming - Implicit Terminal
          <Card className="border-purple-500/20 bg-purple-500/5">
            <CardHeader className="py-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-purple-600" />
                <CardTitle className="text-sm font-medium">AI Chat Streaming Response</CardTitle>
              </div>
              <CardDescription className="text-xs">
                The "{streamingAIStep.name || 'ai'}" step streams directly to the client using the AI SDK protocol.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="bg-muted rounded-md p-3 font-mono text-xs">
                <div className="text-muted-foreground">// Content-Type: text/event-stream</div>
                <div className="text-muted-foreground">// x-vercel-ai-ui-message: v1</div>
                <pre className="mt-2 text-foreground">
{`// Streaming response compatible with useChat
data: {"type":"text-delta","value":"Hello"}
data: {"type":"text-delta","value":" world"}
...`}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Chat mode with streaming must be the last step in the pipeline. The response streams directly
                to the client for real-time display.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Post-Processing Steps */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-base">Post-Processing Steps</Label>
          <Button type="button" variant="outline" size="sm" onClick={addPostStep}>
            <Plus className="h-4 w-4 mr-1" />
            Add Post-Processing Step
          </Button>
        </div>

        {postSteps.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-6 text-center text-muted-foreground">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Info className="h-4 w-4" />
                <p className="text-sm">No post-processing steps.</p>
              </div>
              <p className="text-xs">
                Add steps here to run background work after the response is sent (e.g., logging, emails, database writes).
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>These steps run after the response is sent to the client. Errors are logged but don't affect the client response.</span>
            </div>
            {postSteps.map((step, index) => {
              const isExpanded = expandedPostSteps.has(index);
              const key = stepKey(step, index);
              // Post-processing steps can reference all regular steps + terminal step + prior post-steps
              const previousPostSteps: PreviousStep[] = [
                ...previousStepsForPost,
                ...postSteps.slice(0, index).map((s) => ({
                  name: s.name || getHandlerDisplayName(s.handlerType),
                  handlerType: s.handlerType,
                  config: s.config,
                })),
              ];
              return (
                <Card key={key} className={`border-amber-500/20 ${step.isEnabled === false ? 'opacity-60' : ''}`}>
                  <CardHeader className="py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <Badge variant="secondary" className="font-mono bg-amber-500/10 text-amber-700">
                        P{index + 1}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => togglePostExpanded(index)}
                        className="min-w-0 flex-1 flex items-center gap-2 text-left hover:text-primary"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <CardTitle className="min-w-0 truncate text-sm font-medium">
                          {step.name || getHandlerDisplayName(step.handlerType)}
                        </CardTitle>
                        {/* Secondary handler-type hint loses to the step name on phones */}
                        <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                          {step.name && `(${getHandlerDisplayName(step.handlerType)})`}
                        </span>
                      </button>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === 0}
                          aria-label={`Move ${step.name || 'post-processing step'} up`}
                          onClick={() => movePostStep(index, 'up')}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === postSteps.length - 1}
                          aria-label={`Move ${step.name || 'post-processing step'} down`}
                          onClick={() => movePostStep(index, 'down')}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <Switch
                        checked={step.isEnabled !== false}
                        onCheckedChange={(checked) => updatePostStep(index, { isEnabled: checked })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${step.name || 'post-processing step'}`}
                        onClick={() => setDeletePostConfirm(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`post-step-${key}-name`}>
                            Step Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`post-step-${key}-name`}
                            value={step.name || ''}
                            onChange={(e) => updatePostStep(index, { name: e.target.value })}
                            placeholder={getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_')}
                            className={!step.name ? 'border-destructive' : ''}
                          />
                          {!step.name && (
                            <p className="text-xs text-destructive">Required to reference step output in other steps</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`post-step-${key}-type`}>Handler Type</Label>
                          <Select
                            value={step.handlerType}
                            onValueChange={(v) => {
                              const newType = v as HandlerType;
                              const oldBaseName = getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_');
                              const isAutoGenerated = !step.name || step.name === oldBaseName || step.name.match(new RegExp(`^${oldBaseName}_\\d+$`));
                              const allExistingSteps = [...steps, ...postSteps.filter((_, i) => i !== index)];
                              updatePostStep(index, {
                                handlerType: newType,
                                config: {},
                                ...(isAutoGenerated ? { name: generateStepName(newType, allExistingSteps) } : {}),
                              });
                            }}
                          >
                            <SelectTrigger id={`post-step-${key}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-[400px]">
                              <HandlerTypeSelectContent unsupported={unsupportedHandlers} />
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Run Condition */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Filter className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor={`post-step-${key}-condition`}>
                            Run Condition <span className="text-muted-foreground font-normal">(optional)</span>
                          </Label>
                        </div>
                        <ExpressionInput
                          value={(step.config as Record<string, unknown>)?.condition as string || ''}
                          onChange={(value) => {
                            const currentConfig = (step.config || {}) as Record<string, unknown>;
                            updatePostStep(index, {
                              config: { ...currentConfig, condition: value || undefined },
                            });
                          }}
                          placeholder="e.g., steps.ai_chat.toolCalls"
                          previousSteps={previousPostSteps}
                        />
                        <p className="text-xs text-muted-foreground">
                          Step only runs if this expression is truthy.
                        </p>
                      </div>

                      {/* Handler-specific config */}
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <HandlerConfigWrapper
                          handlerType={step.handlerType}
                          config={step.config}
                          onChange={(newConfig) => {
                            const currentCondition = (step.config as Record<string, unknown>)?.condition;
                            updatePostStep(index, {
                              config: currentCondition
                                ? { ...newConfig, condition: currentCondition }
                                : newConfig,
                            });
                          }}
                          projectId={projectId}
                          previousSteps={previousPostSteps}
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Step</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this step? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm !== null && removeStep(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete terminal branch confirmation dialog */}
      <AlertDialog
        open={deleteTerminalConfirm !== null}
        onOpenChange={() => setDeleteTerminalConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this response branch? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTerminalConfirm !== null && removeTerminalBranch(deleteTerminalConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete post-processing step confirmation dialog */}
      <AlertDialog open={deletePostConfirm !== null} onOpenChange={() => setDeletePostConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post-Processing Step</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post-processing step? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePostConfirm !== null && removePostStep(deletePostConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </SecretNamesProvider>
  );
}
