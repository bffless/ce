import type { AIAttachmentConfig } from '../handlers/ai-attachments.util';
import type { OverlayPosition } from '../ffmpeg/ffmpeg-args';
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
export type FfmpegOperation = 'probe' | 'extract_audio' | 'slice' | 'concat' | 'frames';

/** One kept span of source footage, in source seconds. Values may be literals or expressions. */
export interface FfmpegSpan {
  start: number | string;
  end: number | string;
}

/**
 * One line of text burned into every still a `frames` step captures. CE owns
 * the ability to DRAW, not the ability to draw any particular thing: a
 * timestamped contact-sheet cell and a title card on a screenshot are the same
 * block with different values (Ruling R99).
 */
export interface FfmpegDrawConfig {
  /**
   * The text, drawn VERBATIM (it is escaped into the filter graph and never
   * interpreted). One string draws the same line on every still; an array
   * draws its own line on each and must be EXACTLY as long as `times`.
   *
   * Ruling R106 — the two forms differ in how they are READ. A STRING is
   * resolved as an expression only when it has the shape of a whole path
   * (`steps.chapters.titles`, `steps['ch one'].title`), which may resolve to
   * either form; prose that merely begins with an expression root ("user
   * guide") is drawn as written. An authored ARRAY is ALWAYS literals — the
   * escape hatch for text the shape test cannot tell from a path, so
   * `text: ["metadata.json"]` draws that filename where
   * `text: 'metadata.json'` would look it up.
   *
   * `{{...}}` is NOT a template here and is rejected rather than drawn.
   */
  text: string | string[];
  /** Which corner. Default `'bottom-right'`. A closed enum: callers never write an x/y expression. */
  position?: OverlayPosition;
  /** Font height as a FRACTION of the frame height, 0.005..1. Default 1/12. Out of range is a config error, never clamped. */
  size?: number;
  /** An ffmpeg colour NAME or `0xRRGGBB`/`#RRGGBB` — no `@alpha`. Default `'white'`. */
  color?: string;
  /** Draw the dark box behind the text. Default true. String forms ('false'/'0'/'no'/'off') are coerced, since config arrives as YAML/JSON. */
  background?: boolean | string;
}

/**
 * Tile the captured stills into contact sheets instead of uploading them
 * individually. Present → the stills stay in scratch and only the sheets are
 * written to storage.
 */
export interface FfmpegTileConfig {
  /** Stills per sheet. REQUIRED whenever `tile` is present. LITERAL positive integer (the string form is coerced). */
  perSheet: number;
  /** Grid columns. Default 3. LITERAL positive integer; a short final sheet lays out at its own narrower width. */
  columns?: number;
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
 * - `frames` — one still per entry in `times`, with two optional modifiers:
 *   `draw` burns one line of text into every still, and `tile` lays the stills
 *   out into contact sheets instead of uploading them one by one. There is no
 *   separate contact-sheet operation: a sheet is `times` + `tile`, and a title
 *   card on a screenshot is `times: [12.5]` + `draw` and no `tile`. WHAT the
 *   text says and WHERE the times fall are the calling app's policy; CE only
 *   captures and draws.
 *
 *   Without `tile`: each still is written to `<outputPrefix>/frame-NN.jpg`
 *   (1-based, zero-padded to at least two digits and widening past 99, so the
 *   names stay sortable) and the output is
 *   `{ frames: [{ time, storage_path, content_type, size }], count, drawn }`.
 *   `time` is the REQUESTED second, unchanged, so a later step can re-capture
 *   it.
 *
 *   With `tile`: the stills are SCRATCH-ONLY — nothing but the sheets is
 *   declared as a job output, so no executor can upload them — and the output
 *   is `{ sheets: [{ storage_path, content_type, size, times, index, total,
 *   cols, rows }], count, drawn }` over `<outputPrefix>/sheet-NN.jpg`. `times`
 *   are chunked by `tile.perSheet`; each sheet's `cols` is
 *   `min(chunk, tile.columns)` (a short final sheet is narrower) and `rows`
 *   grows to fit. Note `sheets[].index` is 0-based while the FILENAME is
 *   1-based. `count` is the number of STILLS in both modes.
 *
 *   Every `storage_path` is the FULL resolved key —
 *   `{owner}/{repo}/uploads/<prefix>/frame-01.jpg`, not the `outputPrefix` as
 *   written — the same convention `slice`/`extract_audio` already use.
 *
 *   `drawn` is the OUTCOME, not the request: it is `false` when no `draw` was
 *   asked for AND when the ffmpeg running the job turned out to have no
 *   `drawtext` filter (which needs libfreetype + fontconfig and an installed
 *   font; CE's own image has them). A local executor whose `-filters` probe
 *   already reported the filter missing suppresses the draw up front at no
 *   cost; anything else costs ONE retry of the job without the overlay, and
 *   only then. A step never fails merely because an ffmpeg cannot draw.
 *
 *   A `time` past the end of the source encodes nothing and FAILS the step:
 *   the still command carries `-abort_on empty_output`, so it exits non-zero
 *   where some ffmpeg builds would exit 0 having written no file. That flag is
 *   load-bearing in TILE mode — a cell is not a declared output and nothing
 *   stats it, so a silent gap used to reach the tile pass, where `image2`
 *   stops at the hole and `tile` pads the rest: a sheet of `0x111111` squares
 *   whose reported `times` claimed real frames.
 *
 *   Two consequences worth knowing before you write `times`:
 *
 *   - **A time can be too late while still being inside `duration`.** The
 *     reported duration is not the last frame's timestamp: on a 5.000 s clip
 *     at 10 fps the last frame's PTS is 4.9, and `-ss 4.9` captures while
 *     `-ss 4.99` exits 234 and fails the step (measured). A sampler that
 *     spreads times across a clip and clamps the last one to the end will meet
 *     this on low-fps sources. Keep the final sample at least one frame
 *     interval clear of the end (`duration - 1/fps`, or simply a few tenths of
 *     a second) rather than at `duration`.
 *   - **The failure no longer names WHICH still.** ffmpeg's exit-234 stderr
 *     carries no filename, so a failing still reports the cause ("ffmpeg wrote
 *     no image there, which usually means a requested time is past the end of
 *     the source") without saying which time caused it — where the older
 *     exit-0 path could name `frame-02.jpg`. That is a real diagnosability
 *     regression, accepted because the alternative was a tiled sheet of
 *     padding squares that reported success. An executor whose failure message
 *     names the command still gets the named form.
 *
 *   Uploads are all-or-nothing per COMMAND but not per BATCH: both executors
 *   upload only after every command has succeeded, so a non-zero ffmpeg exit
 *   ships nothing at all — but if a declared output is missing when its turn
 *   comes in the upload loop (an ffmpeg that exited 0 having written no file,
 *   which `-abort_on empty_output` makes unlikely rather than impossible), the
 *   images before it have already landed. Treat a run's `outputPrefix` as
 *   disposable rather than as a directory you append to.
 *
 *   At most 200 stills per step (`MAX_STILLS_PER_JOB`, measured on
 *   `times.length`) — a runaway `times` expression would otherwise spawn one
 *   ffmpeg per entry, and each still piles up in scratch before anything is
 *   uploaded. That cap bounds the sheets too, since sheets are
 *   `times.length / perSheet`.
 *
 * Three things about `frames` that surprise authors:
 * - **Three different syntaxes, and mixing them up fails at run time.**
 *   `input` and `outputPrefix` are TEMPLATES (`evaluateTemplate`):
 *   `{{steps.x.y}}` is substituted and anything else is used verbatim as a
 *   path. `times` and `draw.text` are BARE EXPRESSIONS
 *   (`evaluateExpression`): write `steps.probe.times`, because a value
 *   starting `{{` does not match the evaluator's root pattern and comes back
 *   as the LITERAL string — so `times: '{{...}}'` fails as "expected a
 *   non-empty array", and `draw.text: '{{...}}'` is rejected outright rather
 *   than drawing the braces into the picture. `height`, `quality`,
 *   `draw.size`, `tile.perSheet` and `tile.columns` are NEITHER — they are
 *   literal numbers (the string forms `'720'` are coerced), so
 *   `height: '{{steps.probe.h}}'` is a `ConfigurationError` from
 *   validateConfig — which runs immediately before execute, NOT on save, so it
 *   fails on the step's first request rather than when it is authored — and
 *   even a bare `steps.probe.h` is not resolved. Compute a number in a prior
 *   step and you still cannot pass it here — pick it at authoring time.
 *   `draw.text` differs from `times` in one way: a plain string is legitimate
 *   CONTENT, so it is only resolved when it has the shape of a whole
 *   expression path, and an authored ARRAY is always literals (Ruling R106) —
 *   `text: ["metadata.json"]` draws that filename, which `text: 'metadata.json'`
 *   would try to look up.
 * - **`draw.text` resolves expressions, including `secrets.*`.** It is the
 *   same evaluator every other field uses, so `draw.text: 'secrets.API_KEY'`
 *   burns a decrypted secret into a JPEG that is then uploaded to storage.
 *   That is author-initiated and consistent with the rest of the expression
 *   system rather than a hole — but a drawn value ends up in an IMAGE, where
 *   nothing downstream will redact it.
 * - **`quality` and `height` have no upper bound.** They are only checked for
 *   being positive integers, so `quality: 500` reaches `-q:v 500` and
 *   `height: 20000` scales every still to 20 000 px. jpeg `-q:v` is meaningful
 *   over 2..31 (2 = best, 31 = worst; default 3) and a useful `height` is
 *   360..1080 (default 720). The tiled SHEET is always `-q:v 3`; `quality`
 *   applies to the stills.
 *
 * A 200-still tiled step is up to 400 ffmpeg commands — `tile: {perSheet: 1}`
 * over 200 times is 200 stills plus 200 tiles — and the local runner
 * acquires its single concurrency slot PER COMMAND, not per job — so a long
 * step gets that many chances to hit `FFMPEG_BUSY`, and a failure part-way
 * through discards every still computed so far. That is the concrete reason a
 * big `frames` step belongs in `postSteps` behind a job row, the same way
 * `slice` does, rather than merely "it is heavy".
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
  /** Source object (probe / extract_audio / slice / frames — required for all but probe). TEMPLATE: `{{...}}` substituted, anything else verbatim. */
  input?: string;
  /** Source clips for concat, in order: a JSON array (entries are TEMPLATES) or a BARE expression resolving to one — not `{{...}}`. */
  inputs?: string[] | string;
  /** Kept spans for slice: an array (bounds may be BARE expressions) or a BARE expression resolving to one — not `{{...}}`. */
  spans?: FfmpegSpan[] | string;
  /** Destination path, uploads-relative. TEMPLATE. Required for extract_audio / slice / concat; frames writes under `outputPrefix` instead, and probe writes nothing. */
  output?: string;
  /** slice only: also emit the clip's 16 kHz mono WAV to this uploads-relative path. TEMPLATE. Setting it adds an `audio` sub-object to the step output. */
  audioOutput?: string;
  /** slice only: ~10 ms audio edge fades per span (assemble parity). Default false. */
  audioFades?: boolean;
  /** frames: destination DIRECTORY, uploads-relative. TEMPLATE. A trailing slash is stripped. */
  outputPrefix?: string;
  /** frames: capture times in source seconds — an array (entries may be BARE expressions) or a BARE expression resolving to one. NOT `{{...}}`: a braced value comes back as a literal string and fails. */
  times?: Array<number | string> | string;
  /** frames: output height in px, width follows the aspect ratio. Default 720. LITERAL number (no expression of either form); positive integer, no upper bound. */
  height?: number;
  /** frames: jpeg quality of each still, ffmpeg -q:v (2 = best, 31 = worst). Default 3. LITERAL number; positive integer, no upper bound. A tiled sheet is always -q:v 3. */
  quality?: number;
  /** frames: burn one line of text into every still. Omit for clean stills. */
  draw?: FfmpegDrawConfig;
  /** frames: tile the stills into contact sheets instead of uploading them individually. Omit to upload each still. */
  tile?: FfmpegTileConfig;
  /**
   * Which executor runs the job: 'local' (this backend) | 'remote' (Worker) | a
   * `{{expression}}` resolving to one — a TEMPLATE, like the path fields.
   * Default: the instance's default executor.
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

  /**
   * Serve the object as an attachment (`Content-Disposition: attachment;
   * filename="..."`) so browsers save it instead of rendering it inline.
   *
   * Either a literal boolean, a BARE expression (`request.query.download`),
   * or a `{{template}}` — whichever the value resolves to is read as a flag:
   * missing/null, `false`, `0`, `""`, `"0"`, `"false"`, `"no"` and `"off"`
   * (case-insensitive) mean inline; anything else (including the string
   * `"1"` a `?download=1` query sends) means attachment. The canonical use is
   * `download: request.query.download` so one rule serves both `<img src>`
   * and a "Download" link.
   *
   * The filename is the upload record's `original_name` when the served key
   * was written by file_upload_handler / register_upload, otherwise the
   * key's basename; it is sanitised and emitted in the RFC 6266 dual form
   * (`filename=` ASCII fallback + `filename*=UTF-8''…`) for non-ASCII names.
   * Range/206 handling and caching are unchanged. Omitted → inline, exactly
   * as before this option existed.
   */
  download?: boolean | string;
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

// RemoteRequestHandlerConfig is defined in handlers/remote-request.handler.ts
export type { RemoteRequestHandlerConfig } from '../handlers/remote-request.handler';

/**
 * `mcp_handler` — one step that answers as a stateless Streamable-HTTP MCP
 * server described entirely by this config. Tools and `ui://` resources map
 * to sibling rules of the same alias, invoked in-process as the caller with
 * the sibling's own validators (`RuleInvokerService`). App-agnostic: the
 * app's rule set is the server (apps#554 spec 10, D22).
 */
export interface McpToolDecl {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** MCP Apps: `['model']` (default) or `['app']` — app-only tools are callable but listed with `_meta.ui.visibility`. */
  visibility?: Array<'model' | 'app'>;
  _meta?: Record<string, unknown>;
  /** The sibling rule that answers the tool; `arguments` go as the body (POST) or the query (GET). */
  rule: { path: string; method?: 'GET' | 'POST' };
}

export interface McpResourceDecl {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  rule: { path: string; method?: 'GET' };
}

export interface McpResourceTemplateDecl {
  /** RFC 6570 level 1: `{var}` one segment, `{var+}` a slash-carrying tail. */
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** The sibling path with the same variables, e.g. `/w/{impl}/{path+}`. */
  rule: { path: string };
}

export interface McpHandlerConfig extends BaseHandlerConfig {
  serverInfo: { name: string; version: string };
  instructions?: string;
  /** Newest first; defaults to the three the MCP spec has published. */
  protocolVersions?: string[];
  tools: McpToolDecl[];
  resources?: {
    static?: McpResourceDecl[];
    templates?: McpResourceTemplateDecl[];
    /** A sibling whose JSON answer is the resources array (or `{ resources }`) — what the app enumerates. */
    list?: { rule: { path: string; method?: 'GET' } };
    /** `_meta.ui.csp` for every resource; entries may be `$app` (the request's origin) or `$storage` (the storage backend's). */
    csp?: { connectDomains?: string[]; resourceDomains?: string[] };
  };
}
