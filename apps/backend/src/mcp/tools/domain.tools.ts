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
      'Create a new domain mapping (subdomain, custom domain, or redirect). Requires admin role.',
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
      path: z.string().optional().describe('Subdirectory path to serve'),
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
