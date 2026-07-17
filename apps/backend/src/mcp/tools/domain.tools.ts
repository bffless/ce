import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { DomainsService } from '../../domains/domains.service';
import { TrafficRoutingService } from '../../domains/traffic-routing.service';
import { TrafficRulesService } from '../../domains/traffic-rules.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

/**
 * Parameters for the `set_traffic_weights` tool. Exported so the schema (and the
 * sum-to-100 refinement) can be unit-tested independently of the NestJS wiring.
 *
 * The per-weight `path` is optional and falls back to the domain mapping's path
 * (`public.controller.ts` uses `variantSelection?.selectedPath ?? mapping.path`),
 * so agents rarely need to set it.
 */
export const setTrafficWeightsParameters = z
  .object({
    domainId: z.string().describe('Domain mapping ID (UUID) to configure'),
    weights: z
      .array(
        z.object({
          alias: z.string().describe('Deployment alias to receive traffic (e.g. "production")'),
          weight: z
            .number()
            .int()
            .min(0)
            .max(100)
            .describe('Weight percentage (0–100); all weights must sum to 100'),
          path: z
            .string()
            .optional()
            .describe(
              'Optional path override within the deployment for this alias (e.g. "site-v1/dist"). Falls back to the domain mapping path when omitted.',
            ),
        }),
      )
      .min(1)
      .describe('Weighted alias distribution; weights must sum to 100'),
    stickySessionsEnabled: z
      .boolean()
      .optional()
      .describe('Pin a visitor to their first-selected variant via the __bffless_variant cookie (default true)'),
    stickySessionDuration: z
      .number()
      .int()
      .min(0)
      .max(2592000)
      .optional()
      .describe('Sticky session cookie lifetime in seconds; 0 = no expiration, max 30 days (default 86400)'),
  })
  .refine((v) => v.weights.reduce((sum, w) => sum + w.weight, 0) === 100, {
    message: 'Traffic weights must sum to 100. Use clear_traffic_weights to return to a single alias.',
    path: ['weights'],
  });

@Injectable()
export class DomainTools {
  constructor(
    private readonly domainsService: DomainsService,
    private readonly trafficRoutingService: TrafficRoutingService,
    private readonly trafficRulesService: TrafficRulesService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_domains',
    description: 'List all domain mappings, optionally filtered by project, type, or active status.',
    parameters: z.object({
      projectId: z.string().optional().describe('Filter by project ID'),
      domainType: z
        .string()
        .optional()
        .describe('Filter by type: "subdomain", "custom", or "redirect"'),
      isActive: z.boolean().optional().describe('Filter by active status'),
    }),
  })
  async listDomains(
    args: { projectId?: string; domainType?: string; isActive?: boolean },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.domainsService.findAll(
      user.id,
      {
        projectId: args.projectId,
        domainType: args.domainType,
        isActive: args.isActive,
      },
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_domain',
    description: 'Get details of a specific domain mapping by ID.',
    parameters: z.object({
      id: z.string().describe('Domain mapping ID (UUID)'),
    }),
  })
  async getDomain(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.domainsService.findOne(id, user.id, user.apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_domain',
    description:
      'Create a new domain mapping (subdomain, custom domain, or redirect). Requires admin role. NOTE: The domain serves content from a deployment alias. For proxy rules (API endpoints) to work, the alias must have a proxy rule set assigned via update_alias(proxyRuleSetId).',
    parameters: z.object({
      domain: z.string().describe('The domain name (e.g. "app.example.com")'),
      domainType: z
        .enum(['subdomain', 'custom', 'redirect'])
        .describe('Type of domain mapping'),
      projectId: z
        .string()
        .optional()
        .describe('Project ID to map to (required for subdomain/custom)'),
      alias: z
        .string()
        .optional()
        .describe('Deployment alias to serve (e.g. "production")'),
      path: z
        .string()
        .optional()
        .describe(
          'Subdirectory within the deployment to serve as the root (e.g. "apps/myapp/dist" for monorepo deployments where files are nested under a build path)',
        ),
      redirectTarget: z
        .string()
        .optional()
        .describe('Target URL for redirect domains'),
      redirectType: z
        .enum(['301', '302'])
        .optional()
        .describe(
          'HTTP redirect status code for redirect domains: "301" permanent (default), "302" temporary',
        ),
    }),
  })
  async createDomain(
    args: {
      domain: string;
      domainType: 'subdomain' | 'custom' | 'redirect';
      projectId?: string;
      alias?: string;
      path?: string;
      redirectTarget?: string;
      redirectType?: '301' | '302';
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.domainsService.create(
      {
        domain: args.domain,
        domainType: args.domainType,
        projectId: args.projectId,
        alias: args.alias,
        path: args.path,
        redirectTarget: args.redirectTarget,
        redirectType: args.redirectType,
      },
      user.id,
      undefined,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_domain',
    description:
      'Update a domain mapping. Can change alias, path, visibility, SPA mode, www behavior, etc. Requires admin role.',
    parameters: z.object({
      id: z.string().describe('Domain mapping ID (UUID) to update'),
      alias: z.string().optional().describe('Deployment alias to serve (e.g. "production")'),
      path: z
        .string()
        .optional()
        .describe(
          'Subdirectory within the deployment to serve as the root (e.g. "apps/myapp/dist")',
        ),
      isActive: z.boolean().optional().describe('Active status'),
      isPublic: z
        .boolean()
        .nullable()
        .optional()
        .describe('Visibility: true=public, false=private, null=inherit from alias/project'),
      isSpa: z.boolean().optional().describe('Enable SPA fallback (serve index.html for all paths)'),
      wwwBehavior: z
        .enum(['redirect-to-www', 'redirect-to-root', 'serve-both'])
        .optional()
        .describe('How to handle www/apex redirects'),
      redirectTarget: z.string().optional().describe('Target domain for redirect type'),
      redirectType: z
        .enum(['301', '302'])
        .optional()
        .describe(
          'HTTP redirect status code for redirect domains: "301" permanent, "302" temporary',
        ),
    }),
  })
  async updateDomain(
    args: {
      id: string;
      alias?: string;
      path?: string;
      isActive?: boolean;
      isPublic?: boolean | null;
      isSpa?: boolean;
      wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
      redirectTarget?: string;
      redirectType?: '301' | '302';
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { id, ...dto } = args;
    const result = await this.domainsService.update(id, dto, user.id, user.apiKeyProjectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_domain',
    description:
      'Delete a domain mapping. Removes nginx config and notifies control plane. Requires admin role.',
    parameters: z.object({
      id: z.string().describe('Domain mapping ID (UUID) to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteDomain(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.domainsService.remove(id, user.id, undefined, user.apiKeyProjectId);
    return JSON.stringify(result);
  }

  // =====================
  // Traffic Splitting: Weights
  // =====================

  @Tool({
    name: 'get_traffic_config',
    description:
      'Get the traffic-splitting configuration for a domain: weighted alias distribution plus sticky-session settings ({ weights[], stickySessionsEnabled, stickySessionDuration }). Empty weights means the domain serves its single alias.',
    parameters: z.object({
      domainId: z.string().describe('Domain mapping ID (UUID)'),
    }),
  })
  async getTrafficConfig(
    { domainId }: { domainId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.trafficRoutingService.getTrafficConfig(domainId, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'set_traffic_weights',
    description:
      'Configure weighted traffic splitting (A/B testing / canary) across deployment aliases for a domain. Weights must sum to 100. Replaces any existing weights. Optionally set sticky sessions so a visitor stays on their first-selected variant. Per-weight "path" is optional and falls back to the domain mapping path. Requires admin role.',
    parameters: setTrafficWeightsParameters,
  })
  async setTrafficWeights(
    args: z.infer<typeof setTrafficWeightsParameters>,
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { domainId, ...dto } = args;
    const result = await this.trafficRoutingService.setTrafficWeights(domainId, dto, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'clear_traffic_weights',
    description:
      'Clear traffic splitting for a domain, returning it to serving its single alias. Requires admin role.',
    parameters: z.object({
      domainId: z.string().describe('Domain mapping ID (UUID)'),
    }),
    annotations: { destructiveHint: true },
  })
  async clearTrafficWeights(
    { domainId }: { domainId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.trafficRoutingService.clearTrafficWeights(domainId, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'list_traffic_aliases',
    description:
      'List the deployment aliases available to weight for a domain (the aliases that exist on the domain\'s project). Use this to discover valid alias names before calling set_traffic_weights.',
    parameters: z.object({
      domainId: z.string().describe('Domain mapping ID (UUID)'),
    }),
  })
  async listTrafficAliases(
    { domainId }: { domainId: string },
    _context: Context,
    request: Request,
  ) {
    await getUserContext(request, this.authService);
    const result = await this.trafficRoutingService.getAvailableAliases(domainId);
    return JSON.stringify(result);
  }

  // =====================
  // Traffic Splitting: Rules (override weights; first match wins by priority)
  // =====================

  @Tool({
    name: 'list_traffic_rules',
    description:
      'List traffic routing rules for a domain, ordered by priority. Rules force a specific alias when a query param, cookie, or header matches, overriding the weighted split.',
    parameters: z.object({
      domainId: z.string().describe('Domain mapping ID (UUID)'),
    }),
  })
  async listTrafficRules(
    { domainId }: { domainId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.trafficRulesService.findByDomain(domainId, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_traffic_rule',
    description:
      'Create a traffic routing rule that forces a specific alias when a request matches a condition (query param, cookie, or header). Rules override the weighted split; lower priority is evaluated first, first match wins. Requires admin role.',
    parameters: z.object({
      domainId: z.string().describe('Domain mapping ID (UUID)'),
      alias: z.string().describe('Alias to force when the condition matches (e.g. "canary")'),
      conditionType: z
        .enum(['query_param', 'cookie', 'header'])
        .describe('What part of the request to match against'),
      conditionKey: z
        .string()
        .describe('Name of the query param, cookie, or header to match (e.g. "v", "token")'),
      conditionValue: z.string().describe('Value the key must equal for the rule to match'),
      priority: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Lower is evaluated first (default 100)'),
      label: z.string().optional().describe('Optional human-readable label for the rule'),
    }),
  })
  async createTrafficRule(
    args: {
      domainId: string;
      alias: string;
      conditionType: 'query_param' | 'cookie' | 'header';
      conditionKey: string;
      conditionValue: string;
      priority?: number;
      label?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { domainId, ...dto } = args;
    const result = await this.trafficRulesService.create(domainId, dto, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_traffic_rule',
    description:
      'Update a traffic routing rule by ID. Any omitted field is left unchanged. Requires admin role.',
    parameters: z.object({
      ruleId: z.string().describe('Traffic rule ID (UUID) to update'),
      alias: z.string().optional().describe('Alias to force when the condition matches'),
      conditionType: z
        .enum(['query_param', 'cookie', 'header'])
        .optional()
        .describe('What part of the request to match against'),
      conditionKey: z.string().optional().describe('Name of the query param, cookie, or header'),
      conditionValue: z.string().optional().describe('Value the key must equal'),
      priority: z.number().int().min(0).optional().describe('Lower is evaluated first'),
      isActive: z.boolean().optional().describe('Whether the rule is active'),
      label: z.string().optional().describe('Human-readable label for the rule'),
    }),
  })
  async updateTrafficRule(
    args: {
      ruleId: string;
      alias?: string;
      conditionType?: 'query_param' | 'cookie' | 'header';
      conditionKey?: string;
      conditionValue?: string;
      priority?: number;
      isActive?: boolean;
      label?: string;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { ruleId, ...dto } = args;
    const result = await this.trafficRulesService.update(ruleId, dto, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_traffic_rule',
    description: 'Delete a traffic routing rule by ID. Requires admin role.',
    parameters: z.object({
      ruleId: z.string().describe('Traffic rule ID (UUID) to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteTrafficRule(
    { ruleId }: { ruleId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.trafficRulesService.remove(ruleId, user.id);
    return JSON.stringify(result);
  }
}
