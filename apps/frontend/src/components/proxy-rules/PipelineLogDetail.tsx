import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { useGetLogDetailQuery } from '@/services/proxyRulesApi';

interface PipelineLogDetailProps {
  logId: string;
}

export function PipelineLogDetail({ logId }: PipelineLogDetailProps) {
  const { data: log, isLoading } = useGetLogDetailQuery(logId);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
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

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (!log) {
    return <p className="text-sm text-muted-foreground">Log not found.</p>;
  }

  const debug = log.debug;

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-3 text-sm">
        <Badge variant={log.success ? 'default' : 'destructive'}>
          {log.success ? 'Success' : 'Failed'}
        </Badge>
        <span className="font-mono">{log.method} {log.path}</span>
        <span className="text-muted-foreground">{log.statusCode}</span>
        <span className="text-muted-foreground">{debug.totalDurationMs}ms total</span>
      </div>

      {/* Request meta */}
      {log.requestMeta && (
        <div className="text-xs text-muted-foreground flex gap-3">
          {log.requestMeta.ip && <span>IP: {log.requestMeta.ip}</span>}
          {log.requestMeta.userId && <span>User: {log.requestMeta.userId}</span>}
        </div>
      )}

      {/* Validators */}
      {debug.validators.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">Validators</h4>
          <div className="space-y-1">
            {debug.validators.map((v, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    v.skipped ? 'bg-gray-400' : v.passed ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="font-mono">{v.type}</span>
                <span className="text-muted-foreground">{v.durationMs}ms</span>
                {v.skipped && <span className="text-muted-foreground">(skipped)</span>}
                {v.error && <span className="text-red-500">{v.error.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps Timeline */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1">Steps</h4>
        <div className="space-y-1">
          {debug.steps.map((step) => {
            const isExpanded = expandedSteps.has(step.stepId);
            return (
              <div key={step.stepId}>
                <div
                  onClick={() => toggleStep(step.stepId)}
                  className="flex items-center gap-2 text-xs p-2 rounded hover:bg-accent cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 flex-shrink-0" />
                  )}
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      step.status === 'success'
                        ? 'bg-green-500'
                        : step.status === 'failed'
                          ? 'bg-red-500'
                          : 'bg-gray-400'
                    }`}
                  />
                  <span className="font-medium">{step.stepName || step.stepId}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {step.handlerType}
                  </Badge>
                  <span className="text-muted-foreground">{step.durationMs}ms</span>
                  {step.warning && (
                    <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                  )}
                  {step.error && (
                    <span className="text-red-500 truncate ml-auto">
                      {step.error.message}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <div className="ml-7 pl-3 border-l space-y-2 pb-2">
                    {step.condition && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Condition: </span>
                        <code className="bg-muted px-1 rounded">{step.condition}</code>
                        {step.conditionResult !== undefined && (
                          <span className={step.conditionResult ? 'text-green-600' : 'text-red-500'}>
                            {' '}({step.conditionResult ? 'met' : 'not met'})
                          </span>
                        )}
                      </div>
                    )}
                    {step.warning && (
                      <div className="text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950 p-2 rounded">
                        {step.warning}
                      </div>
                    )}
                    {step.error && (
                      <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded">
                        <div className="font-medium">{step.error.code}: {step.error.message}</div>
                        {step.error.details != null && (
                          <pre className="mt-1 text-[10px] overflow-auto max-h-32">
                            {String(JSON.stringify(step.error.details, null, 2))}
                          </pre>
                        )}
                      </div>
                    )}
                    <div className="text-xs">
                      <span className="text-muted-foreground">Input:</span>
                      <pre className="mt-1 bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                    {step.output !== undefined && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Output:</span>
                        <pre className="mt-1 bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                          {JSON.stringify(step.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
