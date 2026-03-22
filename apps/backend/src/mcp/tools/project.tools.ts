import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { ProjectsService } from '../../projects/projects.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class ProjectTools {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_projects',
    description:
      'List all projects accessible to the current user, with permission type and role for each.',
    parameters: z.object({}),
  })
  async listProjects(_args: object, _context: Context, request: Request) {
    const user = await getUserContext(request, this.authService);
    const result = await this.projectsService.getMyRepositories(user.id, user.role);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_project',
    description: 'Get a project by owner and name (e.g. owner="acme", name="website").',
    parameters: z.object({
      owner: z.string().describe('Project owner'),
      name: z.string().describe('Project name'),
    }),
  })
  async getProject(
    { owner, name }: { owner: string; name: string },
    _context: Context,
    _request: Request,
  ) {
    const project = await this.projectsService.getProjectByOwnerName(owner, name);
    return JSON.stringify(project);
  }

  @Tool({
    name: 'create_project',
    description: 'Create a new project.',
    parameters: z.object({
      owner: z.string().describe('Project owner'),
      name: z.string().describe('Project name'),
      displayName: z.string().optional().describe('Human-readable display name'),
      description: z.string().optional().describe('Project description'),
      isPublic: z.boolean().optional().describe('Whether the project is publicly accessible'),
    }),
    annotations: { destructiveHint: false },
  })
  async createProject(
    args: {
      owner: string;
      name: string;
      displayName?: string;
      description?: string;
      isPublic?: boolean;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const project = await this.projectsService.createProject({
      owner: args.owner,
      name: args.name,
      displayName: args.displayName ?? args.name,
      description: args.description ?? null,
      isPublic: args.isPublic ?? false,
      settings: {},
      createdBy: user.id,
    });
    return JSON.stringify(project);
  }

  @Tool({
    name: 'update_project',
    description: 'Update project settings (display name, description, visibility).',
    parameters: z.object({
      projectId: z.string().describe('Project ID (UUID)'),
      displayName: z.string().optional().describe('New display name'),
      description: z.string().optional().describe('New description'),
      isPublic: z.boolean().optional().describe('New visibility setting'),
    }),
  })
  async updateProject(
    args: {
      projectId: string;
      displayName?: string;
      description?: string;
      isPublic?: boolean;
    },
    _context: Context,
    _request: Request,
  ) {
    const updates: Record<string, any> = {};
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.description !== undefined) updates.description = args.description;
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic;

    const project = await this.projectsService.updateProject(args.projectId, updates);
    return JSON.stringify(project);
  }

  @Tool({
    name: 'delete_project',
    description:
      'Delete a project and all its deployments, aliases, and storage files. This is irreversible.',
    parameters: z.object({
      projectId: z.string().describe('Project ID (UUID) to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteProject(
    { projectId }: { projectId: string },
    _context: Context,
    _request: Request,
  ) {
    await this.projectsService.deleteProject(projectId);
    return JSON.stringify({ success: true, projectId });
  }
}
