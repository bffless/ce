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

export interface XmlFeedParseHandlerConfig extends BaseHandlerConfig {
  /** Expression resolving to a feed URL or array of URLs. Mutually exclusive with xml. */
  urls?: string;
  /** Expression resolving to raw feed XML. Mutually exclusive with urls. */
  xml?: string;
  /** Max feeds fetched concurrently (default 8). */
  concurrency?: number;
  /** Per-feed fetch timeout in ms (default 30000). */
  timeoutMs?: number;
}

export interface DataUpsertManyHandlerConfig extends BaseHandlerConfig {
  /** Target schema ID. */
  schemaId: string;
  /** Expression resolving to the source array. */
  items: string;
  /** Per-column field mappings; each array element is exposed as steps.item. */
  map: Record<string, string>;
  /** Schema column that stores the dedup key. */
  dedupField: string;
  /** Expression, or an ordered fallback chain, computing each item's dedup value. */
  dedupKey: string | string[];
}

export interface FilterConfig {
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'in';
  value: string | string[];
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
  filters?: Record<string, { op: 'eq' | 'ne' | 'in'; value: string | string[] }>;
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
  /**
   * [Completion mode] Attachments for the user message. Each source is an
   * expression resolving to a URL or an array of URLs (arrays fan out into
   * one part per URL). mediaType is required for type 'file'.
   */
  attachments?: Array<{ type: 'image' | 'file'; source: string; mediaType?: string }>;
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
  /** Storage sub-directory. Supports expressions, e.g. "projects/{{request.body.projectId}}". */
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
  /** Serve from this sub-directory; the file path is derived from the request URL. Mutually exclusive with key. */
  subDir?: string;
  /** Serve this explicit object, relative to the uploads root (supports expressions). Mutually exclusive with subDir. */
  key?: string;
  cacheMaxAge?: number;
  /** Serve as an attachment when this resolves truthy (e.g. `request.query.download`). Omit for inline. */
  download?: boolean | string;
}

export interface FileDeleteHandlerConfig extends BaseHandlerConfig {
  /** Delete every object under this prefix, relative to the uploads root (supports expressions). Mutually exclusive with key. */
  prefix?: string;
  /** Delete a single object, relative to the uploads root (supports expressions). Mutually exclusive with prefix. */
  key?: string;
  /** Delete a set of unrelated objects sharing no common prefix (e.g. a Site manifest's assets), each relative to the uploads root (each supports expressions). Mutually exclusive with prefix and key. */
  keys?: string[];
  /** List/report what would be deleted but delete nothing. Default: false */
  dryRun?: boolean;
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
  /**
   * Whether to treat 4xx/5xx HTTP responses as step failures.
   *
   * - `true` (default): non-2xx halts the pipeline with HTTP_REQUEST_ERROR.
   * - `false`: any HTTP response returns a structured output `{ ok, status, statusText, body }`
   *   so the next step can branch on `steps.<name>.ok`. Useful for health probes, polling,
   *   and any case where a non-2xx is a normal outcome.
   *
   * Network errors and timeouts still fail the step regardless.
   */
  failOnError?: boolean;
}

/**
 * Mirrors the backend's `RemoteRequestHandlerConfig`.
 *
 * Unlike http_request there is no `url`: the target is a NAMED connection an
 * admin configured on this instance (Settings → Infrastructure → Remote
 * connections), which supplies the base URL and the identity. A step can
 * therefore never point CE's platform credentials at an arbitrary host.
 */
export interface RemoteRequestHandlerConfig extends BaseHandlerConfig {
  /** Name of an admin-configured remote connection. */
  connection: string;
  /** Path appended to the connection's URL; expression or template. Default: '/' */
  path?: string;
  /** HTTP method. Default: POST */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body expression, or a map of { field: expression }. Never sent on GET. */
  body?: string | Record<string, string>;
  /** Extra headers (values are expressions). `Authorization` is rejected server-side. */
  headers?: Record<string, string>;
  /** How long CE holds the request open, in SECONDS. Default: 300 */
  timeoutSeconds?: number;
  /** Treat a non-2xx response as a step failure. Default: true */
  failOnError?: boolean;
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
  | FileDeleteHandlerConfig
  | ImageConvertHandlerConfig
  | ReplicateHandlerConfig
  | EmbedStoreHandlerConfig
  | VectorSearchHandlerConfig
  | HttpRequestHandlerConfig
  | RemoteRequestHandlerConfig
  | SignedUrlHandlerConfig
  | PresignedUploadHandlerConfig
  | RegisterUploadHandlerConfig
  | StripeCheckoutHandlerConfig
  | StripeWebhookHandlerConfig
  | XmlFeedParseHandlerConfig
  | DataUpsertManyHandlerConfig
  | DelayHandlerConfig
  | FfmpegHandlerConfig
  | McpHandlerConfig
  | OAuthProtectedResourceHandlerConfig;

export interface SignedUrlHandlerConfig extends BaseHandlerConfig {
  /** Storage key / path (supports expressions, e.g. "steps.upload.storage_path") */
  path: string;
  /** URL expiration in seconds. Default: 3600 */
  expiresIn?: number;
}

export interface PresignedUploadHandlerConfig extends BaseHandlerConfig {
  /** Storage sub-directory. Supports expressions, e.g. "projects/{{request.body.projectId}}". */
  subDir: string;
  /** Expression resolving to the upload filename. Default: request.body.filename */
  filename?: string;
  /** Organize files in YYYY-MM-DD folders */
  dateBucket?: boolean;
  /** Presigned URL expiration in seconds. Default: 3600 */
  expiresIn?: number;
  /** Max file size hint (bytes), echoed to the client and enforced at register */
  maxFileSize?: number;
  /** Allowed MIME type patterns, echoed to the client and enforced at register */
  allowedMimeTypes?: string[];
}

export interface RegisterUploadHandlerConfig extends BaseHandlerConfig {
  /** Schema where the upload metadata record is stored */
  schemaId: string;
  /** Storage sub-directory the file was uploaded into (should match presigned_upload). Supports expressions. */
  subDir: string;
  /** Expression resolving to the storageKey from presigned_upload. Default: request.body.storageKey */
  storageKey?: string;
  /** Expression resolving to the display filename. Default: request.body.originalName */
  originalName?: string;
  /** Max allowed file size in bytes (enforced against the uploaded object). Default: 500MB */
  maxFileSize?: number;
  /** Allowed MIME type patterns (enforced against the object's content-type when known) */
  allowedMimeTypes?: string[];
  /** Delete the uploaded object if it fails validation. Default: true */
  deleteOnViolation?: boolean;
  /** Map additional fields to schema fields */
  extraFields?: Record<string, string>;
}

export interface DelayHandlerConfig extends BaseHandlerConfig {
  /** Delay in milliseconds. Supports expressions. Capped at 60000. */
  ms?: number | string;
  /** Delay in seconds (converted to ms). Supports expressions. Ignored if `ms` is set. */
  seconds?: number | string;
}

/**
 * MIRROR of `FfmpegOperation` in
 * apps/backend/src/pipelines/execution/step-handler.interface.ts.
 *
 * There is no import path between the two files (the frontend tsconfig is
 * `include: ["src"]` with a sole `@/*` alias), so `tsc` cannot see a
 * divergence. The gate that can is
 * apps/backend/src/pipelines/handlers/ffmpeg-operations-mirror.spec.ts, which
 * parses BOTH files and fails when the lists disagree — the convention has
 * already drifted twice, in both directions.
 */
export type FfmpegOperation = 'probe' | 'extract_audio' | 'slice' | 'concat' | 'frames';

/** Where a drawn overlay sits in the frame. A closed enum — callers never write an x/y expression. */
export type OverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** frames: one line of text burned into every still. Mirrors FfmpegDrawConfig in the backend interface. */
export interface FfmpegDrawConfig {
  /**
   * The text, drawn verbatim. One string draws the same line on every still;
   * an array draws its own line on each and must be exactly as long as `times`.
   * A STRING is resolved as an expression only when it has the shape of a whole
   * path (`steps.chapters.titles`); an authored ARRAY is always literals, which
   * is the escape hatch for text that looks like a path (`["metadata.json"]`).
   * `{{...}}` is rejected, not drawn.
   */
  text: string | string[];
  /** Which corner. Default 'bottom-right'. */
  position?: OverlayPosition;
  /** Font height as a FRACTION of frame height, 0.005-1. Default 1/12. Out of range is a config error, never clamped. */
  size?: number;
  /** An ffmpeg colour NAME or 0xRRGGBB/#RRGGBB — no @alpha. Default 'white'. */
  color?: string;
  /** Draw the dark box behind the text. Default true; the strings 'false'/'0'/'no'/'off' also mean off. */
  background?: boolean | string;
}

/** frames: tile the stills into contact sheets instead of uploading them one by one. Mirrors FfmpegTileConfig. */
export interface FfmpegTileConfig {
  /** Stills per sheet. REQUIRED whenever tile is present. Literal positive integer. */
  perSheet: number;
  /** Grid columns. Default 3. Literal positive integer; a short final sheet lays out at its own narrower width. */
  columns?: number;
}

/**
 * MIRROR of `FfmpegHandlerConfig` in
 * apps/backend/src/pipelines/execution/step-handler.interface.ts — see the
 * note on `FfmpegOperation` above. That file is the authoritative reference
 * for what each field means; these comments are the short form.
 */
export interface FfmpegHandlerConfig extends BaseHandlerConfig {
  operation: FfmpegOperation;
  /** Source object (probe/extract_audio/slice/frames). A TEMPLATE ({{...}} substituted, anything else verbatim). */
  input?: string;
  /** Concat sources, in order (expression resolving to an array also accepted). */
  inputs?: string[] | string;
  /** Kept spans for slice, or an expression resolving to them. */
  spans?: Array<{ start: number | string; end: number | string }> | string;
  /** Destination, uploads-relative. Required for extract_audio/slice/concat (frames uses outputPrefix). */
  output?: string;
  /** slice only: also emit the clip's 16 kHz WAV here. */
  audioOutput?: string;
  /** slice only: ~10 ms audio edge fades per span. */
  audioFades?: boolean;
  /** frames: destination DIRECTORY, uploads-relative. A TEMPLATE ({{...}} substituted, anything else verbatim). */
  outputPrefix?: string;
  /** frames: capture times in source seconds — an array (entries may be BARE expressions) or a bare expression resolving to one. Not {{...}}. */
  times?: Array<number | string> | string;
  /**
   * frames: output height in px, width follows the aspect ratio. Default 720.
   * A literal number only — NOT template-resolvable.
   */
  height?: number;
  /**
   * frames: jpeg quality of each still, ffmpeg -q:v (2 = best, 31 = worst).
   * Default 3. A literal number only — NOT template-resolvable. A tiled sheet
   * is always -q:v 3.
   */
  quality?: number;
  /** frames: burn one line of text into every still. Omit for clean stills. */
  draw?: FfmpegDrawConfig;
  /** frames: tile the stills into contact sheets instead of uploading them individually. Omit to upload each still. */
  tile?: FfmpegTileConfig;
  /**
   * Which executor runs the job: 'local' (this backend) | 'remote' (Worker) | a
   * `{{expression}}` resolving to one. Default: the instance's default executor.
   */
  executor?: 'local' | 'remote' | string;
}

export interface StripeCheckoutLineItem {
  price: string;
  quantity?: string;
}

export interface StripeCheckoutSubscriptionData {
  /** Expression resolving to a number of days (e.g. "30" for one free month). */
  trialPeriodDays?: string;
}

/**
 * Server-side discount. Provide exactly one of `coupon` or `promotionCode`.
 * Mutually exclusive with `allowPromotionCodes`.
 */
export interface StripeCheckoutDiscount {
  coupon?: string;
  /** Promotion Code object ID (promo_xxx), not the human-readable code. */
  promotionCode?: string;
}

export interface StripeCheckoutHandlerConfig extends BaseHandlerConfig {
  /** Single Price ID (legacy). Use `lineItems` for multi-price checkouts. */
  priceId?: string;
  /** Multiple line items — required for bundling one-time + recurring prices. */
  lineItems?: StripeCheckoutLineItem[];
  mode?: 'payment' | 'subscription';
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  clientReferenceId?: string;
  /** Quantity for the legacy `priceId` field. Ignored when `lineItems` is set. */
  quantity?: string;
  metadata?: Record<string, string>;
  environment?: 'sandbox' | 'production';
  allowPromotionCodes?: boolean;
  /** Server-side discounts. Mutually exclusive with `allowPromotionCodes`. */
  discounts?: StripeCheckoutDiscount[];
  /** Subscription-mode-only options (free trial, etc.) */
  subscriptionData?: StripeCheckoutSubscriptionData;
}

export interface StripeWebhookHandlerConfig extends BaseHandlerConfig {
  allowedEventTypes?: string[];
  environment?: 'sandbox' | 'production';
}

/**
 * `mcp_handler` — the step answers as a stateless MCP server: tools and
 * `ui://` resources mapped to sibling rules of the same alias. The form
 * editor lives in `./mcp/`; see `mcp/model.ts` for the normalized shape.
 */
export interface McpHandlerConfig extends BaseHandlerConfig {
  serverInfo: { name: string; version: string };
  instructions?: string;
  protocolVersions?: string[];
  tools: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    visibility?: Array<'model' | 'app'>;
    _meta?: Record<string, unknown>;
    rule: { path: string; method?: 'GET' | 'POST' };
  }[];
  resources?: {
    static?: {
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
      rule: { path: string; method?: 'GET' };
    }[];
    templates?: {
      uriTemplate: string;
      name: string;
      description?: string;
      mimeType?: string;
      rule: { path: string };
    }[];
    list?: { rule: { path: string; method?: 'GET' } };
    csp?: { connectDomains?: string[]; resourceDomains?: string[] };
  };
}

/**
 * `oauth_protected_resource` — the RFC 9728 discovery document for the
 * `mcp_handler` at `resource`. Every URL comes from the request and the
 * instance; a rule carrying it is served regardless of deployment visibility.
 */
export interface OAuthProtectedResourceHandlerConfig extends BaseHandlerConfig {
  /** The MCP endpoint's path on this host, e.g. `/api/mcp`. */
  resource: string;
  /** `scopes_supported` verbatim; omitted = derived from the MCP rule's sibling `requiredScopes`. */
  scopes?: string[];
  /** `resource_name`; defaults to the MCP server's `serverInfo.name`. */
  resourceName?: string;
  /** `resource_documentation`, a URL. */
  resourceDocumentation?: string;
}
