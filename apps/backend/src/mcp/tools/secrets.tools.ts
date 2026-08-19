import { Injectable, ForbiddenException } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { ProjectSecretsService } from '../../projects/project-secrets.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

/**
 * MCP tools for managing project secrets.
 *
 * Secret VALUES are write-only: list_secrets returns names + metadata only and
 * there is intentionally no tool to read a value back, mirroring the REST layer.
 */
@Injectable()
export class SecretsTools {
  constructor(
    private readonly secretsService: ProjectSecretsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * If the request is authenticated with a project-scoped API key, ensure the
   * requested project matches. Prevents a scoped key from touching other
   * projects' secrets.
   */
  private assertProjectAllowed(request: Request, projectId: string): void {
    const apiKeyProjectId = (request as any)?.user?.apiKeyProjectId;
    if (
      apiKeyProjectId !== undefined &&
      apiKeyProjectId !== null &&
      apiKeyProjectId !== projectId
    ) {
      throw new ForbiddenException('API key is not scoped to this project');
    }
  }

  @Tool({
    name: 'list_secrets',
    description:
      'List secret names and metadata for a project. Secret VALUES are never returned — they cannot be read back once set.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listSecrets({ projectId }: { projectId: string }, _context: Context, request: Request) {
    this.assertProjectAllowed(request, projectId);
    const result = await this.secretsService.listSecrets(projectId);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'set_secret',
    description:
      'Create or rotate a project secret. The value is encrypted at rest and cannot be read back afterwards. Pipelines reference it as secrets.<NAME>. Names must be uppercase letters, digits and underscores (e.g. HF_TOKEN).',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Secret name, e.g. HF_TOKEN'),
      value: z.string().describe('Secret value (write-only; will be encrypted)'),
    }),
    annotations: { destructiveHint: true },
  })
  async setSecret(
    { projectId, name, value }: { projectId: string; name: string; value: string },
    _context: Context,
    request: Request,
  ) {
    this.assertProjectAllowed(request, projectId);
    const user = await getUserContext(request, this.authService);
    const result = await this.secretsService.setSecret(projectId, name, value, user.id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_secret',
    description: 'Delete a project secret by name.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Secret name to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteSecret(
    { projectId, name }: { projectId: string; name: string },
    _context: Context,
    request: Request,
  ) {
    this.assertProjectAllowed(request, projectId);
    const result = await this.secretsService.deleteSecret(projectId, name);
    return JSON.stringify(result);
  }
}
