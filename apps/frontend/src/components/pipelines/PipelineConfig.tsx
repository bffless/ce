import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { HandlerType } from '@/services/pipelinesApi';
import type {
  PipelineStepConfig,
  PipelineConfig as PipelineConfigType,
} from '@/services/proxyRulesApi';
import {
  HandlerConfigWrapper,
  getHandlerDisplayName,
  getHandlerDescription,
} from './handlers';

// Re-export types for convenience
export type PipelineStep = PipelineStepConfig;
export type PipelineConfigData = PipelineConfigType;

interface PipelineConfigProps {
  config: Partial<PipelineConfigData>;
  onChange: (config: PipelineConfigData) => void;
  projectId: string;
}

const HANDLER_TYPES: HandlerType[] = [
  'form_handler',
  'data_create',
  'data_query',
  'data_update',
  'data_delete',
  'email_handler',
  'response_handler',
  'aggregate_handler',
];

function generateId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * PipelineConfig - Full pipeline editor component.
 * Allows adding, removing, and reordering steps with their handler configs.
 */
export function PipelineConfig({ config, onChange, projectId }: PipelineConfigProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const steps = config.steps || [];
  const name = config.name || '';
  const description = config.description || '';

  const updateConfig = useCallback(
    (updates: Partial<PipelineConfigData>) => {
      onChange({
        name,
        description,
        steps,
        ...updates,
      });
    },
    [name, description, steps, onChange],
  );

  const addStep = () => {
    const newStep: PipelineStep = {
      id: generateId(),
      handlerType: 'form_handler',
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
                          <Label htmlFor={`step-${step.id}-name`}>Step Name (optional)</Label>
                          <Input
                            id={`step-${step.id}-name`}
                            value={step.name || ''}
                            onChange={(e) => updateStep(step.id, { name: e.target.value })}
                            placeholder={getHandlerDisplayName(step.handlerType)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`step-${step.id}-type`}>Handler Type</Label>
                          <Select
                            value={step.handlerType}
                            onValueChange={(v) =>
                              updateStep(step.id, {
                                handlerType: v as HandlerType,
                                config: {}, // Reset config when type changes
                              })
                            }
                          >
                            <SelectTrigger id={`step-${step.id}-type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HANDLER_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  <div>
                                    <div>{getHandlerDisplayName(type)}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {getHandlerDescription(type)}
                                    </div>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Handler-specific config */}
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <HandlerConfigWrapper
                          handlerType={step.handlerType}
                          config={step.config}
                          onChange={(newConfig) => updateStep(step.id, { config: newConfig })}
                          projectId={projectId}
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
    </div>
  );
}
