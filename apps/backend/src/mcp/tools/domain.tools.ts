import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { DomainsService } from '../../domains/domains.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class DomainTools {
  constructor(
    private readonly domainsService: DomainsService,
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
    const result = await this.domainsService.findAll(user.id, {
      projectId: args.projectId,
      domainType: args.domainType,
      isActive: args.isActive,
    });
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
    const result = await this.domainsService.findOne(id, user.id);
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
      },
      user.id,
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
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { id, ...dto } = args;
    const result = await this.domainsService.update(id, dto, user.id);
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
    const result = await this.domainsService.remove(id, user.id);
    return JSON.stringify(result);
  }
}
