import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { PipelineSchedulesService } from '../../pipeline-schedules/pipeline-schedules.service';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class PipelineSchedulesTools {
  constructor(
    private readonly schedulesService: PipelineSchedulesService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_pipeline_schedules',
    description:
      'List all pipeline schedules (cron-triggered pipeline runs) for a project. Each schedule fires a pipeline-type proxy rule on a cron cadence.',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
    }),
  })
  async listSchedules({ projectId }: { projectId: string }, _context: Context, request: Request) {
    const user = await getUserContext(request, this.authService);
    const result = await this.schedulesService.listSchedules(
      projectId,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'create_pipeline_schedule',
    description:
      'Create a pipeline schedule: fire a pipeline-type proxy rule on a cron cadence. The target proxy rule must belong to the project and have a pipeline configuration. The run executes as a system trigger (no user context).',
    parameters: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Schedule name'),
      targetProxyRuleId: z
        .string()
        .describe('ID of the pipeline-type proxy rule to fire (must belong to this project)'),
      cronExpression: z
        .string()
        .describe(
          'Cron expression, e.g. "*/15 * * * *" (every 15 min) or "17 3 * * *" (03:17 daily)',
        ),
      timezone: z
        .string()
        .optional()
        .describe('IANA timezone for the cron expression (default UTC)'),
      enabled: z.boolean().optional().describe('Whether the schedule is active (default true)'),
    }),
  })
  async createSchedule(
    args: {
      projectId: string;
      name: string;
      targetProxyRuleId: string;
      cronExpression: string;
      timezone?: string;
      enabled?: boolean;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { projectId, ...dto } = args;
    const result = await this.schedulesService.createSchedule(
      projectId,
      dto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_pipeline_schedule',
    description:
      'Update a pipeline schedule (rename, change cron/timezone, enable/disable). Only provided fields change; nextRunAt is recomputed when the cadence changes or a disabled schedule is re-enabled.',
    parameters: z.object({
      id: z.string().describe('Schedule ID'),
      name: z.string().optional().describe('New schedule name'),
      cronExpression: z.string().optional().describe('New cron expression'),
      timezone: z.string().optional().describe('New IANA timezone'),
      enabled: z.boolean().optional().describe('Enable or disable the schedule'),
    }),
  })
  async updateSchedule(
    args: {
      id: string;
      name?: string;
      cronExpression?: string;
      timezone?: string;
      enabled?: boolean;
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    const { id, ...dto } = args;
    const result = await this.schedulesService.updateSchedule(
      id,
      dto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return JSON.stringify(result);
  }

  @Tool({
    name: 'delete_pipeline_schedule',
    description: 'Delete a pipeline schedule. The target proxy rule is not affected.',
    parameters: z.object({
      id: z.string().describe('Schedule ID to delete'),
    }),
    annotations: { destructiveHint: true },
  })
  async deleteSchedule({ id }: { id: string }, _context: Context, request: Request) {
    const user = await getUserContext(request, this.authService);
    await this.schedulesService.deleteSchedule(id, user.id, user.role, user.apiKeyProjectId);
    return JSON.stringify({ success: true, id });
  }
}
