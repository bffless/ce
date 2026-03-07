/**
 * Handler configuration types for pipeline steps
 */

export interface BaseHandlerConfig {
  condition?: string;
  timeout?: number;
}

export interface FormFieldConfig {
  type: 'string' | 'number' | 'email' | 'boolean';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FormHandlerConfig extends BaseHandlerConfig {
  fields: Record<string, FormFieldConfig>;
  honeypotField?: string;
}

export interface DataCreateHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  fields: Record<string, string>;
}

export interface FilterConfig {
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'like';
  value: string;
}

export interface DataQueryHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  filters?: Record<string, FilterConfig>;
  select?: string[];
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
}

export interface DataUpdateHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  filters: Record<string, { op: 'eq' | 'ne'; value: string }>;
  fields: Record<string, string>;
}

export interface DataDeleteHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  filters: Record<string, { op: 'eq' | 'ne'; value: string }>;
}

export interface EmailHandlerConfig extends BaseHandlerConfig {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

export interface ResponseHandlerConfig extends BaseHandlerConfig {
  status?: number;
  body: string | Record<string, string>;
  headers?: Record<string, string>;
  contentType?: string;
}

export interface AggregateHandlerConfig extends BaseHandlerConfig {
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max';
  field?: string;
}

export type HandlerConfig =
  | FormHandlerConfig
  | DataCreateHandlerConfig
  | DataQueryHandlerConfig
  | DataUpdateHandlerConfig
  | DataDeleteHandlerConfig
  | EmailHandlerConfig
  | ResponseHandlerConfig
  | AggregateHandlerConfig;
