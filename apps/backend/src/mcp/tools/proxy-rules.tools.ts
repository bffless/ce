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
      'replicate',
      'embed_store',
      'vector_search',
      'image_convert_handler',
      'http_request',
      'stripe_checkout',
      'stripe_webhook',
      'signed_url',
      'github_api',
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
- file_upload_handler: { schemaId: "uuid", subDir: "folder", sourceUrl?: "expression" (e.g. "steps.generate.output[0]"), extraFields?: { field: "expression" }, filename?: "expression to override stored filename", convertTo?: "png"|"jpeg"|"webp" }. NOTE: file_upload_handler automatically creates a record in the schema with built-in fields (filename, storage_path, mime_type, size, url). Use extraFields to add custom data (e.g. "prompt": "request.body.prompt"). Do NOT add a separate data_create step — it creates duplicate records. IMPORTANT: Use generate_upload_schema MCP tool to create the schema first so files appear in the Uploads tab. The record's "url" field (e.g. "/api/uploads/generations/uuid-file.png") is the public serve URL — use it directly in responses. When using sourceUrl with AI models, set filename to override the generic output name (e.g. filename: "request.body.prompt" to name the file after the prompt instead of "out-0.png").
- ai_handler: { provider: "anthropic"|"openai", model: "model-id (MUST be literal string, does NOT support expressions)", systemPrompt?: "text", messageField: "expression for user message content (e.g. request.body.prompt, steps.prep.message)" (NOT userPrompt), temperature?: number }. OUTPUT: access AI response via steps.stepName.content (NOT .messageField). Available models: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6. Conditions on ai_handler steps cannot use inline === comparisons — compute booleans in a prior function_handler and reference them.
- email_handler: { to: "expression", subject: "expression", body: "expression" }
- db_aggregate: { schemaId: "uuid", operation: "sum"|"count"|"avg"|"min"|"max", field?: "name", filters?: {}, groupBy?: "fieldName" }. When groupBy is set, output changes from { operation, result } to { operation, groupBy, results: [{ key: "value", value: number }, ...] }
- function_handler: { code: "function handler({ input, user, request, steps }) { return {}; }" }. IMPORTANT: Runs in sandboxed VM — NO access to crypto, Buffer, require, process, fetch. Use Math.random() for randomness. Use for loops instead of .map()/.sort() on data_query results (arrays may be frozen). Use var instead of const/let for safety.
- file_serve_handler: { path: "expression" }
- http_request: { url: "target URL (expression)", method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", forwardAuth?: boolean (forwards cookies + authorization header from original request), body?: "expression" or { field: "expression" } (for POST/PUT/PATCH), headers?: { "Header-Name": "expression or static value" }, forwardHeaders?: ["header-name"] (forward specific headers from original request), timeout?: number (ms, default 30000) }
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
