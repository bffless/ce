import { useCallback } from 'react';
import type { HandlerType } from '@/services/pipelinesApi';
import { FormHandlerConfig } from './FormHandlerConfig';
import { DataCreateConfig } from './DataCreateConfig';
import { DataQueryConfig } from './DataQueryConfig';
import { DataUpdateConfig } from './DataUpdateConfig';
import { DataDeleteConfig } from './DataDeleteConfig';
import { EmailHandlerConfig } from './EmailHandlerConfig';
import { ResponseHandlerConfig } from './ResponseHandlerConfig';
import { AggregateHandlerConfig } from './AggregateHandlerConfig';
import { FunctionHandlerConfig } from './FunctionHandlerConfig';
import { AvailableVariables, type PreviousStep } from './AvailableVariables';
import type { HandlerConfig } from './types';

interface HandlerConfigWrapperProps {
  handlerType: HandlerType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  projectId: string;
  /** Previous steps in the pipeline (for showing available variables) */
  previousSteps?: PreviousStep[];
}

/**
 * Wrapper component that renders the appropriate config editor
 * based on the handler type.
 */
export function HandlerConfigWrapper({
  handlerType,
  config,
  onChange,
  projectId,
  previousSteps = [],
}: HandlerConfigWrapperProps) {
  // Wrap onChange to ensure proper typing
  const handleChange = useCallback(
    (newConfig: HandlerConfig) => {
      onChange(newConfig as unknown as Record<string, unknown>);
    },
    [onChange],
  );

  // Determine syntax based on handler type
  // Template syntax for response/email handlers, code syntax for function handler
  const usesTemplateSyntax = handlerType === 'response_handler' || handlerType === 'email_handler';

  // Render available variables panel (shown for handlers that use expressions)
  const renderVariablesPanel = () => {
    // Don't show for form_handler (it's usually the first step)
    if (handlerType === 'form_handler') return null;

    return (
      <AvailableVariables
        previousSteps={previousSteps}
        syntax={usesTemplateSyntax ? 'template' : 'code'}
        className="mb-4"
      />
    );
  };

  switch (handlerType) {
    case 'form_handler':
      return (
        <FormHandlerConfig
          config={config}
          onChange={handleChange}
        />
      );

    case 'data_create':
      return (
        <>
          {renderVariablesPanel()}
          <DataCreateConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
          />
        </>
      );

    case 'data_query':
      return (
        <>
          {renderVariablesPanel()}
          <DataQueryConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
          />
        </>
      );

    case 'data_update':
      return (
        <>
          {renderVariablesPanel()}
          <DataUpdateConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
          />
        </>
      );

    case 'data_delete':
      return (
        <>
          {renderVariablesPanel()}
          <DataDeleteConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
          />
        </>
      );

    case 'email_handler':
      return (
        <>
          {renderVariablesPanel()}
          <EmailHandlerConfig
            config={config}
            onChange={handleChange}
          />
        </>
      );

    // Note: response_handler is usually rendered as a terminal step in PipelineConfig,
    // but we keep this case for direct usage of HandlerConfigWrapper
    case 'response_handler':
      return (
        <>
          {renderVariablesPanel()}
          <ResponseHandlerConfig
            config={config}
            onChange={handleChange}
          />
        </>
      );

    case 'aggregate_handler':
      return (
        <>
          {renderVariablesPanel()}
          <AggregateHandlerConfig
            config={config}
            onChange={handleChange}
          />
        </>
      );

    case 'function_handler':
      return (
        <>
          {renderVariablesPanel()}
          <FunctionHandlerConfig
            config={config}
            onChange={handleChange}
            previousSteps={previousSteps}
          />
        </>
      );

    default:
      return (
        <div className="text-sm text-destructive p-4 bg-destructive/10 rounded-md">
          Unknown handler type: {handlerType}
        </div>
      );
  }
}

/**
 * Helper to get handler display name
 */
export function getHandlerDisplayName(type: HandlerType): string {
  const names: Record<HandlerType, string> = {
    form_handler: 'Form Validation',
    data_create: 'Create Record',
    data_query: 'Query Records',
    data_update: 'Update Records',
    data_delete: 'Delete Records',
    email_handler: 'Send Email',
    response_handler: 'HTTP Response',
    proxy_forward: 'Forward Request',
    function_handler: 'Custom Function',
    aggregate_handler: 'Aggregate Data',
  };
  return names[type] || type;
}

/**
 * Helper to get handler description
 */
export function getHandlerDescription(type: HandlerType): string {
  const descriptions: Record<HandlerType, string> = {
    form_handler: 'Validate and parse form input data',
    data_create: 'Create a new record in a schema',
    data_query: 'Query records from a schema',
    data_update: 'Update existing records in a schema',
    data_delete: 'Delete records from a schema',
    email_handler: 'Send an email notification',
    response_handler: 'Define the HTTP response to return',
    proxy_forward: 'Forward the request to another service',
    function_handler: 'Execute custom JavaScript code',
    aggregate_handler: 'Perform aggregation on array data',
  };
  return descriptions[type] || '';
}
