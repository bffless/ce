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
    .string()
    .describe(
      'Handler type: form, response, data_create, data_query, data_update, data_delete, email, db_aggregate, function, ai, file_upload, file_serve, replicate, embed_store, vector_search, image_convert',
    ),
  config: z
    .record(z.string(), z.unknown())
    .describe(
      `Handler-specific configuration object. Key configs by handler type:

- form: { fields: { fieldName: { type: "string"|"number"|"email"|"boolean", required?: bool } } }
- response: { body: "Handlebars template string producing valid JSON. Use \\"key\\": \\"{{expr}}\\" for strings, \\"key\\": {{expr}} for numbers, \\"key\\": {{{expr}}} for raw JSON objects. Keys must always be quoted.", status?: number, headers?: {}, contentType?: string }
- data_create: { schemaId: "uuid", fields: { schemaField: "expression" } }
- data_query: { schemaId: "uuid", filters?: {}, pageSize?: number }
- data_update: { schemaId: "uuid", recordId: "expression", fields: { schemaField: "expression" } }
- data_delete: { schemaId: "uuid", recordId: "expression" }
- replicate: { model: "owner/name" (JUST the model, e.g. "stability-ai/sdxl"), version?: "64-char hash" (SEPARATE from model — pin for deterministic results), input: { inputName: "expression" }, outputField?: "key" }
- file_upload: { schemaId: "uuid", subDir: "folder", sourceUrl?: "expression" (for downloading from URL e.g. "steps.replicate.output[0]"), extraFields?: { field: "expression" }, filename?: "expression", convertTo?: "png"|"jpeg"|"webp" }
- ai: { provider: "anthropic"|"openai", model: "model-id", systemPrompt?: "text", userPrompt: "expression", temperature?: number }
- email: { to: "expression", subject: "expression", body: "expression" }
- db_aggregate: { schemaId: "uuid", operation: "sum"|"count"|"avg"|"min"|"max", field?: "name", filters?: {} }

All configs support: condition?: "expression" (skip step if falsy), timeout?: number (ms).
Expressions reference prior steps: "steps.stepName.fieldName" or request data: "request.body.field".`,
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
    _request: Request,
  ) {
    const result = await this.proxyRuleSetsService.listByProject(projectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_proxy_rule_set',
    description: 'Get a proxy rule set by ID, including all its rules.',
    parameters: z.object({
      id: z.string().describe('Rule set ID'),
    }),
  })
  async getRuleSet({ id }: { id: string }, _context: Context, _request: Request) {
    const result = await this.proxyRuleSetsService.getById(id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_proxy_rule_set',
    description: 'Create a new proxy rule set for a project.',
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
    await this.proxyRuleSetsService.delete(id, user.id, user.role);
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
  async getRule({ id }: { id: string }, _context: Context, _request: Request) {
    const result = await this.proxyRulesService.getRuleById(id);
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
      timeout: z.number().optional().describe('Request timeout in ms (default 30000, range 1000-60000)'),
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
    const result = await this.proxyRulesService.create(args as any, user.id, user.role);
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
    const result = await this.proxyRulesService.update(id as string, dto as any, user.id, user.role);
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
    await this.proxyRulesService.delete(id, user.id, user.role);
    return JSON.stringify({ success: true, id });
  }
}
