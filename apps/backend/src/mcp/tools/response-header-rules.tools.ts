import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { ResponseHeaderRulesService } from '../../response-header-rules/response-header-rules.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

const framePolicySchema = z
  .enum(['sameorigin', 'allow', 'deny'])
  .describe(
    'Frame embedding policy. "sameorigin" = same-origin framing only (default), "allow" = allow the origins in allowedOrigins, "deny" = block all framing.',
  );

const allowedOriginsSchema = z
  .array(z.string())
  .describe(
    'Full origins allowed to iframe the content when framePolicy is "allow", e.g. ["https://example.com"]. Leave empty to allow all origins.',
  );

const customHeadersSchema = z
  .record(z.string(), z.string().nullable())
  .describe(
    'Arbitrary response headers to set on matching files, as { "Header-Name": "value" }. ' +
      'Set a value to null to REMOVE a default header. ' +
      'Use this for headers unrelated to framing, e.g. cross-origin isolation: ' +
      '{ "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" }.',
  );

@Injectable()
export class ResponseHeaderRulesTools {
  constructor(
    private readonly responseHeaderRulesService: ResponseHeaderRulesService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_response_header_rules',
    description:
      'List all response header rules for a project. Rules control iframe embedding (CSP frame-ancestors / X-Frame-Options) and arbitrary custom response headers per path pattern, evaluated in priority order (first match wins).',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listRules(
    { projectId }: { projectId: string },
    _context: Context,
    _request: Request,
  ) {
    const result =
      await this.responseHeaderRulesService.getRulesByProjectId(projectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_response_header_rule',
    description: 'Get a single response header rule by ID.',
    parameters: z.object({
      id: z.string().describe('Response header rule ID'),
    }),
  })
  async getRule({ id }: { id: string }, _context: Context, _request: Request) {
    const result = await this.responseHeaderRulesService.getRuleById(id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_response_header_rule',
    description:
      'Create a response header rule for a project. Matches files by glob pattern and applies frame-embedding policy and/or arbitrary custom response headers. ' +
      'For cross-origin isolation (SharedArrayBuffer / multithreaded WASM), set pathPattern "**" and customHeaders { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" }.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      pathPattern: z
        .string()
        .describe(
          'Glob pattern matched against the deployment file path, e.g. "embed/**", "*.html", "**" (all files).',
        ),
      framePolicy: framePolicySchema.optional(),
      allowedOrigins: allowedOriginsSchema.optional(),
      customHeaders: customHeadersSchema.optional(),
      priority: z
        .number()
        .optional()
        .describe('Rule priority. Lower = evaluated first. Auto-assigned if omitted.'),
      isEnabled: z
        .boolean()
        .optional()
        .describe('Whether the rule is active (default true).'),
      name: z.string().optional().describe('Human-readable rule name.'),
      description: z.string().optional().describe("Explanation of the rule's purpose."),
    }),
  })
  async createRule(
    args: {
      projectId: string;
      pathPattern: string;
      framePolicy?: 'sameorigin' | 'allow' | 'deny';
      allowedOrigins?: string[];
      customHeaders?: Record<string, string | null>;
      priority?: number;
      isEnabled?: boolean;
      name?: string;
      description?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { projectId, ...dto } = args;
    const result = await this.responseHeaderRulesService.create(
      projectId,
      dto,
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_response_header_rule',
    description:
      'Update a response header rule. Only provided fields are changed. ' +
      'NOTE: customHeaders REPLACES the existing custom headers object entirely — read the current rule first and merge if doing a partial update.',
    parameters: z.object({
      id: z.string().describe('Response header rule ID to update'),
      pathPattern: z.string().optional().describe('New glob path pattern.'),
      framePolicy: framePolicySchema.optional(),
      allowedOrigins: allowedOriginsSchema.optional(),
      customHeaders: customHeadersSchema.optional(),
      priority: z.number().optional().describe('New priority (lower = evaluated first).'),
      isEnabled: z.boolean().optional().describe('Enable or disable the rule.'),
      name: z.string().optional().describe('New rule name.'),
      description: z.string().optional().describe('New description.'),
    }),
  })
  async updateRule(
    args: {
      id: string;
      pathPattern?: string;
      framePolicy?: 'sameorigin' | 'allow' | 'deny';
      allowedOrigins?: string[];
      customHeaders?: Record<string, string | null>;
      priority?: number;
      isEnabled?: boolean;
      name?: string;
      description?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { id, ...dto } = args;
    const result = await this.responseHeaderRulesService.update(
      id,
      dto,
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_response_header_rule',
    description: 'Delete a response header rule.',
    parameters: z.object({
      id: z.string().describe('Response header rule ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteRule(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.responseHeaderRulesService.delete(id, user.id, user.role);
    return JSON.stringify({ success: true, id });
  }
}
