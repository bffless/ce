import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { ProxyRuleSetsService } from '../../proxy-rules/proxy-rule-sets.service';
import { ProxyRulesService } from '../../proxy-rules/proxy-rules.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

const pipelineStepSchema = z.object({
  id: z.string().describe('Unique step ID'),
  name: z.string().describe('Step name'),
  handlerType: z
    .enum([
      'form_handler',
      'response_handler',
      'data_create',
      'data_query',
      'data_update',
      'data_delete',
      'email_handler',
      'db_aggregate',
      'function_handler',
      'ai_handler',
      'file_upload_handler',
      'file_serve_handler',
      'file_delete',
      'replicate',
      'embed_store',
      'vector_search',
      'image_convert_handler',
      'http_request',
      'stripe_checkout',
      'stripe_webhook',
      'signed_url',
      'presigned_upload',
      'register_upload',
      'github_api',
      'google_calendar',
      'delay',
    ])
    .describe(
      'IMPORTANT: Use exact handler type strings. Some have _handler suffix, some do not. The enum values are the only valid options.',
    ),
  config: z
    .record(z.string(), z.unknown())
    .describe(
      `Handler-specific configuration. All input/expression values MUST be strings (even numbers like "1024").

- form_handler: { fields: { fieldName: { type: "string"|"number"|"email"|"boolean", required?: bool } } }
- response_handler: { body: "Handlebars template string producing valid JSON. Use \\"key\\": \\"{{expr}}\\" for strings, \\"key\\": {{expr}} for numbers, \\"key\\": {{{expr}}} for raw JSON objects. Keys must always be quoted.", status?: number, headers?: {}, contentType?: string }
- data_create: { schemaId: "uuid", fields: { schemaField: "expression" } }
- data_query: { schemaId: "uuid", recordId?: "expression" (returns single flat object, ignores filters), filters?: {}, pageSize?: number }. IMPORTANT: Results have data fields FLATTENED to top level (NO .data wrapper). Access as steps.stepName[i].fieldName or steps.stepName.fieldName (with recordId).
- data_update: { schemaId: "uuid", recordId: "expression", fields: { schemaField: "expression" } }
- data_delete: { schemaId: "uuid", recordId: "expression" }
- replicate: { model: "owner/name" (JUST the model, e.g. "stability-ai/sdxl"), version?: "64-char hash" (SEPARATE field), input: { inputName: "expression or literal" } (strings for expressions e.g. "request.body.prompt", numbers for literals e.g. 1024), outputField?: "key" }
- file_upload_handler: { schemaId: "uuid", subDir: "folder (supports expressions for per-project layouts, e.g. \"projects/{{request.body.projectId}}\"; resolved value must be non-empty and contain no \"..\")", sourceUrl?: "expression" (e.g. "steps.generate.output[0]"), extraFields?: { field: "expression" }, filename?: "expression to override stored filename", convertTo?: "png"|"jpeg"|"webp" }. NOTE: file_upload_handler automatically creates a record in the schema with built-in fields (filename, storage_path, mime_type, size, url). Use extraFields to add custom data (e.g. "prompt": "request.body.prompt"). Do NOT add a separate data_create step — it creates duplicate records. IMPORTANT: Use generate_upload_schema MCP tool to create the schema first so files appear in the Uploads tab. The record's "url" field (e.g. "/api/uploads/generations/uuid-file.png") is the public serve URL — use it directly in responses. When using sourceUrl with AI models, set filename to override the generic output name (e.g. filename: "request.body.prompt" to name the file after the prompt instead of "out-0.png").
- presigned_upload: { subDir: "folder (supports expressions, e.g. \"projects/{{request.body.projectId}}\")", filename?: "expression for the upload filename (default request.body.filename)", dateBucket?: bool, expiresIn?: number (seconds, default 3600), maxFileSize?: number, allowedMimeTypes?: ["image/*"] }. PREPARE step for direct-to-bucket uploads — mints a presigned PUT URL so the client uploads the file STRAIGHT to the storage bucket, bypassing nginx/backend (use this for large files instead of file_upload_handler). Output: { uploadUrl (client PUTs bytes here), storageKey, publicPath, originalName, expiresAt }. ONLY works on bucket storage (S3/GCS/MinIO/Azure) — errors PRESIGNED_NOT_SUPPORTED on local storage. Pair with a register_upload step in a SECOND pipeline the client calls after the PUT completes. The bucket needs CORS allowing PUT from the site origin.
- register_upload: { schemaId: "uuid", subDir: "folder (supports expressions, e.g. \"projects/{{request.body.projectId}}\"; should match the presigned_upload step)", storageKey?: "expression (default request.body.storageKey)", originalName?: "expression (default request.body.originalName)", maxFileSize?: number (default 500MB), allowedMimeTypes?: ["image/*"], extraFields?: { field: "expression" }, deleteOnViolation?: bool (default true) }. FINALIZE step for direct-to-bucket uploads — verifies the object the client uploaded via the presigned URL actually landed, reads its real size/MIME from storage, enforces limits, and writes the SAME schema record (filename, storage_path, mime_type, size, url) that file_upload_handler writes. Use generate_upload_schema for the schema. Do NOT add a separate data_create step. Validates the storageKey stays within the project's uploads area.
- ai_handler: { provider: "anthropic"|"openai", model: "model-id (MUST be literal string, does NOT support expressions)", systemPrompt?: "text", messageField: "expression for user message content (e.g. request.body.prompt, steps.prep.message)" (NOT userPrompt), attachments?: [{ type: "image"|"file", source: "expression resolving to a URL or ARRAY of URLs (e.g. steps.collect.images) — arrays fan out to one part per URL, empty values skipped", mediaType?: "required for file (e.g. audio/mpeg)" }] (completion mode only; images work on all providers, audio NOT on anthropic), temperature?: number }. OUTPUT: access AI response via steps.stepName.content (NOT .messageField). Available models: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6. Conditions on ai_handler steps cannot use inline === comparisons — compute booleans in a prior function_handler and reference them.
- email_handler: { to: "expression", subject: "expression", body: "expression" }
- db_aggregate: { schemaId: "uuid", operation: "sum"|"count"|"avg"|"min"|"max", field?: "name", filters?: {}, groupBy?: "fieldName" }. When groupBy is set, output changes from { operation, result } to { operation, groupBy, results: [{ key: "value", value: number }, ...] }
- function_handler: { code: "function handler({ input, user, request, steps }) { return {}; }" }. IMPORTANT: Runs in sandboxed VM — NO access to crypto, Buffer, require, process, fetch. Use Math.random() for randomness. Use for loops instead of .map()/.sort() on data_query results (arrays may be frozen). Use var instead of const/let for safety.
- file_serve_handler: { subDir?: "folder to serve from — file path is derived from the request URL under /api/uploads/<subDir>/", key?: "expression (single object, relative to {owner}/{repo}/uploads/, e.g. \"content/{{steps.resolve.serveKey}}\")", cacheMaxAge?: number (seconds, default 3600), cacheability?: "public"|"private" (default private) }. Streams an object from storage (supports HTTP Range for video/audio). Provide subDir for path-derived serving, OR key to serve an explicit manifest-resolved object IN-PLACE (the request path stays put, so a Site's relative sub-resources keep resolving same-origin instead of being 302-redirected out of the namespace). In key mode the value is interpolated and rejected if it contains ".."; Content-Type comes from the key's extension. Defaults to private (never a shared/CDN cache) since pipeline-served files are usually behind app-defined access control this handler can't see.
- file_delete: { prefix?: "expression" (relative to the project's uploads root, e.g. "projects/{{request.body.projectId}}/"), key?: "expression" (single object, relative to uploads root), keys?: ["expression", ...] (set of unrelated objects sharing no common prefix, e.g. a Site manifest's assets — each relative to uploads root), dryRun?: bool }. DESTRUCTIVE. Provide exactly ONE of prefix, key, or keys. prefix mode lists+deletes EVERY object under <uploadsRoot>/<prefix> (object stores have no atomic folder delete); key mode deletes one object; keys mode deletes each listed object independently. All are relative to {owner}/{repo}/uploads/ — the same root file_upload/file_serve use via subDir — and are interpolated before use (every keys entry too). Idempotent: a prefix/key/keys-entry matching nothing contributes 0 (not an error). SAFETY: a blank/whitespace/"/"-only value and any ".." traversal are rejected before any storage call (a blank prefix never means "delete everything"); in keys mode every entry is resolved+guarded before any deletion, so one bad entry aborts the whole step. Output: prefix mode { deleted: number, prefix, dryRun }; key mode { deleted: 0|1, key, dryRun }; keys mode { deleted: number, keys, dryRun } (partial failures throw, reporting how many were deleted vs failed). Since this is destructive, gate the consuming rule with the auth_required validator once auth is in place.
- http_request: { url: "target URL (expression)", method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", forwardAuth?: boolean (forwards cookies + authorization header from original request), body?: "expression" or { field: "expression" } (for POST/PUT/PATCH), headers?: { "Header-Name": "expression or static value" }, forwardHeaders?: ["header-name"] (forward specific headers from original request), timeout?: number (ms, default 30000), failOnError?: boolean (default true) }. OUTPUT shape depends on failOnError: when true (default), 2xx responses output the parsed body directly (steps.name.field) and 4xx/5xx halt the pipeline with HTTP_REQUEST_ERROR; when false, ALL HTTP responses output { ok: boolean, status: number, statusText: string, body: <parsed> } so the next step can branch on steps.name.ok / steps.name.status. Set failOnError=false for health checks, polling probes, and any case where a non-2xx is a normal outcome (e.g. checking if a deployment URL is reachable yet). Network errors / timeouts still fail the step regardless of failOnError.
- stripe_checkout: { priceId: "expression (e.g. steps.myStep.priceId)", mode?: "payment"|"subscription" (default "payment"), successUrl: "URL with optional {CHECKOUT_SESSION_ID} template", cancelUrl: "URL", customerEmail?: "expression (e.g. user.email)", clientReferenceId?: "expression (e.g. user.id)", metadata?: { key: "expression" }, quantity?: "expression (default 1)", environment?: "sandbox"|"production" }. Creates a Stripe Checkout Session. Output: { sessionId, url } — redirect user to url. Requires Stripe integration configured in project settings.
- stripe_webhook: { allowedEventTypes?: ["checkout.session.completed", ...], environment?: "sandbox"|"production" }. Verifies Stripe webhook signature and parses event. Output is the full Stripe event object. Access via: steps.stripe_webhook.type (event type), steps.stripe_webhook.data.object (the Stripe object e.g. Session), steps.stripe_webhook.data.object.client_reference_id (user ID from checkout), steps.stripe_webhook.data.object.amount_total (cents). If allowedEventTypes is set, non-matching events are ignored (pipeline terminates with success). Requires Stripe integration with webhook secret configured.
- github_api: Supports multiple actions via the "action" field. Requires GitHub integration configured in project settings.
  - action "create_repo_from_template": { action: "create_repo_from_template", templateOwner: "expression", templateRepo: "expression", targetOrg: "expression", repoName: "expression", private?: boolean (default true), description?: "expression", includeAllBranches?: boolean (default false) }. Output: { name, full_name, html_url, clone_url, default_branch }.
  - action "set_repo_variable": { action: "set_repo_variable", owner: "expression", repo: "expression", variableName: "expression", variableValue: "expression" }. Sets a GitHub Actions variable on a repo. Output: { owner, repo, variableName, variableValue }.
  - action "create_issue": { action: "create_issue", owner: "expression", repo: "expression", title: "expression", body: "expression", labels?: ["label1", "label2"] }. Creates a GitHub issue. Output: { id, number, title, html_url, state }.
  - action "add_issue_comment": { action: "add_issue_comment", owner: "expression", repo: "expression", issueNumber: "expression", body: "expression" }. Adds a comment to an existing issue. Output: { id, html_url }.
  - action "close_issue": { action: "close_issue", owner: "expression", repo: "expression", issueNumber: "expression" }. Closes an issue. Output: { number, state, html_url }.
  - action "close_pull_request": { action: "close_pull_request", owner: "expression", repo: "expression", issueNumber: "expression" }. Closes a PR. Output: { number, state, html_url }.
  - action "merge_pull_request": { action: "merge_pull_request", owner: "expression", repo: "expression", issueNumber: "expression", mergeMethod?: "expression" (default "merge") }. Merges a PR. Output: { sha, merged, message }.
  - action "list_pull_requests": { action: "list_pull_requests", owner: "expression", repo: "expression", state?: "expression" (default "open") }. Lists PRs. Output: [{ number, title, state, html_url, head_ref, body }].
  - action "dispatch": { action: "dispatch", owner: "expression", repo: "expression", eventType: "expression (e.g. \"'compose'\")", clientPayload?: { key: "expression" } }. Fires a repository_dispatch event so a workflow in the target repo can trigger via "on: repository_dispatch: types: [<eventType>]". Each clientPayload value is evaluated as an expression and delivered as \${{ github.event.client_payload.<key> }}. GitHub returns 204 No Content on success. Output: { eventType, owner, repo, clientPayload }.
- google_calendar: Read free/busy and read/write events on Google Calendar via the project's Google Calendar integration (per-project clientId/clientSecret stored encrypted in IntegrationsService). Supports multiple actions via the "action" field. Token refresh + 401 retry are handled internally; pass calendar IDs and event IDs as expressions where useful. Set optional?: true to soft-fail (NOT_CONFIGURED / AUTH_FAILED / NOT_FOUND become success-with-warning, output: { skipped: true, reason }) so the integration can be a layered enhancement on top of DB-only flows. Transient failures (5xx, 429) still error regardless of optional. All string-typed inputs run through the expression evaluator.
  - action "list_calendars": { action: "list_calendars" }. Lists sub-calendars on the connected account. Output: { calendars: [{ id, summary, primary, timeZone }] }.
  - action "freebusy": { action: "freebusy", calendarIds: ["expression" | string[]], timeMin: "expression (ISO 8601)", timeMax: "expression (ISO 8601)", timezone?: "IANA tz" }. Output: { calendars: { [calId]: { busy: [{ start, end }] } }, timeMin, timeMax }.
  - action "list_events": { action: "list_events", calendarId: "expression", timeMin?: "expression", timeMax?: "expression", maxResults?: number, singleEvents?: boolean, orderBy?: "startTime"|"updated" }. Output: { events: [{ id, summary, start, end, ... }], nextPageToken }.
  - action "create_event": { action: "create_event", calendarId: "expression", summary: "template", description?: "template", location?: "template", startTime: "expression (ISO 8601)", endTime: "expression (ISO 8601)", attendees?: [{ email: "expression" }], timezone?: "IANA tz", sendUpdates?: "all"|"externalOnly"|"none" }. Output: { event: { id, summary, start, end, htmlLink, ... } }.
  - action "update_event": { action: "update_event", calendarId: "expression", eventId: "expression", summary?: "template", description?: "template", location?: "template", startTime?: "expression", endTime?: "expression", sendUpdates?: "all"|"externalOnly"|"none" }. Output: { event: { ... } }.
  - action "delete_event": { action: "delete_event", calendarId: "expression", eventId: "expression", sendUpdates?: "all"|"externalOnly"|"none" }. Treats 204/404/410 as success. Output: { eventId, calendarId, deleted: true }.
- delay: { ms?: number|"expression", seconds?: number|"expression" }. Pauses pipeline execution before continuing. Provide either ms or seconds (ms wins if both set). Capped at 60000ms (60s). Output: { delayedMs }.

All configs support: condition?: "expression" (skip step if falsy), timeout?: number (ms).
Expressions reference prior steps by step NAME (not id): "steps.stepName.field" or request data: "request.body.field". Use bracket notation for names with spaces: "steps['Step Name'].field". Use simple names without spaces to keep expressions clean.`,
    ),
  isEnabled: z.boolean().optional().describe('Whether step is enabled (default true)'),
});

@Injectable()
export class ProxyRulesTools {
  constructor(
    private readonly proxyRuleSetsService: ProxyRuleSetsService,
    private readonly proxyRulesService: ProxyRulesService,
    private readonly authService: AuthService,
  ) {}

  // =====================
  // Rule Set Tools
  // =====================

  @Tool({
    name: 'list_proxy_rule_sets',
    description: 'List all proxy rule sets for a project.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listRuleSets(
    { projectId }: { projectId: string },
    _context: Context,
    request: Request,
  ) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.proxyRuleSetsService.listByProject(projectId, apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_proxy_rule_set',
    description: 'Get a proxy rule set by ID, including all its rules.',
    parameters: z.object({
      id: z.string().describe('Rule set ID'),
    }),
  })
  async getRuleSet({ id }: { id: string }, _context: Context, request: Request) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.proxyRuleSetsService.getById(id, apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_proxy_rule_set',
    description: 'Create a new proxy rule set for a project. IMPORTANT: After creating rules in this set, you must assign it to a deployment alias via update_alias(proxyRuleSetId) for the rules to take effect. Rules will not be active until the rule set is linked to an alias.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Rule set name'),
      description: z.string().optional().describe('Rule set description'),
      environment: z.string().optional().describe('Target environment'),
    }),
  })
  async createRuleSet(
    args: {
      projectId: string;
      name: string;
      description?: string;
      environment?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.proxyRuleSetsService.create(
      args.projectId,
      { name: args.name, description: args.description, environment: args.environment },
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_proxy_rule_set',
    description: 'Delete a proxy rule set and all its rules. Cannot delete the default rule set.',
    parameters: z.object({
      id: z.string().describe('Rule set ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteRuleSet(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.proxyRuleSetsService.delete(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }

  // =====================
  // Individual Rule Tools
  // =====================

  @Tool({
    name: 'get_proxy_rule',
    description: 'Get a single proxy rule by ID.',
    parameters: z.object({
      id: z.string().describe('Proxy rule ID'),
    }),
  })
  async getRule({ id }: { id: string }, _context: Context, request: Request) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.proxyRulesService.getRuleById(id);
    if (result && apiKeyProjectId !== undefined && apiKeyProjectId !== null) {
      // Resolve owning project via the rule's rule set, then enforce scope
      const ruleSet = await this.proxyRulesService.getRuleSetById(result.ruleSetId);
      if (ruleSet) {
        // throws if mismatch
        await this.proxyRuleSetsService.getById(ruleSet.id, apiKeyProjectId);
      }
    }
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_proxy_rule',
    description:
      'Create a proxy rule within a rule set. Supports external proxy, internal rewrite, email form handler, and pipeline types. For pipelines, provide pipelineConfig with steps array.',
    parameters: z.object({
      ruleSetId: z.string().describe('Rule set ID to add the rule to'),
      pathPattern: z
        .string()
        .describe('URL path pattern to match (e.g. "/api/contact", "/api/generate-image")'),
      targetUrl: z
        .string()
        .describe(
          'Target URL for external_proxy, or path for internal_rewrite. Use "pipeline" for pipeline type.',
        ),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        .optional()
        .describe('HTTP method to match (omit for any method)'),
      methods: z
        .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']))
        .optional()
        .describe('HTTP methods to match (alternative to `method`; takes precedence; omit both for any)'),
      proxyType: z
        .enum(['external_proxy', 'internal_rewrite', 'email_form_handler', 'pipeline'])
        .optional()
        .describe('Rule type (default: external_proxy)'),
      description: z.string().optional().describe('Rule description'),
      isEnabled: z.boolean().optional().describe('Whether rule is active (default true)'),
      order: z.number().optional().describe('Evaluation order (auto-assigned if omitted)'),
      stripPrefix: z.boolean().optional().describe('Remove matched prefix before forwarding (default true)'),
      timeout: z.number().optional().describe('Request timeout in ms (default 30000, range 1000-120000)'),
      preserveHost: z.boolean().optional().describe('Preserve original Host header'),
      forwardCookies: z.boolean().optional().describe('Forward cookies to target'),
      headerConfig: z
        .object({
          forward: z.array(z.string()).optional().describe('Headers to forward'),
          strip: z.array(z.string()).optional().describe('Headers to remove'),
          add: z
            .record(z.string(), z.string())
            .optional()
            .describe('Headers to add (values encrypted at rest)'),
        })
        .optional()
        .describe('Header manipulation config'),
      emailHandlerConfig: z
        .object({
          destinationEmail: z.string().describe('Email address to send form submissions to'),
          subject: z.string().optional().describe('Email subject line'),
          successRedirect: z.string().optional().describe('URL to redirect to after success'),
          corsOrigin: z.string().optional().describe('Allowed CORS origin'),
          honeypotField: z.string().optional().describe('Honeypot field name for spam detection'),
          replyToField: z.string().optional().describe('Form field to use as reply-to address'),
          requireAuth: z.boolean().optional().describe('Require authentication'),
        })
        .optional()
        .describe('Config for email_form_handler type'),
      pipelineConfig: z
        .object({
          name: z.string().describe('Pipeline name'),
          description: z.string().optional().describe('Pipeline description'),
          steps: z.array(pipelineStepSchema).describe('Pipeline execution steps'),
          postSteps: z.array(pipelineStepSchema).optional().describe('Steps to run after main steps'),
          validators: z
            .array(
              z.object({
                type: z.string().describe('Validator type (e.g. "auth_required", "rate_limit")'),
                config: z.record(z.string(), z.unknown()).describe('Validator config'),
              }),
            )
            .optional()
            .describe('Request validators'),
        })
        .optional()
        .describe('Config for pipeline type - defines multi-step request processing'),
    }),
  })
  async createRule(
    args: Record<string, unknown>,
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.proxyRulesService.create(
      args as any,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_proxy_rule',
    description: 'Update an existing proxy rule. All fields are optional — only provided fields are updated.',
    parameters: z.object({
      id: z.string().describe('Proxy rule ID to update'),
      pathPattern: z.string().optional().describe('New path pattern'),
      targetUrl: z.string().optional().describe('New target URL'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        .optional()
        .describe('New HTTP method'),
      methods: z
        .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']))
        .optional()
        .describe('HTTP methods to match (alternative to `method`; takes precedence; omit both for any)'),
      proxyType: z
        .enum(['external_proxy', 'internal_rewrite', 'email_form_handler', 'pipeline'])
        .optional(),
      description: z.string().optional(),
      isEnabled: z.boolean().optional(),
      order: z.number().optional(),
      stripPrefix: z.boolean().optional(),
      timeout: z.number().optional(),
      preserveHost: z.boolean().optional(),
      forwardCookies: z.boolean().optional(),
      headerConfig: z
        .object({
          forward: z.array(z.string()).optional(),
          strip: z.array(z.string()).optional(),
          add: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
      emailHandlerConfig: z
        .object({
          destinationEmail: z.string(),
          subject: z.string().optional(),
          successRedirect: z.string().optional(),
          corsOrigin: z.string().optional(),
          honeypotField: z.string().optional(),
          replyToField: z.string().optional(),
          requireAuth: z.boolean().optional(),
        })
        .optional(),
      pipelineConfig: z
        .object({
          name: z.string(),
          description: z.string().optional(),
          steps: z.array(pipelineStepSchema),
          postSteps: z.array(pipelineStepSchema).optional(),
          validators: z
            .array(z.object({ type: z.string(), config: z.record(z.string(), z.unknown()) }))
            .optional(),
        })
        .optional(),
    }),
  })
  async updateRule(
    args: Record<string, unknown>,
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { id, ...dto } = args;
    const result = await this.proxyRulesService.update(
      id as string,
      dto as any,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_pipeline_step',
    description:
      'Patch a SINGLE step inside a pipeline rule without resending the whole pipeline. Use this instead of update_proxy_rule when you only need to change one step (e.g. tweak a function_handler\'s code or one config value) and the full pipelineConfig would be large. The step is located by its name. Only provided fields change; nginx is regenerated automatically. Use get_proxy_rule first to see step names and current config.',
    parameters: z.object({
      ruleId: z.string().describe('Proxy rule ID (must be a pipeline-type rule)'),
      stepName: z
        .string()
        .describe('Name of the step to patch (the step\'s "name" field, used in expressions)'),
      target: z
        .enum(['steps', 'postSteps'])
        .optional()
        .describe('Which step list the step lives in (default "steps")'),
      config: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'New handler config for this step. By default REPLACES the step\'s config entirely. Set mergeConfig:true to shallow-merge these keys into the existing config instead. Same config shape as in create_proxy_rule.',
        ),
      mergeConfig: z
        .boolean()
        .optional()
        .describe(
          'If true, shallow-merge `config` keys into the existing step config instead of replacing it (default false = replace).',
        ),
      handlerType: pipelineStepSchema.shape.handlerType
        .optional()
        .describe('New handler type for the step (rarely needed; usually keep the existing one)'),
      name: z
        .string()
        .optional()
        .describe('Rename the step. WARNING: other steps referencing "steps.<oldName>" will break.'),
      isEnabled: z.boolean().optional().describe('Enable or disable just this step'),
    }),
  })
  async updatePipelineStep(
    args: {
      ruleId: string;
      stepName: string;
      target?: 'steps' | 'postSteps';
      config?: Record<string, unknown>;
      mergeConfig?: boolean;
      handlerType?: string;
      name?: string;
      isEnabled?: boolean;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { ruleId, ...params } = args;
    const result = await this.proxyRulesService.updateStep(
      ruleId,
      params,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_proxy_rule',
    description: 'Delete a proxy rule.',
    parameters: z.object({
      id: z.string().describe('Proxy rule ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteRule(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.proxyRulesService.delete(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }
}
