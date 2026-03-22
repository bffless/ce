import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { PrimaryContentService } from '../../settings/primary-content.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class SettingsTools {
  constructor(
    private readonly primaryContentService: PrimaryContentService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'get_primary_content_config',
    description:
      'Get the primary content configuration (which project/alias is served on the root domain).',
    parameters: z.object({}),
  })
  async getConfig(_args: object, _context: Context, _request: Request) {
    const result = await this.primaryContentService.getConfig();
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_primary_content_config',
    description:
      'Update primary content configuration. Controls which project/alias is served on the root domain. Requires admin role.',
    parameters: z.object({
      enabled: z.boolean().optional().describe('Enable/disable primary content'),
      projectId: z.string().optional().describe('Project ID to serve'),
      alias: z.string().optional().describe('Deployment alias to serve'),
      path: z
        .string()
        .optional()
        .describe(
          'Subdirectory within the deployment to serve as the root (e.g. "apps/home/dist" for monorepo deployments where files are nested under a build path)',
        ),
      isSpa: z.boolean().optional().describe('Enable SPA fallback (serve index.html for all paths)'),
      wwwBehavior: z
        .enum(['redirect-to-www', 'redirect-to-root', 'serve-both'])
        .optional()
        .describe('How to handle www subdomain'),
    }),
  })
  async updateConfig(
    args: {
      enabled?: boolean;
      projectId?: string;
      alias?: string;
      path?: string;
      isSpa?: boolean;
      wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.primaryContentService.updateConfig(args, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'list_available_projects_for_primary_content',
    description: 'List projects available for primary content configuration, with their aliases.',
    parameters: z.object({}),
  })
  async listAvailableProjects(_args: object, _context: Context, _request: Request) {
    const result = await this.primaryContentService.getAvailableProjects();
    return JSON.stringify(result);
  }
}
