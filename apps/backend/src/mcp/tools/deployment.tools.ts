import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { DeploymentsService } from '../../deployments/deployments.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class DeploymentTools {
  constructor(
    private readonly deploymentsService: DeploymentsService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_deployments',
    description:
      'List deployments with optional filters by repository (owner/name), branch, or commit SHA.',
    parameters: z.object({
      repository: z
        .string()
        .optional()
        .describe('Filter by repository in "owner/name" format'),
      branch: z.string().optional().describe('Filter by branch name'),
      commitSha: z.string().optional().describe('Filter by commit SHA prefix'),
      page: z.number().optional().describe('Page number (default 1)'),
      limit: z.number().optional().describe('Items per page (default 20)'),
    }),
  })
  async listDeployments(
    args: {
      repository?: string;
      branch?: string;
      commitSha?: string;
      page?: number;
      limit?: number;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.deploymentsService.listDeployments(
      {
        repository: args.repository,
        branch: args.branch,
        commitSha: args.commitSha,
        page: args.page,
        limit: args.limit,
      },
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_deployment',
    description: 'Get detailed information about a specific deployment including files and aliases.',
    parameters: z.object({
      deploymentId: z.string().describe('Deployment ID (UUID)'),
    }),
  })
  async getDeployment(
    { deploymentId }: { deploymentId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.deploymentsService.getDeployment(deploymentId, user.id, user.role);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_deployment',
    description: 'Delete a deployment and all its files from storage. This is irreversible.',
    parameters: z.object({
      deploymentId: z.string().describe('Deployment ID (UUID) to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteDeployment(
    { deploymentId }: { deploymentId: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.deploymentsService.deleteDeployment(deploymentId, user.id, user.role);
    return JSON.stringify({ success: true, deploymentId });
  }

  @Tool({
    name: 'list_aliases',
    description: 'List deployment aliases, optionally filtered by repository.',
    parameters: z.object({
      repository: z
        .string()
        .optional()
        .describe('Filter by repository in "owner/name" format'),
    }),
  })
  async listAliases(
    args: { repository?: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.deploymentsService.listAliases(
      { repository: args.repository },
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_alias',
    description: 'Create or update a deployment alias (e.g. "production", "staging").',
    parameters: z.object({
      deploymentId: z.string().describe('Deployment ID to alias'),
      alias: z.string().describe('Alias name (e.g. "production")'),
      commitSha: z.string().describe('Commit SHA the deployment belongs to'),
    }),
  })
  async createAlias(
    args: { deploymentId: string; alias: string; commitSha: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.deploymentsService.createAlias(
      args.deploymentId,
      { alias: args.alias, commitSha: args.commitSha },
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_alias',
    description: 'Update an alias to point to a different commit SHA.',
    parameters: z.object({
      repository: z.string().describe('Repository in "owner/name" format'),
      alias: z.string().describe('Alias name to update'),
      commitSha: z.string().describe('New commit SHA to point to'),
    }),
  })
  async updateAlias(
    args: { repository: string; alias: string; commitSha: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.deploymentsService.updateAlias(
      args.repository,
      args.alias,
      { commitSha: args.commitSha },
      user.id,
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_alias',
    description: 'Delete a deployment alias.',
    parameters: z.object({
      repository: z.string().describe('Repository in "owner/name" format'),
      alias: z.string().describe('Alias name to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteAlias(
    args: { repository: string; alias: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.deploymentsService.deleteAlias(
      args.repository,
      args.alias,
      user.id,
      user.role,
    );
    return JSON.stringify({ success: true, alias: args.alias });
  }
}
