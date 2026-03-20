import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
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
import type { HandlerType, ValidatorConfig } from '@/services/pipelinesApi';
import type {
  PipelineStepConfig,
  PipelineConfig as PipelineConfigType,
} from '@/services/proxyRulesApi';
import {
  HandlerConfigWrapper,
  getHandlerDisplayName,
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

// Handler types available for pipeline steps (excluding response_handler which is a terminal step)
const HANDLER_TYPES: HandlerType[] = [
  'form_handler',
  'data_create',
  'data_query',
  'data_update',
  'data_delete',
  'email_handler',
  'function_handler',
  'db_aggregate',
  'ai_handler',
  'file_upload_handler',
  'file_serve_handler',
];

function generateId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Terminal step types
type TerminalStepType = 'none' | 'response' | 'proxy';

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
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [expandedPostSteps, setExpandedPostSteps] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deletePostConfirm, setDeletePostConfirm] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  // Separate terminal steps (response_handler, proxy_forward) from regular steps
  const allSteps = config.steps || [];
  const terminalStep = allSteps.find(
    (s) => s.handlerType === 'response_handler' || s.handlerType === 'proxy_forward',
  );
  const steps = allSteps.filter(
    (s) => s.handlerType !== 'response_handler' && s.handlerType !== 'proxy_forward',
  );

  // Post-processing steps
  const postSteps = config.postSteps || [];

  // Determine current terminal step type
  const terminalStepType: TerminalStepType = terminalStep
    ? terminalStep.handlerType === 'proxy_forward'
      ? 'proxy'
      : 'response'
    : 'none';

  const name = config.name || '';
  const description = config.description || '';

  // Combine steps with terminal step (terminal always goes last)
  const getAllSteps = useCallback(
    (regularSteps: PipelineStep[], termStep?: PipelineStep) => {
      return termStep ? [...regularSteps, termStep] : regularSteps;
    },
    [],
  );

  const updateConfig = useCallback(
    (updates: Partial<PipelineConfigData>) => {
      // If updating steps, we need to re-combine with terminal step
      const newSteps = updates.steps !== undefined
        ? getAllSteps(updates.steps, terminalStep)
        : getAllSteps(steps, terminalStep);

      onChange({
        name,
        description,
        steps: newSteps,
        postSteps,
        ...updates,
        // Make sure steps is always the combined value
        ...(updates.steps !== undefined ? { steps: getAllSteps(updates.steps, terminalStep) } : {}),
      });
    },
    [name, description, steps, postSteps, terminalStep, onChange, getAllSteps],
  );

  // Change terminal step type
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
        setTerminalExpanded(false);
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
        setTerminalExpanded(true);
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
        setTerminalExpanded(true);
      }
    },
    [name, description, steps, postSteps, terminalStep, onChange],
  );

  // Update terminal step config
  const updateTerminalConfig = useCallback(
    (newConfig: ResponseConfig | ProxyConfig) => {
      if (!terminalStep) return;
      onChange({
        name,
        description,
        steps: [...steps, { ...terminalStep, config: newConfig as unknown as Record<string, unknown> }],
        postSteps,
      });
    },
    [name, description, steps, postSteps, terminalStep, onChange],
  );

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
    setExpandedSteps((prev) => new Set([...prev, newStep.id]));
  };

  const removeStep = (stepId: string) => {
    updateConfig({ steps: steps.filter((s) => s.id !== stepId) });
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.delete(stepId);
      return next;
    });
    setDeleteConfirm(null);
  };

  const updateStep = (stepId: string, updates: Partial<PipelineStep>) => {
    updateConfig({
      steps: steps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    });
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const index = steps.findIndex((s) => s.id === stepId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    updateConfig({ steps: newSteps });
  };

  const toggleExpanded = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
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
    setExpandedPostSteps((prev) => new Set([...prev, newStep.id]));
  };

  const removePostStep = (stepId: string) => {
    updateConfig({ postSteps: postSteps.filter((s) => s.id !== stepId) });
    setExpandedPostSteps((prev) => {
      const next = new Set(prev);
      next.delete(stepId);
      return next;
    });
    setDeletePostConfirm(null);
  };

  const updatePostStep = (stepId: string, updates: Partial<PipelineStep>) => {
    updateConfig({
      postSteps: postSteps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    });
  };

  const movePostStep = (stepId: string, direction: 'up' | 'down') => {
    const index = postSteps.findIndex((s) => s.id === stepId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= postSteps.length) return;

    const newPostSteps = [...postSteps];
    [newPostSteps[index], newPostSteps[newIndex]] = [newPostSteps[newIndex], newPostSteps[index]];
    updateConfig({ postSteps: newPostSteps });
  };

  const togglePostExpanded = (stepId: string) => {
    setExpandedPostSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  // Previous steps available for post-processing steps (all regular + terminal)
  const previousStepsForPost: PreviousStep[] = useMemo(
    () => [
      ...steps.map((s) => ({
        name: s.name || getHandlerDisplayName(s.handlerType),
        handlerType: s.handlerType,
        config: s.config,
      })),
      ...(terminalStep
        ? [
            {
              name: terminalStep.name || getHandlerDisplayName(terminalStep.handlerType),
              handlerType: terminalStep.handlerType,
              config: terminalStep.config,
            },
          ]
        : []),
    ],
    [steps, terminalStep],
  );

  return (
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
        <div className="flex items-center justify-between">
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
              const isExpanded = expandedSteps.has(step.id);
              // Calculate previous steps for context
              const previousSteps = steps.slice(0, index).map((s) => ({
                name: s.name || getHandlerDisplayName(s.handlerType),
                handlerType: s.handlerType,
                config: s.config,
              }));
              return (
                <Card key={step.id} className={!step.isEnabled ? 'opacity-60' : ''}>
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
                        onClick={() => toggleExpanded(step.id)}
                        className="flex-1 flex items-center gap-2 text-left hover:text-primary"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <CardTitle className="text-sm font-medium">
                          {step.name || getHandlerDisplayName(step.handlerType)}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">
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
                          onClick={() => moveStep(step.id, 'up')}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === steps.length - 1}
                          onClick={() => moveStep(step.id, 'down')}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Delete button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteConfirm(step.id)}
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
                          <Label htmlFor={`step-${step.id}-name`}>
                            Step Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`step-${step.id}-name`}
                            value={step.name || ''}
                            onChange={(e) => updateStep(step.id, { name: e.target.value })}
                            placeholder={getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_')}
                            className={!step.name ? 'border-destructive' : ''}
                          />
                          {!step.name && (
                            <p className="text-xs text-destructive">Required to reference step output in other steps</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`step-${step.id}-type`}>Handler Type</Label>
                          <Select
                            value={step.handlerType}
                            onValueChange={(v) => {
                              const newType = v as HandlerType;
                              const oldBaseName = getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_');
                              // Auto-update name if it matches the old auto-generated pattern
                              const isAutoGenerated = !step.name || step.name === oldBaseName || step.name.match(new RegExp(`^${oldBaseName}_\\d+$`));
                              updateStep(step.id, {
                                handlerType: newType,
                                config: {}, // Reset config when type changes
                                ...(isAutoGenerated ? { name: generateStepName(newType, steps.filter(s => s.id !== step.id)) } : {}),
                              });
                            }}
                          >
                            <SelectTrigger id={`step-${step.id}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HANDLER_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {getHandlerDisplayName(type)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Run Condition (optional) */}
                      {index > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <Label htmlFor={`step-${step.id}-condition`}>
                              Run Condition <span className="text-muted-foreground font-normal">(optional)</span>
                            </Label>
                          </div>
                          <ExpressionInput
                            value={(step.config as Record<string, unknown>)?.condition as string || ''}
                            onChange={(value) => {
                              const currentConfig = (step.config || {}) as Record<string, unknown>;
                              updateStep(step.id, {
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
                            updateStep(step.id, {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base">Terminal Step</Label>
          </div>
          {!hasImplicitTerminal && (
            <Select
              value={terminalStepType}
              onValueChange={(v) => setTerminalType(v as TerminalStepType)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Default Response</SelectItem>
                <SelectItem value="response">Custom HTTP Response</SelectItem>
                <SelectItem value="proxy">Forward Request (Proxy)</SelectItem>
              </SelectContent>
            </Select>
          )}
          {hasImplicitTerminal && (
            <Badge variant="secondary" className="text-xs">
              AI Chat (Streaming)
            </Badge>
          )}
        </div>

        {terminalStepType === 'response' && terminalStep && (
          // Custom Response Configuration
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="py-3">
              <button
                type="button"
                onClick={() => setTerminalExpanded(!terminalExpanded)}
                className="flex items-center gap-2 text-left hover:text-primary w-full"
              >
                {terminalExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  HTTP Response
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  Terminal
                </Badge>
              </button>
            </CardHeader>
            {terminalExpanded && (
              <CardContent className="pt-0 space-y-4">
                <AvailableVariables
                  previousSteps={previousStepsForResponse}
                  syntax="template"
                  className="mb-4"
                />
                <ResponseHandlerConfig
                  config={terminalStep.config as Partial<ResponseConfig>}
                  onChange={updateTerminalConfig}
                  previousSteps={previousStepsForResponse}
                />
              </CardContent>
            )}
          </Card>
        )}

        {terminalStepType === 'proxy' && terminalStep && (
          // Proxy Forward Configuration
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardHeader className="py-3">
              <button
                type="button"
                onClick={() => setTerminalExpanded(!terminalExpanded)}
                className="flex items-center gap-2 text-left hover:text-primary w-full"
              >
                {terminalExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Forward Request
                </CardTitle>
                <Badge variant="outline" className="text-xs bg-blue-500/10">
                  Proxy
                </Badge>
              </button>
            </CardHeader>
            {terminalExpanded && (
              <CardContent className="pt-0 space-y-4">
                <AvailableVariables
                  previousSteps={previousStepsForResponse}
                  syntax="template"
                  className="mb-4"
                />
                <ProxyForwardConfig
                  config={terminalStep.config as Partial<ProxyConfig>}
                  onChange={updateTerminalConfig}
                />
              </CardContent>
            )}
          </Card>
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
        <div className="flex items-center justify-between">
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
              const isExpanded = expandedPostSteps.has(step.id);
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
                <Card key={step.id} className={`border-amber-500/20 ${!step.isEnabled ? 'opacity-60' : ''}`}>
                  <CardHeader className="py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <Badge variant="secondary" className="font-mono bg-amber-500/10 text-amber-700">
                        P{index + 1}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => togglePostExpanded(step.id)}
                        className="flex-1 flex items-center gap-2 text-left hover:text-primary"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <CardTitle className="text-sm font-medium">
                          {step.name || getHandlerDisplayName(step.handlerType)}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">
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
                          onClick={() => movePostStep(step.id, 'up')}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === postSteps.length - 1}
                          onClick={() => movePostStep(step.id, 'down')}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletePostConfirm(step.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`post-step-${step.id}-name`}>
                            Step Name <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`post-step-${step.id}-name`}
                            value={step.name || ''}
                            onChange={(e) => updatePostStep(step.id, { name: e.target.value })}
                            placeholder={getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_')}
                            className={!step.name ? 'border-destructive' : ''}
                          />
                          {!step.name && (
                            <p className="text-xs text-destructive">Required to reference step output in other steps</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`post-step-${step.id}-type`}>Handler Type</Label>
                          <Select
                            value={step.handlerType}
                            onValueChange={(v) => {
                              const newType = v as HandlerType;
                              const oldBaseName = getHandlerDisplayName(step.handlerType).toLowerCase().replace(/\s+/g, '_');
                              const isAutoGenerated = !step.name || step.name === oldBaseName || step.name.match(new RegExp(`^${oldBaseName}_\\d+$`));
                              const allExistingSteps = [...steps, ...postSteps.filter(s => s.id !== step.id)];
                              updatePostStep(step.id, {
                                handlerType: newType,
                                config: {},
                                ...(isAutoGenerated ? { name: generateStepName(newType, allExistingSteps) } : {}),
                              });
                            }}
                          >
                            <SelectTrigger id={`post-step-${step.id}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HANDLER_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {getHandlerDisplayName(type)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Run Condition */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Filter className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor={`post-step-${step.id}-condition`}>
                            Run Condition <span className="text-muted-foreground font-normal">(optional)</span>
                          </Label>
                        </div>
                        <ExpressionInput
                          value={(step.config as Record<string, unknown>)?.condition as string || ''}
                          onChange={(value) => {
                            const currentConfig = (step.config || {}) as Record<string, unknown>;
                            updatePostStep(step.id, {
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
                            updatePostStep(step.id, {
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
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
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
              onClick={() => deleteConfirm && removeStep(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete post-processing step confirmation dialog */}
      <AlertDialog open={!!deletePostConfirm} onOpenChange={() => setDeletePostConfirm(null)}>
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
              onClick={() => deletePostConfirm && removePostStep(deletePostConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
