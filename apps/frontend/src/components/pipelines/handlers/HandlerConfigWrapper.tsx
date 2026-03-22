import { useCallback } from 'react';
import type { HandlerType } from '@/services/pipelinesApi';
import { FormHandlerConfig } from './FormHandlerConfig';
import { DataCreateConfig } from './DataCreateConfig';
import { DataQueryConfig } from './DataQueryConfig';
import { DataUpdateConfig } from './DataUpdateConfig';
import { DataDeleteConfig } from './DataDeleteConfig';
import { EmailHandlerConfig } from './EmailHandlerConfig';
import { ResponseHandlerConfig } from './ResponseHandlerConfig';
import { DbAggregateConfig } from './DbAggregateConfig';
import { FunctionHandlerConfig } from './FunctionHandlerConfig';
import { AIHandlerConfig } from './AIHandlerConfig';
import { FileUploadHandlerConfig } from './FileUploadHandlerConfig';
import { FileServeHandlerConfig } from './FileServeHandlerConfig';
import { ImageConvertHandlerConfig } from './ImageConvertHandlerConfig';
import { ReplicateHandlerConfig } from './ReplicateHandlerConfig';
import { EmbedStoreConfig } from './EmbedStoreConfig';
import { VectorSearchConfig } from './VectorSearchConfig';
import { HttpRequestConfig } from './HttpRequestConfig';
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
            previousSteps={previousSteps}
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
            previousSteps={previousSteps}
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
            previousSteps={previousSteps}
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
            previousSteps={previousSteps}
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
            previousSteps={previousSteps}
          />
        </>
      );

    case 'db_aggregate':
      return (
        <>
          {renderVariablesPanel()}
          <DbAggregateConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
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

    case 'ai_handler':
      return (
        <>
          {renderVariablesPanel()}
          <AIHandlerConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'file_upload_handler':
      return (
        <>
          {renderVariablesPanel()}
          <FileUploadHandlerConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'file_serve_handler':
      return (
        <FileServeHandlerConfig
          config={config}
          onChange={handleChange}
        />
      );

    case 'image_convert_handler':
      return (
        <>
          {renderVariablesPanel()}
          <ImageConvertHandlerConfig
            config={config}
            onChange={handleChange}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'replicate':
      return (
        <>
          {renderVariablesPanel()}
          <ReplicateHandlerConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'embed_store':
      return (
        <>
          {renderVariablesPanel()}
          <EmbedStoreConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'vector_search':
      return (
        <>
          {renderVariablesPanel()}
          <VectorSearchConfig
            config={config}
            onChange={handleChange}
            projectId={projectId}
            previousSteps={previousSteps}
          />
        </>
      );

    case 'http_request':
      return (
        <>
          {renderVariablesPanel()}
          <HttpRequestConfig
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
    db_aggregate: 'DB Aggregate',
    ai_handler: 'AI',
    file_upload_handler: 'File Upload',
    file_serve_handler: 'File Serve',
    image_convert_handler: 'Image Convert',
    replicate: 'Replicate AI',
    embed_store: 'Store Embedding',
    vector_search: 'Vector Search',
    http_request: 'HTTP Request',
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
    db_aggregate: 'Aggregate directly from database (sum, count, avg, min, max)',
    ai_handler: 'Call an AI model for chat or text completion',
    file_upload_handler: 'Upload a file to storage and create a metadata record',
    file_serve_handler: 'Serve a file from storage with caching headers',
    image_convert_handler: 'Convert an image to a different format (e.g., HEIC to PNG)',
    replicate: 'Call a Replicate ML model (embeddings, image gen, transcription, etc.)',
    embed_store: 'Store embedding vectors in pgvector for similarity search',
    vector_search: 'Search stored embeddings by cosine similarity',
    http_request: 'Make an outbound HTTP request to an external URL',
  };
  return descriptions[type] || '';
}
