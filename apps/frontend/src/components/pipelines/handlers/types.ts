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
  limit?: number | string;
  offset?: number | string;
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

export interface DbAggregateHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'array_length';
  field?: string;
  filters?: Record<string, FilterConfig>;
  filterLogic?: 'and' | 'or';
  groupBy?: string;
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
  /**
   * Skills configuration for AI agent capabilities.
   * Skills are markdown files with specialized knowledge that the AI can load on demand.
   */
  skills?: {
    /**
     * Skills mode:
     * - 'none': Disable skills (default)
     * - 'all': Enable all discovered skills from the deployment
     * - 'selected': Enable only specified skills
     */
    mode: 'none' | 'all' | 'selected';
    /**
     * Skill names to enable when mode is 'selected'.
     */
    enabled?: string[];
  };
  /**
   * Plugins configuration for AI tool plugins.
   * Controls which project-enabled plugins are available to this pipeline step.
   */
  plugins?: {
    /**
     * Plugins mode:
     * - 'none': Disable plugins (default)
     * - 'all': Enable all project-enabled plugins
     * - 'selected': Enable only specified plugins
     */
    mode: 'none' | 'all' | 'selected';
    /**
     * Plugin IDs to enable when mode is 'selected'.
     */
    enabled?: string[];
  };
  /** Schema ID for conversations table (for automatic updates) */
  conversationsSchemaId?: string;
  /** Schema ID for messages table (for automatic saving) @deprecated Use persistMessages instead */
  messagesSchemaId?: string;
  /** Enable automatic message persistence for chat mode with streaming. Default: false */
  persistMessages?: boolean;
  /** Schema ID for storing messages when persistMessages is enabled */
  persistMessagesSchemaId?: string;
  /** Schema ID for conversations - if provided, handler will create/update conversation records */
  persistConversationsSchemaId?: string;
  /**
   * Expression for the conversation ID. Default: 'request.body.id' (useChat sends id in request)
   */
  conversationIdField?: string;
  /**
   * [Advanced] Custom field mappings for the user message record.
   * If not provided, uses smart defaults for standard _messages schema.
   * Special variables: __userContent, __conversationId
   */
  userMessageFields?: Record<string, string>;
  /**
   * [Advanced] Custom field mappings for the AI response record.
   * If not provided, uses smart defaults for standard _messages schema.
   * Special variables: __aiContent, __tokensUsed, __finishReason, __conversationId
   */
  aiResponseFields?: Record<string, string>;
  /** Extra fields merged into every saved message record. { schemaField: "expression" } */
  extraMessageFields?: Record<string, string>;
  /** Extra fields merged into conversation record on creation. { schemaField: "expression" } */
  extraConversationFields?: Record<string, string>;
}

// Backwards compatibility alias
export type ChatHandlerConfig = AIHandlerConfig;

export interface FileUploadHandlerConfig extends BaseHandlerConfig {
  schemaId: string;
  subDir: string;
  dateBucket?: boolean;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  extraFields?: Record<string, string>;
  fileField?: string;
  /** Download a file from a URL instead of multipart form. Supports expressions (e.g., steps.replicate_ai.output). */
  sourceUrl?: string;
  /** Override the stored filename. Supports expressions (e.g., request.body.name). */
  filename?: string;
  /** Convert uploaded image to a different format (e.g., HEIC → PNG). */
  convertTo?: 'png' | 'jpeg' | 'webp';
}

export interface ImageConvertHandlerConfig extends BaseHandlerConfig {
  /** Expression resolving to the storage path of the input file */
  inputPath: string;
  /** Target image format. Default: 'png' */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** Quality for lossy formats (1-100). Default: 90 */
  quality?: number;
}

export interface FileServeHandlerConfig extends BaseHandlerConfig {
  subDir: string;
  cacheMaxAge?: number;
}

export interface ReplicateHandlerConfig extends BaseHandlerConfig {
  /** Replicate model identifier (e.g., 'andreasjansson/clip-features') */
  model: string;
  /** Pin a specific model version hash */
  version?: string;
  /** Input field mappings: { modelInputName: "expression" } */
  input: Record<string, string>;
  /** Extract a specific key from the prediction output */
  outputField?: string;
}

export interface EmbedStoreHandlerConfig extends BaseHandlerConfig {
  /** Schema ID the pipeline_data record belongs to */
  schemaId: string;
  /** Expression resolving to the pipeline_data record ID */
  recordId: string;
  /** Field name for the embedding (used for HNSW index grouping) */
  fieldName: string;
  /** Expression resolving to number[] (single embedding). For 1:1 mode. */
  embedding?: string;
  /** Expression resolving to array of { embedding, text?, metadata? }. For 1:N chunked mode. */
  chunks?: string;
  /** Optional metadata expression (resolves to object) */
  metadata?: string;
}

export interface VectorSearchHandlerConfig extends BaseHandlerConfig {
  /** Schema ID to search embeddings within */
  schemaId: string;
  /** Field name to search (must match embed_store fieldName) */
  fieldName: string;
  /** Expression resolving to number[] (the query vector) */
  queryVector: string;
  /** Max results to return. Default: 10 */
  limit?: number;
  /** Minimum cosine similarity threshold (0-1) */
  threshold?: number;
  /** Data fields to include in results (null = all) */
  select?: string[];
}

export interface HttpRequestHandlerConfig extends BaseHandlerConfig {
  /** Target URL (can be expression) */
  url: string;
  /** HTTP method. Default: GET */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Forward auth cookies and Authorization header from original request */
  forwardAuth?: boolean;
  /** Request body expression (for POST/PUT/PATCH) */
  body?: string | Record<string, string>;
  /** Additional headers to send (values can be expressions) */
  headers?: Record<string, string>;
  /** Headers to forward from the original request */
  forwardHeaders?: string[];
}

export type HandlerConfig =
  | FormHandlerConfig
  | DataCreateHandlerConfig
  | DataQueryHandlerConfig
  | DataUpdateHandlerConfig
  | DataDeleteHandlerConfig
  | EmailHandlerConfig
  | ResponseHandlerConfig
  | ProxyForwardConfig
  | DbAggregateHandlerConfig
  | FunctionHandlerConfig
  | AIHandlerConfig
  | FileUploadHandlerConfig
  | FileServeHandlerConfig
  | ImageConvertHandlerConfig
  | ReplicateHandlerConfig
  | EmbedStoreHandlerConfig
  | VectorSearchHandlerConfig
  | HttpRequestHandlerConfig
  | SignedUrlHandlerConfig
  | StripeCheckoutHandlerConfig
  | StripeWebhookHandlerConfig;

export interface SignedUrlHandlerConfig extends BaseHandlerConfig {
  /** Storage key / path (supports expressions, e.g. "steps.upload.storage_path") */
  path: string;
  /** URL expiration in seconds. Default: 3600 */
  expiresIn?: number;
}

export interface StripeCheckoutHandlerConfig extends BaseHandlerConfig {
  priceId: string;
  mode?: 'payment' | 'subscription';
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  clientReferenceId?: string;
  quantity?: string;
  metadata?: Record<string, string>;
  environment?: 'sandbox' | 'production';
}

export interface StripeWebhookHandlerConfig extends BaseHandlerConfig {
  allowedEventTypes?: string[];
  environment?: 'sandbox' | 'production';
}
