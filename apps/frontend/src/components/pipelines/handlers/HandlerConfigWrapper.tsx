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
import type { HandlerConfig } from './types';

interface HandlerConfigWrapperProps {
  handlerType: HandlerType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  projectId: string;
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
}: HandlerConfigWrapperProps) {
  // Wrap onChange to ensure proper typing
  const handleChange = useCallback(
    (newConfig: HandlerConfig) => {
      onChange(newConfig as unknown as Record<string, unknown>);
    },
    [onChange],
  );

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
        <DataCreateConfig
          config={config}
          onChange={handleChange}
          projectId={projectId}
        />
      );

    case 'data_query':
      return (
        <DataQueryConfig
          config={config}
          onChange={handleChange}
          projectId={projectId}
        />
      );

    case 'data_update':
      return (
        <DataUpdateConfig
          config={config}
          onChange={handleChange}
          projectId={projectId}
        />
      );

    case 'data_delete':
      return (
        <DataDeleteConfig
          config={config}
          onChange={handleChange}
          projectId={projectId}
        />
      );

    case 'email_handler':
      return (
        <EmailHandlerConfig
          config={config}
          onChange={handleChange}
        />
      );

    case 'response_handler':
      return (
        <ResponseHandlerConfig
          config={config}
          onChange={handleChange}
        />
      );

    case 'aggregate_handler':
      return (
        <AggregateHandlerConfig
          config={config}
          onChange={handleChange}
        />
      );

    case 'function_handler':
      return (
        <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-md">
          Function handler configuration is not yet available.
          This handler type is reserved for future custom JavaScript functions.
        </div>
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
    function_handler: 'Execute custom JavaScript code',
    aggregate_handler: 'Perform aggregation on array data',
  };
  return descriptions[type] || '';
}
