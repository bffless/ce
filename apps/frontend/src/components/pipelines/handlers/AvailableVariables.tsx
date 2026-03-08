import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PreviousStep {
  name: string;
  handlerType: string;
  /** Step configuration - used to extract actual field names */
  config?: Record<string, unknown>;
}

interface AvailableVariablesProps {
  previousSteps: PreviousStep[];
  /** Template syntax ({{expression}}) vs code syntax (data.expression) */
  syntax?: 'template' | 'code';
  className?: string;
}

/**
 * Collapsible panel showing available variables based on pipeline context.
 * Shows input, user, request, and outputs from previous steps.
 */
export function AvailableVariables({
  previousSteps,
  syntax = 'code',
  className,
}: AvailableVariablesProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatVar = (path: string) => {
    if (syntax === 'template') {
      return `{{${path}}}`;
    }
    return `data.${path}`;
  };

  const formatStepRef = (stepName: string, field?: string) => {
    // Use bracket notation for step names with spaces
    const needsBrackets = /\s/.test(stepName);
    const stepPath = needsBrackets ? `steps['${stepName}']` : `steps.${stepName}`;
    const fullPath = field ? `${stepPath}.${field}` : stepPath;

    if (syntax === 'template') {
      return `{{${fullPath}}}`;
    }
    return `data.${fullPath}`;
  };

  return (
    <div className={cn('border rounded-md text-xs', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Info className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">Available Variables</span>
        {previousSteps.length > 0 && (
          <span className="text-muted-foreground">
            ({previousSteps.length} step{previousSteps.length !== 1 ? 's' : ''} available)
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t">
          {/* Input */}
          <div>
            <div className="font-medium text-muted-foreground mb-1">Request Input</div>
            <code className="block bg-muted px-2 py-1 rounded text-[11px]">
              {formatVar('input')}
            </code>
            <div className="text-muted-foreground mt-0.5">
              Form data or JSON body from the request
            </div>
          </div>

          {/* User */}
          <div>
            <div className="font-medium text-muted-foreground mb-1">Current User (if authenticated)</div>
            <div className="space-y-0.5">
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('user.id')}
              </code>
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('user.email')}
              </code>
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('user.role')}
              </code>
            </div>
          </div>

          {/* Request */}
          <div>
            <div className="font-medium text-muted-foreground mb-1">Request Info</div>
            <div className="space-y-0.5">
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('request.method')} <span className="text-muted-foreground">- GET, POST, etc.</span>
              </code>
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('request.path')} <span className="text-muted-foreground">- URL path</span>
              </code>
              <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                {formatVar('request.query')} <span className="text-muted-foreground">- Query params object</span>
              </code>
            </div>
          </div>

          {/* Previous Steps */}
          {previousSteps.length > 0 && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Previous Step Outputs
              </div>
              <div className="space-y-2">
                {previousSteps.map((step, idx) => (
                  <div key={idx} className="bg-muted/50 rounded p-2">
                    <div className="font-medium text-foreground mb-1">
                      Step {idx + 1}: {step.name}
                    </div>
                    <code className="block bg-muted px-2 py-1 rounded text-[11px]">
                      {formatStepRef(step.name)}
                    </code>
                    <div className="text-muted-foreground mt-0.5">
                      {getStepOutputDescription(step.handlerType)}
                    </div>
                    {getStepOutputExamples(step.handlerType, step.name, syntax, step.config).map((example, i) => (
                      <code key={i} className="block bg-muted px-2 py-1 rounded text-[11px] mt-0.5">
                        {example}
                      </code>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getStepOutputDescription(handlerType: string): string {
  const descriptions: Record<string, string> = {
    form_handler: 'Validated and typed form fields',
    data_create: 'Created record with id and fields',
    data_query: 'Array of matching records',
    data_update: 'Updated record(s)',
    data_delete: 'Deletion result',
    email_handler: 'Email send result',
    function_handler: 'Custom return value from handler()',
    aggregate_handler: 'Aggregation result',
    response_handler: 'Response config (usually last step)',
  };
  return descriptions[handlerType] || 'Step output data';
}

function getStepOutputExamples(
  handlerType: string,
  stepName: string,
  syntax: 'template' | 'code',
  config?: Record<string, unknown>
): string[] {
  const fmt = (path: string) => syntax === 'template' ? `{{${path}}}` : `data.${path}`;
  const needsBrackets = /\s/.test(stepName);
  const stepPath = needsBrackets ? `steps['${stepName}']` : `steps.${stepName}`;

  // For form_handler, extract actual field names from config
  if (handlerType === 'form_handler' && config?.fields) {
    const fields = config.fields as Record<string, unknown>;
    const fieldNames = Object.keys(fields);
    return fieldNames.slice(0, 3).map((fieldName) => fmt(`${stepPath}.${fieldName}`));
  }

  // For data handlers, extract field mappings from config
  if ((handlerType === 'data_create' || handlerType === 'data_update') && config?.fields) {
    const fields = config.fields as Record<string, unknown>;
    const fieldNames = Object.keys(fields);
    // Always include id for created/updated records
    const examples = [fmt(`${stepPath}.id`)];
    fieldNames.slice(0, 2).forEach((fieldName) => {
      examples.push(fmt(`${stepPath}.${fieldName}`));
    });
    return examples;
  }

  // Default examples for handlers without config-based fields
  const defaultExamples: Record<string, string[]> = {
    data_create: [
      fmt(`${stepPath}.id`),
      fmt(`${stepPath}.createdAt`),
    ],
    data_query: [
      fmt(`${stepPath}[0]`),
      fmt(`${stepPath}.length`),
    ],
    data_update: [
      fmt(`${stepPath}.id`),
      fmt(`${stepPath}.updatedAt`),
    ],
    data_delete: [
      fmt(`${stepPath}.deleted`),
      fmt(`${stepPath}.count`),
    ],
    email_handler: [
      fmt(`${stepPath}.sent`),
      fmt(`${stepPath}.messageId`),
    ],
    function_handler: [
      fmt(`${stepPath}.result`),
    ],
    aggregate_handler: [
      fmt(`${stepPath}.result`),
    ],
  };

  return defaultExamples[handlerType] || [];
}
