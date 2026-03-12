/**
 * Handler configuration types for pipeline steps
 */

export type ModelTier = 'economy' | 'balanced' | 'premium';

export interface ModelInfo {
  id: string;
  name: string;
  tier: ModelTier;
  description?: string;
}

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
  /** Find a specific record by its ID (table column). Returns single object or null. */
  recordId?: string;
  /** When true, returns a single object instead of an array */
  single?: boolean;
  filters?: Record<string, FilterConfig>;
  /** How to combine multiple filters: 'and' (all must match) or 'or' (any must match). Default: 'and' */
  filterLogic?: 'and' | 'or';
  select?: string[];
  limit?: number;
  offset?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
}

export interface DataUpdateHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  /** Find a specific record by its ID (table column). Ignores filters when set. */
  recordId?: string;
  filters?: Record<string, { op: 'eq' | 'ne'; value: string }>;
  /** How to combine multiple filters: 'and' (all must match) or 'or' (any must match). Default: 'and' */
  filterLogic?: 'and' | 'or';
  /** When true, updates only first match and returns single object (or null). Default: false */
  single?: boolean;
  fields: Record<string, string>;
}

export interface DataDeleteHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  /** Find a specific record by its ID (table column). Ignores filters when set. */
  recordId?: string;
  filters?: Record<string, { op: 'eq' | 'ne'; value: string }>;
  /** How to combine multiple filters: 'and' (all must match) or 'or' (any must match). Default: 'and' */
  filterLogic?: 'and' | 'or';
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

export interface ProxyForwardConfig extends BaseHandlerConfig {
  /** Target URL to forward the request to (supports template expressions) */
  targetUrl: string;
  /** HTTP method to use (defaults to original request method if not specified) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Headers to add/override on the forwarded request */
  headers?: Record<string, string>;
  /** Whether to include the original request body */
  includeBody?: boolean;
  /** Whether to include original request headers */
  includeOriginalHeaders?: boolean;
  /** Timeout in milliseconds for the proxy request */
  timeout?: number;
}

export interface AggregateHandlerConfig extends BaseHandlerConfig {
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max';
  field?: string;
}

export interface FunctionHandlerConfig extends BaseHandlerConfig {
  code: string;
  timeout?: number;
  /** Include execution metadata (__functionMeta) in output. Default: false */
  debug?: boolean;
}

export interface AIHandlerConfig extends BaseHandlerConfig {
  /**
   * Handler mode:
   * - 'chat': For useChat integration. Client sends messages array.
   * - 'completion': One-off AI processing with templated message.
   * Default: 'completion'
   */
  mode?: 'chat' | 'completion';
  /** AI provider to use ('openai' | 'anthropic' | 'google'). Uses default if not specified. */
  provider?: 'openai' | 'anthropic' | 'google';
  /** Model to use (e.g., 'gpt-4o', 'claude-sonnet-4-6'). Uses provider's default if not specified. */
  model?: string;
  /** Response mode: 'stream' for SSE, 'message' for JSON. Default based on mode. */
  responseMode?: 'stream' | 'message';
  /** System prompt for the AI assistant. Configured server-side for security. */
  systemPrompt?: string;
  /** [Completion mode] Message template. Supports {{steps.form.field}} syntax. Default: 'message' */
  messageField?: string;
  /** [Chat mode] Field in input containing conversation history. Default: 'messages' */
  messagesField?: string;
  /** Maximum number of history messages to include. Default: 50 */
  maxHistoryMessages?: number;
  /** Maximum tokens to generate. Default: 4096 */
  maxTokens?: number;
  /** Temperature for generation (0-2). Default: 0.7 */
  temperature?: number;
  /** Schema ID for conversations table (for automatic updates) */
  conversationsSchemaId?: string;
  /** Schema ID for messages table (for automatic saving) */
  messagesSchemaId?: string;
}

// Backwards compatibility alias
export type ChatHandlerConfig = AIHandlerConfig;

export type HandlerConfig =
  | FormHandlerConfig
  | DataCreateHandlerConfig
  | DataQueryHandlerConfig
  | DataUpdateHandlerConfig
  | DataDeleteHandlerConfig
  | EmailHandlerConfig
  | ResponseHandlerConfig
  | ProxyForwardConfig
  | AggregateHandlerConfig
  | FunctionHandlerConfig
  | AIHandlerConfig;
