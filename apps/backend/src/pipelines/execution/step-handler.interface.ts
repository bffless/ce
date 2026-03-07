import { PipelineContext, StepResult } from './pipeline-context.interface';
import { HandlerType, PipelineStep } from '../../db/schema';

/**
 * Interface that all step handlers must implement
 */
export interface StepHandler<TConfig = unknown> {
  /**
   * The handler type this implements
   */
  readonly type: HandlerType;

  /**
   * Validate the step configuration
   * @throws ConfigurationError if config is invalid
   */
  validateConfig(config: TConfig): void | Promise<void>;

  /**
   * Execute the step
   * @param context Pipeline context including input and previous step outputs
   * @param step The step definition including config
   * @returns Step result with success status and output
   */
  execute(context: PipelineContext, step: PipelineStep): Promise<StepResult>;
}

/**
 * Base configuration shared by all handlers
 */
export interface BaseHandlerConfig {
  /**
   * Condition expression - if provided, step only runs if this evaluates to true
   */
  condition?: string;

  /**
   * Timeout in milliseconds for this step (default: 30000)
   */
  timeout?: number;
}

/**
 * Configuration for data_create handler
 */
export interface DataCreateHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to create record in
   */
  schemaId: string;

  /**
   * Field mappings: { schemaField: "expression" }
   */
  fields: Record<string, string>;
}

/**
 * Configuration for data_query handler
 */
export interface DataQueryHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to query from
   */
  schemaId: string;

  /**
   * Filter conditions: { field: { op: "eq", value: "expression" } }
   */
  filters?: Record<string, { op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'like'; value: string }>;

  /**
   * Fields to return (null = all)
   */
  select?: string[];

  /**
   * Maximum records to return
   */
  limit?: number;

  /**
   * Offset for pagination
   */
  offset?: number;

  /**
   * Sort field and direction
   */
  orderBy?: { field: string; direction: 'asc' | 'desc' };
}

/**
 * Configuration for data_update handler
 */
export interface DataUpdateHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to update in
   */
  schemaId: string;

  /**
   * Filter to identify records to update
   */
  filters: Record<string, { op: 'eq' | 'ne'; value: string }>;

  /**
   * Field updates: { schemaField: "expression" }
   */
  fields: Record<string, string>;
}

/**
 * Configuration for data_delete handler
 */
export interface DataDeleteHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to delete from
   */
  schemaId: string;

  /**
   * Filter to identify records to delete
   */
  filters: Record<string, { op: 'eq' | 'ne'; value: string }>;
}

/**
 * Configuration for email_handler
 */
export interface EmailHandlerConfig extends BaseHandlerConfig {
  /**
   * Recipient email (can be expression)
   */
  to: string;

  /**
   * Email subject (can use template syntax)
   */
  subject: string;

  /**
   * Email body template (can use template syntax)
   */
  body: string;

  /**
   * Reply-to address (optional, can be expression)
   */
  replyTo?: string;
}

/**
 * Configuration for response_handler
 */
export interface ResponseHandlerConfig extends BaseHandlerConfig {
  /**
   * HTTP status code
   */
  status?: number;

  /**
   * Response body (can be expression or template)
   */
  body: string | Record<string, string>;

  /**
   * Response headers
   */
  headers?: Record<string, string>;

  /**
   * Content type (default: application/json)
   */
  contentType?: string;
}

/**
 * Configuration for form_handler (parses and validates form data)
 */
export interface FormHandlerConfig extends BaseHandlerConfig {
  /**
   * Field validations
   */
  fields: Record<
    string,
    {
      type: 'string' | 'number' | 'email' | 'boolean';
      required?: boolean;
      min?: number;
      max?: number;
      pattern?: string;
    }
  >;

  /**
   * Honeypot field name for spam detection
   */
  honeypotField?: string;
}

/**
 * Configuration for aggregate_handler (performs aggregation operations on arrays)
 */
export interface AggregateHandlerConfig extends BaseHandlerConfig {
  /**
   * Aggregation operation to perform
   */
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max';

  /**
   * Field to aggregate (required for sum, avg, min, max)
   */
  field?: string;
}
