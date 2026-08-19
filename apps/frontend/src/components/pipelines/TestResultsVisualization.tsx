import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Layers,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import type {
  TestPipelineResult,
  ValidatorDebugInfo,
  StepDebugInfo,
} from '@/services/pipelinesApi';
import { StepDebugCard } from './StepDebugCard';

interface TestResultsVisualizationProps {
  result: TestPipelineResult;
}

/**
 * TestResultsVisualization - Displays detailed test results
 * Shows summary, validators, step timeline, and final response
 */
export function TestResultsVisualization({ result }: TestResultsVisualizationProps) {
  const [validatorsExpanded, setValidatorsExpanded] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const [responseExpanded, setResponseExpanded] = useState(result.success);

  const debug = result.debug;
  const hasValidators = debug && debug.validators.length > 0;
  const hasSteps = debug && debug.steps.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <Card
        className={result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}
      >
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {result.success ? (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              ) : (
                <XCircle className="h-6 w-6 text-red-600" />
              )}
              <div>
                <div
                  className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}
                >
                  {result.success ? 'Pipeline Executed Successfully' : 'Pipeline Execution Failed'}
                </div>
                {result.error && (
                  <div className="text-sm text-red-700 mt-1">
                    {result.error.message}
                    {result.error.step && (
                      <span className="text-red-500"> (at step: {result.error.step})</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{result.durationMs}ms</span>
              </div>
              {result.response && (
                <Badge
                  variant="outline"
                  className={
                    result.response.status >= 200 && result.response.status < 300
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : result.response.status >= 400
                        ? 'bg-red-100 text-red-800 border-red-200'
                        : 'bg-yellow-100 text-yellow-800 border-yellow-200'
                  }
                >
                  HTTP {result.response.status}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validators Section */}
      {hasValidators && (
        <Card>
          <Collapsible open={validatorsExpanded} onOpenChange={setValidatorsExpanded}>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  {validatorsExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Shield className="h-4 w-4 text-blue-500" />
                  <CardTitle className="text-sm font-medium">Validators</CardTitle>
                  <div className="ml-auto flex items-center gap-2">
                    <ValidatorsSummary validators={debug.validators} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {debug.validators.map((validator, index) => (
                    <ValidatorItem key={index} validator={validator} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Steps Timeline */}
      {hasSteps && (
        <Card>
          <Collapsible open={stepsExpanded} onOpenChange={setStepsExpanded}>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  {stepsExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Layers className="h-4 w-4 text-purple-500" />
                  <CardTitle className="text-sm font-medium">
                    Steps ({debug.steps.length})
                  </CardTitle>
                  <div className="ml-auto flex items-center gap-2">
                    <StepsSummary steps={debug.steps} />
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {debug.steps.map((step, index) => (
                    <StepDebugCard key={step.stepId} step={step} index={index} />
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Final Response */}
      {result.response && (
        <Card>
          <Collapsible open={responseExpanded} onOpenChange={setResponseExpanded}>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  {responseExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="text-lg">📤</span>
                  <CardTitle className="text-sm font-medium">Final Response</CardTitle>
                  <Badge
                    variant="outline"
                    className={
                      result.response.status >= 200 && result.response.status < 300
                        ? 'bg-green-100 text-green-800 border-green-200'
                        : 'bg-red-100 text-red-800 border-red-200'
                    }
                  >
                    {result.response.status}
                  </Badge>
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0 space-y-4">
                {/* Response Headers */}
                {result.response.headers && Object.keys(result.response.headers).length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Headers</div>
                    <div className="bg-muted rounded p-2">
                      {Object.entries(result.response.headers).map(([key, value]) => (
                        <div key={key} className="text-xs font-mono">
                          <span className="text-blue-600">{key}</span>
                          <span className="text-muted-foreground">: </span>
                          <span>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Response Body */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Body</div>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[300px]">
                    {typeof result.response.body === 'string'
                      ? result.response.body
                      : JSON.stringify(result.response.body, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Error Details (if no response) */}
      {!result.success && result.error && !result.response && (
        <Card className="border-red-200">
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <CardTitle className="text-sm font-medium text-red-800">Error Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="bg-red-50 border border-red-200 rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">{result.error.code}</Badge>
                <span className="text-sm text-red-800">{result.error.message}</span>
              </div>
              {result.error.step && (
                <div className="text-xs text-red-600">
                  Failed at step:{' '}
                  <code className="bg-red-100 px-1 rounded">{result.error.step}</code>
                </div>
              )}
              {result.error.details !== undefined && (
                <pre className="text-xs bg-red-100 p-2 rounded mt-2 overflow-auto text-red-700">
                  {JSON.stringify(result.error.details, null, 2)}
                </pre>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * ValidatorsSummary - Shows summary badges for validator results
 */
function ValidatorsSummary({ validators }: { validators: ValidatorDebugInfo[] }) {
  const passed = validators.filter((v) => v.passed).length;
  const failed = validators.filter((v) => !v.passed).length;
  const totalTime = validators.reduce((sum, v) => sum + v.durationMs, 0);

  return (
    <>
      {passed > 0 && (
        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
          {passed} passed
        </Badge>
      )}
      {failed > 0 && (
        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
          {failed} failed
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">{totalTime}ms</span>
    </>
  );
}

/**
 * ValidatorItem - Single validator result display
 */
function ValidatorItem({ validator }: { validator: ValidatorDebugInfo }) {
  return (
    <div
      className={`flex items-center justify-between p-2 rounded ${
        validator.passed ? 'bg-green-50' : 'bg-red-50'
      }`}
    >
      <div className="flex items-center gap-2">
        {validator.passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600" />
        )}
        <span className="text-sm font-medium">{validator.type}</span>
        {validator.error && <span className="text-xs text-red-600">{validator.error.message}</span>}
      </div>
      <span className="text-xs text-muted-foreground">{validator.durationMs}ms</span>
    </div>
  );
}

/**
 * StepsSummary - Shows summary badges for step results
 */
function StepsSummary({ steps }: { steps: StepDebugInfo[] }) {
  const success = steps.filter((s) => s.status === 'success').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  const totalTime = steps.reduce((sum, s) => sum + s.durationMs, 0);

  return (
    <>
      {success > 0 && (
        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
          {success} success
        </Badge>
      )}
      {failed > 0 && (
        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
          {failed} failed
        </Badge>
      )}
      {skipped > 0 && (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
          {skipped} skipped
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">{totalTime}ms</span>
    </>
  );
}
