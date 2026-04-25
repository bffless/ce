import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { CacheRulesService } from '../../cache-rules/cache-rules.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class CacheRulesTools {
  constructor(
    private readonly cacheRulesService: CacheRulesService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_cache_rules',
    description: 'List all cache rules for a project.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listRules(
    { projectId }: { projectId: string },
    _context: Context,
    request: Request,
  ) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.cacheRulesService.getRulesByProjectId(projectId, apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_cache_rule',
    description: 'Get a cache rule by ID.',
    parameters: z.object({
      id: z.string().describe('Cache rule ID'),
    }),
  })
  async getRule({ id }: { id: string }, _context: Context, request: Request) {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    const result = await this.cacheRulesService.getRuleById(id);
    if (
      result &&
      apiKeyProjectId !== undefined &&
      apiKeyProjectId !== null &&
      apiKeyProjectId !== result.projectId
    ) {
      // Don't leak existence — return null as if not found.
      return JSON.stringify(null);
    }
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_cache_rule',
    description: 'Create a new cache rule for a project.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      pathPattern: z.string().describe('Glob pattern to match paths (e.g. "*.js", "images/**")'),
      name: z.string().optional().describe('Rule name'),
      description: z.string().optional().describe('Rule description'),
      browserMaxAge: z.number().optional().describe('Browser cache max-age in seconds'),
      cdnMaxAge: z.number().optional().describe('CDN cache max-age in seconds'),
      staleWhileRevalidate: z
        .number()
        .optional()
        .describe('Stale-while-revalidate window in seconds'),
      immutable: z.boolean().optional().describe('Mark assets as immutable'),
      isEnabled: z.boolean().optional().describe('Whether the rule is enabled'),
      priority: z.number().optional().describe('Rule priority (higher = evaluated first)'),
    }),
  })
  async createRule(
    args: {
      projectId: string;
      pathPattern: string;
      name?: string;
      description?: string;
      browserMaxAge?: number;
      cdnMaxAge?: number;
      staleWhileRevalidate?: number;
      immutable?: boolean;
      isEnabled?: boolean;
      priority?: number;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { projectId, ...dto } = args;
    const result = await this.cacheRulesService.create(
      projectId,
      dto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_cache_rule',
    description: 'Delete a cache rule.',
    parameters: z.object({
      id: z.string().describe('Cache rule ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteRule(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.cacheRulesService.delete(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }
}
