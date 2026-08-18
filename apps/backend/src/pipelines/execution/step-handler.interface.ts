import type { AIAttachmentConfig } from '../handlers/ai-attachments.util';
import type { DataFilters } from '../handlers/filter-where.util';
import { PipelineContext, StepResult } from './pipeline-context.interface';
import { HandlerType, PipelineStep } from '../types';

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
   * Find a specific record by its ID (table column, not JSON field).
   * When specified, returns a single object (or null if not found).
   * Other filters are ignored when recordId is set.
   */
  recordId?: string;

  /**
   * When true, returns a single object instead of an array.
   * Returns the first matching record or null if none found.
   * @default false
   */
  single?: boolean;

  /**
   * Filter conditions on JSON data fields: { field: { op: "eq", value: "expression" } }
   * Operators: eq, ne, gt, lt, gte, lte, like, in (see handlers/filter-where.util).
   */
  filters?: DataFilters;

  /**
   * How to combine multiple filters: 'and' (all must match) or 'or' (any must match)
   * @default 'and'
   */
  filterLogic?: 'and' | 'or';

  /**
   * Fields to return (null = all)
   */
  select?: string[];

  /**
   * Maximum records to return (number or expression)
   */
  limit?: number | string;

  /**
   * Offset for pagination (number or expression)
   */
  offset?: number | string;

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
   * Find a specific record by its ID (table column, not JSON field).
   * When specified, filters are ignored.
   */
  recordId?: string;

  /**
   * Filter to identify records to update (ignored if recordId is set).
   * Same operator set as data_query; range ops (gt/lt/gte/lte) cast the field
   * to numeric, so the stored value must be numeric (e.g. epoch-ms timestamps).
   */
  filters?: DataFilters;

  /**
   * How to combine multiple filters: 'and' (all must match) or 'or' (any must match)
   * @default 'and'
   */
  filterLogic?: 'and' | 'or';

  /**
   * When true, returns a single updated object instead of { count, updated: [] }.
   * Updates only the first matching record and returns it (or null if none found).
   * @default false
   */
  single?: boolean;

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
   * Find a specific record by its ID (table column, not JSON field).
   * When specified, filters are ignored.
   */
  recordId?: string;

  /**
   * Filter to identify records to delete (ignored if recordId is set).
   * Same operator set as data_query; range ops (gt/lt/gte/lte) cast the field
   * to numeric, so the stored value must be numeric (e.g. epoch-ms timestamps).
   */
  filters?: DataFilters;

  /**
   * How to combine multiple filters: 'and' (all must match) or 'or' (any must match)
   * @default 'and'
   */
  filterLogic?: 'and' | 'or';
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
 * Configuration for db_aggregate handler (performs aggregation at the database level)
 */
export interface DbAggregateHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to aggregate from
   */
  schemaId: string;

  /**
   * Aggregation operation to perform
   */
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'array_length';

  /**
   * Field to aggregate (required for sum, avg, min, max, array_length)
   */
  field?: string;

  /**
   * Filter conditions on JSON data fields: { field: { op: "eq", value: "expression" } }
   * Operators: eq, ne, gt, lt, gte, lte, like, in (see handlers/filter-where.util).
   */
  filters?: DataFilters;

  /**
   * How to combine multiple filters: 'and' (all must match) or 'or' (any must match)
   * @default 'and'
   */
  filterLogic?: 'and' | 'or';

  /**
   * Optional JSONB field to group results by.
   * When set, returns an array of { key, value } pairs instead of a single result.
   */
  groupBy?: string;
}

/**
 * Configuration for function_handler (executes custom JavaScript code)
 */
export interface FunctionHandlerConfig extends BaseHandlerConfig {
  /**
   * JavaScript code to execute.
   * The code should return the transformed data.
   * Available variables:
   * - data.input: The pipeline input
   * - data.user: Current user info (id, email, role) if authenticated
   * - data.request: Request info (method, path, query)
   * - data.steps: Output from previous steps (keyed by step name)
   */
  code: string;

  /**
   * Include execution metadata (__functionMeta) in output.
   * Contains executionTime and console logs.
   * @default false
   */
  debug?: boolean;

  /**
   * Execution timeout in milliseconds (1000-30000ms)
   * @default 5000
   */
  timeout?: number;
}

/**
 * Configuration for ai_handler (AI-powered responses)
 */
export interface AIHandlerConfig extends BaseHandlerConfig {
  /**
   * Handler mode:
   * - 'chat': For useChat integration. Reads messages from request body.
   *           Client sends { messages: [...] }, handler streams response.
   * - 'completion': One-off AI processing. Configure system prompt + message template.
   *                 Useful for form processing, content generation, etc.
   * @default 'completion'
   */
  mode?: 'chat' | 'completion';

  /**
   * AI provider to use ('openai' | 'anthropic' | 'google')
   * If not specified, uses the default configured provider.
   */
  provider?: 'openai' | 'anthropic' | 'google';

  /**
   * Model to use (e.g., 'gpt-4o', 'claude-sonnet-4-6')
   * If not specified, uses the provider's default model.
   */
  model?: string;

  /**
   * Response format:
   * - 'stream': Returns Server-Sent Events (SSE) stream for real-time responses
   * - 'message': Returns complete JSON response after generation
   * @default 'stream' for chat mode, 'message' for completion mode
   */
  responseMode?: 'stream' | 'message';

  /**
   * System prompt for the AI assistant.
   * Can be a static string or use template syntax (e.g., "Help user {{input.name}}")
   * Configured server-side for security (not sent from client).
   */
  systemPrompt?: string;

  /**
   * [Completion mode only]
   * The message to send to the AI. Can be:
   * - Simple field name: "message" -> reads request.body.message
   * - Expression: "steps.form.message"
   * - Template: "Name: {{steps.form.name}}, Message: {{steps.form.message}}"
   * @default 'message'
   */
  messageField?: string;

  /**
   * [Completion mode only]
   * Attachments to include with the user message. Each source is an
   * expression that resolves to a URL string or an array of URL strings
   * (e.g. "steps.collect.images"). Arrays fan out into one content part
   * per element; empty/null resolved values are skipped silently.
   * Chat mode ignores this field.
   */
  attachments?: AIAttachmentConfig[];

  /**
   * [Chat mode only]
   * Field in the request body containing conversation history.
   * Expected format: Array of { role: 'user' | 'assistant', content: string }
   * For useChat integration, this is typically 'messages'.
   * @default 'messages'
   */
  messagesField?: string;

  /**
   * Maximum number of history messages to include.
   * Older messages are truncated from the beginning.
   * @default 50
   */
  maxHistoryMessages?: number;

  /**
   * Maximum tokens to generate in the response.
   * @default 4096
   */
  maxTokens?: number;

  /**
   * Temperature for response generation (0-2).
   * Lower values are more deterministic, higher values more creative.
   * @default 0.7
   */
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
     * Each name should match a skill's `name` field in its frontmatter.
     */
    enabled?: string[];

    /**
     * Directory within the deployment holding the `SKILL.md` files, e.g.
     * `apps/studio/dist/bffless/skills`. Falls back to the project-wide
     * `settings.skillsPath` (default `.bffless/skills`) when omitted.
     *
     * Note a deployment can never contain a *nested* dot-directory — the zip
     * importer drops any entry containing `/.` — so an app served under a
     * base path must publish its skills to a non-hidden directory and name it
     * here.
     */
    path?: string;

    /**
     * Deployment alias to load skills from, e.g. a dedicated `skills` alias.
     * Falls back to the project-wide `settings.skillsAlias`, and finally to
     * the deployment serving the request.
     */
    alias?: string;
  };

  /**
   * Plugins configuration for AI tool plugins.
   * Plugins are executable tools (calculator, web search, etc.) enabled at the project level.
   * This controls which project-enabled plugins are available to this specific pipeline step.
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
     * Each ID should match a plugin's `metadata.id` (e.g., 'calculator', 'web-search').
     */
    enabled?: string[];

    /**
     * Per-plugin options configured at the pipeline level.
     * Keys are plugin IDs, values are option objects.
     * e.g., { 'google-calendar': { calendarId: 'demos@group.calendar.google.com' } }
     */
    options?: Record<string, Record<string, unknown>>;
  };

  /**
   * Schema ID for conversations table (for automatic updates).
   * When provided, handler updates token counts after completion.
   */
  conversationsSchemaId?: string;

  /**
   * Schema ID for messages table (for automatic saving).
   * When provided, handler saves both user message and AI response.
   * @deprecated Use persistMessages + userMessageFields/aiResponseFields instead
   */
  messagesSchemaId?: string;

  /**
   * Enable automatic message persistence for chat mode with streaming.
   * When enabled, both user messages and AI responses are saved to the specified schema.
   * @default false
   */
  persistMessages?: boolean;

  /**
   * Schema ID for storing messages when persistMessages is enabled.
   * Required when persistMessages is true.
   * Should be a messages schema with fields: conversation_id, role, content, tokens_used
   */
  persistMessagesSchemaId?: string;

  /**
   * Schema ID for conversations when persistMessages is enabled.
   * Optional - if provided, handler will create/update conversation records.
   * Should be a conversations schema with fields: user_id, title, model, message_count, total_tokens
   */
  persistConversationsSchemaId?: string;

  /**
   * Expression for the conversation ID.
   * Used to link messages to a conversation.
   * For useChat, the conversation ID is sent as 'id' in the request body.
   * @default 'request.body.id'
   */
  conversationIdField?: string;

  /**
   * [Advanced] Custom field mappings for the user message record.
   * If not provided, uses smart defaults for standard _messages schema:
   *   conversation_id = conversationIdField
   *   role = "user"
   *   content = __userContent
   *
   * Special variables available:
   * - __userContent: The user's message content (extracted from messages array)
   */
  userMessageFields?: Record<string, string>;

  /**
   * [Advanced] Custom field mappings for the AI response record.
   * If not provided, uses smart defaults for standard _messages schema:
   *   conversation_id = conversationIdField
   *   role = "assistant"
   *   content = __aiContent
   *   tokens_used = __tokensUsed
   *
   * Special variables available:
   * - __aiContent: The AI's complete response text
   * - __tokensUsed: Total tokens used (input + output)
   * - __finishReason: Why generation stopped ('stop', 'length', etc.)
   */
  aiResponseFields?: Record<string, string>;

  /**
   * Extra fields to merge into every saved message record (both user and AI).
   * { schemaFieldName: "expression" }
   * Evaluated against the pipeline context. Merged after default/custom field mappings.
   */
  extraMessageFields?: Record<string, string>;

  /**
   * Extra fields to merge into the conversation record on creation.
   * { schemaFieldName: "expression" }
   * Evaluated against the pipeline context. Merged after default conversation fields.
   */
  extraConversationFields?: Record<string, string>;
}

/**
 * Configuration for file_upload_handler
 */
export interface FileUploadHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID for storing upload metadata records
   */
  schemaId: string;

  /**
   * Storage sub-directory (e.g. "images", "documents"). Supports expressions for
   * per-project layouts, e.g. "projects/{{request.body.projectId}}". The resolved
   * value must be non-empty and contain no ".." traversal.
   */
  subDir: string;

  /**
   * Enable YYYY-MM-DD date folders in storage path
   * @default false
   */
  dateBucket?: boolean;

  /**
   * Maximum file size in bytes
   * @default 10485760 (10MB)
   */
  maxFileSize?: number;

  /**
   * Allowed MIME type patterns (e.g. ["image/*", "application/pdf"])
   * @default ["*\/*"]
   */
  allowedMimeTypes?: string[];

  /**
   * Extra field mappings: { schemaField: "expression" }
   * Allows mapping additional form fields or expressions to schema fields.
   * Built-in fields (filename, storage_path, etc.) are always included.
   * Example: { "description": "request.body.description", "category": "request.body.category" }
   */
  extraFields?: Record<string, string>;

  /**
   * Form field name for the uploaded file
   * @default "file"
   */
  fileField?: string;

  /**
   * Download a file from a URL instead of reading from multipart form data.
   * When set, the handler fetches this URL, stores the file, and creates records
   * just like a regular upload. Useful for saving output files from external
   * services (e.g., Replicate AI prediction results).
   * Supports expressions (e.g., "steps.replicate_ai.output").
   */
  sourceUrl?: string;

  /**
   * Override the stored filename. Supports expressions (e.g., "request.body.name").
   * The resolved value is sanitized and used instead of the original upload/download filename.
   * File extension from the original file is preserved if not present in the override.
   */
  filename?: string;

  /**
   * Convert the uploaded image to a different format before storing.
   * Uses sharp for conversion. Supported targets: 'png', 'jpeg', 'webp'.
   * Non-image files or files already in the target format are passed through unchanged.
   */
  convertTo?: 'png' | 'jpeg' | 'webp';
}

/**
 * Configuration for image_convert_handler
 */
export interface ImageConvertHandlerConfig extends BaseHandlerConfig {
  /**
   * Expression resolving to the storage path of the input file (e.g., "steps.upload.storage_path")
   */
  inputPath: string;

  /**
   * Target image format to convert to
   * @default 'png'
   */
  outputFormat?: 'png' | 'jpeg' | 'webp';

  /**
   * Quality for lossy formats (jpeg, webp). 1-100.
   * @default 90
   */
  quality?: number;
}

// step-handler.interface.ts — this TSDoc is the authoritative handler reference
// (CE has no per-handler doc pages; agents and humans read this).
export type FfmpegOperation = 'probe' | 'extract_audio' | 'slice' | 'concat';

/** One kept span of source footage, in source seconds. Values may be literals or expressions. */
export interface FfmpegSpan {
  start: number | string;
  end: number | string;
}

/**
 * Server-side video operations on storage objects via a strictly-guarded native
 * ffmpeg child process. Curated operations only — never raw ffmpeg args.
 * Inputs/outputs are storage paths (bytes never enter a request body); place
 * heavy ops in postSteps and poll a job row (the fire-and-poll pattern).
 *
 * Operations:
 * - `probe` — no `input`: capability self-test, never fails; returns
 *   `{ server, ops, version, executors, defaultExecutor, remote? }`, where
 *   `remote` is `{ ready, version?, maxInflight, reason? }` (`version` at the
 *   top level is the LOCAL ffmpeg's; the Worker's is `remote.version`, and
 *   `remote.maxInflight` is the connection's concurrency cap). With `input`:
 *   ffprobe essentials `{ duration, format, streams }`.
 * - `extract_audio` — `input` → `output`: 16 kHz mono WAV (`-vn -ac 1 -ar 16000`).
 * - `slice` — cut the kept `spans` out of `input`, concat into one clip
 *   (libx264 ultrafast/yuv420p/aac/+faststart, A/V-sync-safe trim graph).
 *   Optional `audioOutput` also emits the clip's 16 kHz WAV; `audioFades`
 *   adds ~10 ms edge fades (use for scene assembly).
 * - `concat` — stitch `inputs` (uniformly-encoded clips) into `output`;
 *   stream-copy first, automatic re-encode fallback on stream mismatch.
 *
 * Path forms: inputs accept `{owner}/{repo}/uploads/...`, an uploads-relative
 * path, or an `/api/uploads/...` URL; outputs are uploads-relative. All resolve
 * inside the project's uploads root — traversal is rejected.
 *
 * Executors: `local` runs ffmpeg in this backend; `remote` sends the job to a
 * Worker over signed storage URLs (bucket storage only; see the Server Video Ops
 * docs). Which one a step gets is `executor` if it names one, else the instance
 * default (FFMPEG_EXECUTOR / FFMPEG_REMOTE_CONNECTION, falling back to whatever
 * is configured); asking for
 * one that is not configured or not ready fails with FFMPEG_EXECUTOR_UNAVAILABLE.
 * Every op output additionally reports `executor`, `timings` (queueMs,
 * transferInMs, ffmpegMs, transferOutMs, totalMs), `bytesIn` and `bytesOut`.
 *
 * Server video ops are an opt-in, instance-level admin setting (FFMPEG_HANDLER_ENABLED
 * feature flag, default off). Probe reports server:false when the flag is off OR no
 * enabled executor is ready. For every other operation the two refusals are distinct:
 * the flag being off is FFMPEG_UNAVAILABLE, while the flag being ON with no executor
 * enabled or ready (no ffmpeg binaries, no FFMPEG_REMOTE_URL, worker unreachable) is
 * FFMPEG_EXECUTOR_UNAVAILABLE.
 *
 * Every step is bounded: the queue wait, each storage transfer and the ffmpeg
 * run all have ceilings (FFMPEG_JOB_MAX_SECONDS / FFMPEG_IO_MAX_SECONDS /
 * FFMPEG_MAX_SECONDS), so a step always settles — a stalled one fails with
 * FFMPEG_JOB_TIMEOUT rather than leaving a polled job row 'running' forever.
 */
export interface FfmpegHandlerConfig extends BaseHandlerConfig {
  operation: FfmpegOperation;
  /** Source object (probe / extract_audio / slice). Template-resolved. */
  input?: string;
  /** Source clips for concat, in order: an array or an expression resolving to one. */
  inputs?: string[] | string;
  /** Kept spans for slice: an array (values may be expressions) or an expression resolving to one. */
  spans?: FfmpegSpan[] | string;
  /** Destination path, uploads-relative. Template-resolved. Required except for probe. */
  output?: string;
  /** slice only: also emit the clip's 16 kHz mono WAV to this uploads-relative path. */
  audioOutput?: string;
  /** slice only: ~10 ms audio edge fades per span (assemble parity). Default false. */
  audioFades?: boolean;
  /**
   * Which executor runs the job: 'local' (this backend) | 'remote' (Worker) | a
   * `{{expression}}` resolving to one. Default: the instance's default executor.
   * Unavailable → FFMPEG_EXECUTOR_UNAVAILABLE.
   */
  executor?: 'local' | 'remote' | string;
}

/**
 * Configuration for file_serve_handler
 */
export interface FileServeHandlerConfig extends BaseHandlerConfig {
  /**
   * Storage sub-directory to serve from. The file path is then derived from the
   * request URL under /api/uploads/<subDir>/. Required unless `key` is provided.
   */
  subDir?: string;

  /**
   * Explicit object to serve, RELATIVE to the project's uploads root
   * ({owner}/{repo}/uploads/) — e.g. "content/uuid-styles.css". When provided,
   * the file is served from this key instead of being derived from the request
   * path, and `subDir` is not required. The value is expression-interpolated
   * ({{steps.x.y}}) before use and rejected if it contains "..". The
   * Content-Type is derived from this key's extension. Mirrors file_delete's
   * `key`. Use this to serve a manifest-resolved object in-place (e.g. a Site
   * asset under /api/sites/<id>/<rel>) so relative sub-resources keep resolving
   * same-origin instead of being 302-redirected out of the namespace.
   */
  key?: string;

  /**
   * Cache-Control max-age in seconds
   * @default 3600
   */
  cacheMaxAge?: number;

  /**
   * Cache directive for the served bytes: `'public'` (shared caches / CDNs may
   * store and reuse the response) or anything else, including `'private'`
   * (browser-only; never a shared cache). Pipeline-served files are usually
   * behind app-defined access control that this handler cannot see, so the
   * default is private to avoid a CDN serving ACL-gated content to other
   * users. Set to the literal `'public'` only for content that is genuinely
   * public.
   *
   * Expression-interpolated ({{steps.x.y}}) before use, like `key` — so a
   * prior ACL-gate step can resolve this per request (e.g. `'public'` when
   * the step determines the object is Anyone-viewable, `'private'`
   * otherwise) instead of it being a fixed value for every request through
   * this step. A matching cache rule's own `cacheability` still overrides
   * this.
   * @default 'private'
   */
  cacheability?: string;
}

/**
 * Configuration for file_delete handler.
 *
 * Deletes objects within this project's uploads root
 * ({owner}/{repo}/uploads/). Both `prefix` and `key` are RELATIVE to that
 * root, exactly like `subDir` is for the upload/serve handlers, and both are
 * expression-interpolated ({{steps.x.y}}, {{request.body.z}}) before use.
 * Exactly one of `prefix` or `key` must be provided.
 */
export interface FileDeleteHandlerConfig extends BaseHandlerConfig {
  /**
   * Delete EVERY object whose key starts with this, relative to the uploads
   * root (e.g. "projects/abc123/"). Mutually exclusive with `key`.
   */
  prefix?: string;

  /**
   * Delete a single object, relative to the uploads root
   * (e.g. "projects/abc123/source/uuid-file.mov"). Mutually exclusive with `prefix`.
   */
  key?: string;

  /**
   * Delete a set of unrelated objects, each relative to the uploads root and
   * each expression-interpolated and guarded exactly like `key`. Use this to
   * purge objects that share no common prefix (e.g. a Site manifest's assets).
   * Mutually exclusive with both `prefix` and `key`.
   *
   * Two forms:
   *   - a **static array** of key templates (`["a/b", "content/{{hash}}"]`) when
   *     the set is known at authoring time, or
   *   - a **single expression string** (e.g. `"steps.siteKeys.list"`) that
   *     resolves AT RUNTIME to an array of string keys. Use this when the set is
   *     dynamic and variable-length — a prior step computes it (e.g. parsing a
   *     Site manifest into its object keys). A resolved empty array is a no-op
   *     (`{ deleted: 0 }`), not an error.
   */
  keys?: string[] | string;

  /**
   * When true, list and report what WOULD be deleted but delete nothing.
   * @default false
   */
  dryRun?: boolean;
}

// Backwards compatibility alias
export type ChatHandlerConfig = AIHandlerConfig;

/**
 * Configuration for embed_store handler (stores embeddings in pgvector)
 */
export interface EmbedStoreHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID the pipeline_data record belongs to
   */
  schemaId: string;

  /**
   * Expression that resolves to the pipeline_data record ID
   */
  recordId: string;

  /**
   * Field name to store the embedding under (used for HNSW index grouping)
   */
  fieldName: string;

  /**
   * Expression that resolves to number[] (the embedding vector).
   * For 1:1 mode (single embedding per record).
   */
  embedding?: string;

  /**
   * Expression that resolves to an array of { embedding: number[], text?: string, metadata?: object }.
   * For 1:N mode (chunked documents).
   */
  chunks?: string;

  /**
   * Optional metadata expression (resolves to object) — applied to all embeddings
   */
  metadata?: string;
}

/**
 * Configuration for vector_search handler (cosine similarity search via pgvector)
 */
export interface VectorSearchHandlerConfig extends BaseHandlerConfig {
  /**
   * Schema ID to search embeddings within
   */
  schemaId: string;

  /**
   * Field name to search (must match the fieldName used during embed_store)
   */
  fieldName: string;

  /**
   * Expression that resolves to number[] (the query vector)
   */
  queryVector: string;

  /**
   * Maximum number of results to return
   * @default 10
   */
  limit?: number;

  /**
   * Minimum cosine similarity threshold (0-1). Results below this are excluded.
   */
  threshold?: number;

  /**
   * Optional list of data fields to include in results (null = all)
   */
  select?: string[];
}

/**
 * Configuration for replicate handler (calls Replicate ML models)
 */
export interface ReplicateHandlerConfig extends BaseHandlerConfig {
  /**
   * Replicate model identifier (e.g., 'andreasjansson/clip-features')
   */
  model: string;

  /**
   * Pin a specific model version hash (optional)
   */
  version?: string;

  /**
   * Input field mappings: { modelInputName: "expression" }
   */
  input: Record<string, string>;

  /**
   * Extract a specific key from the prediction output (optional)
   */
  outputField?: string;
}

// SignedUrlHandlerConfig is defined in handlers/signed-url.handler.ts
export type { SignedUrlHandlerConfig } from '../handlers/signed-url.handler';

// HttpRequestHandlerConfig is defined in handlers/http-request.handler.ts
export type { HttpRequestHandlerConfig } from '../handlers/http-request.handler';
