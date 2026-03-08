import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, SkipForward, Clock } from 'lucide-react';
import type { StepDebugInfo } from '@/services/pipelinesApi';

interface StepDebugCardProps {
  step: StepDebugInfo;
  index: number;
}

/**
 * StepDebugCard - Expandable card showing debug information for a single step
 */
export function StepDebugCard({ step, index }: StepDebugCardProps) {
  const [isExpanded, setIsExpanded] = useState(step.status === 'failed');

  // Status icon and color
  const getStatusInfo = () => {
    switch (step.status) {
      case 'success':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
          badge: 'bg-green-100 text-green-800 border-green-200',
          label: 'Success',
        };
      case 'failed':
        return {
          icon: <XCircle className="h-4 w-4 text-red-500" />,
          badge: 'bg-red-100 text-red-800 border-red-200',
          label: 'Failed',
        };
      case 'skipped':
        return {
          icon: <SkipForward className="h-4 w-4 text-yellow-500" />,
          badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          label: 'Skipped',
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <Card className={step.status === 'failed' ? 'border-red-200' : ''}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-2 px-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              {statusInfo.icon}
              <Badge variant="secondary" className="font-mono text-xs">
                {index + 1}
              </Badge>
              <span className="text-sm font-medium">
                {step.stepName || step.handlerType}
              </span>
              <Badge variant="outline" className="text-xs">
                {step.handlerType}
              </Badge>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className={statusInfo.badge}>
                  {statusInfo.label}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {step.durationMs}ms
                </span>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Condition Info */}
            {step.condition && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Condition</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                    {step.condition}
                  </code>
                  <Badge
                    variant="outline"
                    className={
                      step.conditionResult
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }
                  >
                    {step.conditionResult ? 'true' : 'false'}
                  </Badge>
                </div>
              </div>
            )}

            {/* Input Snapshot */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Input Snapshot</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Request Input</div>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-[150px]">
                    {JSON.stringify(step.input.requestInput, null, 2)}
                  </pre>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Previous Step Outputs</div>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-[150px]">
                    {Object.keys(step.input.previousStepOutputs).length > 0
                      ? JSON.stringify(step.input.previousStepOutputs, null, 2)
                      : '(none)'}
                  </pre>
                </div>
              </div>
            </div>

            {/* Output */}
            {step.status !== 'skipped' && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Output</div>
                {step.output !== undefined ? (
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-[200px]">
                    {JSON.stringify(step.output, null, 2)}
                  </pre>
                ) : (
                  <div className="text-xs text-muted-foreground italic">(no output)</div>
                )}
              </div>
            )}

            {/* Error */}
            {step.error && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-red-600">Error</div>
                <div className="bg-red-50 border border-red-200 rounded p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">
                      {step.error.code}
                    </Badge>
                    <span className="text-sm text-red-800">{step.error.message}</span>
                  </div>
                  {step.error.details !== undefined && (
                    <pre className="text-xs text-red-700 bg-red-100 p-2 rounded mt-2 overflow-auto">
                      {JSON.stringify(step.error.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* Timing */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
              <span>Start: {new Date(step.startTime).toLocaleTimeString()}</span>
              <span>End: {new Date(step.endTime).toLocaleTimeString()}</span>
              <span>Duration: {step.durationMs}ms</span>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
