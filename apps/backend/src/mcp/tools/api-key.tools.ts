import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class ApiKeyTools {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_api_keys',
    description: 'List API keys for the current user with pagination.',
    parameters: z.object({
      page: z.number().optional().describe('Page number (default 1)'),
      limit: z.number().optional().describe('Items per page (default 20)'),
    }),
  })
  async listApiKeys(
    args: { page?: number; limit?: number },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.apiKeysService.findAll(user.id, args);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_api_key',
    description:
      'Create a new API key. Returns the raw key only once. Global keys require admin role.',
    parameters: z.object({
      name: z.string().describe('Display name for the key'),
      repository: z
        .string()
        .optional()
        .describe('Scope to a repository in "owner/repo" format (omit for global)'),
      isGlobal: z.boolean().optional().describe('Create a global key (admin only)'),
      expiresAt: z.string().optional().describe('Expiration date (ISO 8601)'),
    }),
  })
  async createApiKey(
    args: { name: string; repository?: string; isGlobal?: boolean; expiresAt?: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const result = await this.apiKeysService.create(
      user.id,
      {
        name: args.name,
        repository: args.repository,
        isGlobal: args.isGlobal,
        expiresAt: args.expiresAt,
      },
      user.role,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_api_key',
    description: 'Delete an API key.',
    parameters: z.object({
      id: z.string().describe('API key ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteApiKey(
    { id }: { id: string },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    await this.apiKeysService.remove(id, user.id);
    return JSON.stringify({ success: true, id });
  }
}
