import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { and, eq, lt, lte, or, isNull } from 'drizzle-orm';
import parser from 'cron-parser';
import { db } from '../db/client';
import {
  pipelineSchedules,
  PipelineSchedule,
  proxyRules,
  proxyRuleSets,
} from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { SystemPipelineTriggerService } from '../pipelines/execution/system-pipeline-trigger.service';
import {
  CreatePipelineScheduleDto,
  UpdatePipelineScheduleDto,
  PipelineScheduleResponseDto,
} from './pipeline-schedules.dto';

/**
 * A claimed run older than this is considered stale and may be reclaimed — so a
 * crashed/killed run never wedges a schedule forever.
 */
const CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Project-scoped CRUD + the due-run engine for pipeline schedules. The
 * @Cron poller (see PipelineSchedulesScheduler) delegates to
 * {@link runDueSchedules}; everything else is called from the API.
 */
@Injectable()
export class PipelineSchedulesService {
  private readonly logger = new Logger(PipelineSchedulesService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly systemTrigger: SystemPipelineTriggerService,
  ) {}

  // ==================== CRUD ====================

  async listSchedules(
    projectId: string,
    userId: string,
    userRole?: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineScheduleResponseDto[]> {
    await this.permissionsService.requireProjectAccess(
      projectId,
      userId,
      userRole,
      'viewer',
      apiKeyProjectId,
    );
    const rows = await db
      .select()
      .from(pipelineSchedules)
      .where(eq(pipelineSchedules.projectId, projectId));
    return rows.map((r) => this.toResponse(r));
  }

  async getSchedule(
    id: string,
    userId: string,
    userRole?: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineScheduleResponseDto> {
    const row = await this.getById(id);
    await this.permissionsService.requireProjectAccess(
      row.projectId,
      userId,
      userRole,
      'viewer',
      apiKeyProjectId,
    );
    return this.toResponse(row);
  }

  async createSchedule(
    projectId: string,
    dto: CreatePipelineScheduleDto,
    userId: string,
    userRole?: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineScheduleResponseDto> {
    await this.permissionsService.requireProjectAccess(
      projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    const timezone = dto.timezone || 'UTC';
    // Validate cron + tz, and seed the first nextRunAt.
    const nextRunAt = this.computeNextRun(dto.cronExpression, timezone, new Date());

    // The target proxy rule must exist and belong to this project.
    await this.assertTargetInProject(dto.targetProxyRuleId, projectId);

    const [row] = await db
      .insert(pipelineSchedules)
      .values({
        projectId,
        name: dto.name,
        targetProxyRuleId: dto.targetProxyRuleId,
        cronExpression: dto.cronExpression,
        timezone,
        enabled: dto.enabled ?? true,
        nextRunAt,
      })
      .returning();

    this.logger.log(`Created pipeline schedule ${row.id} for project ${projectId}`);
    return this.toResponse(row);
  }

  async updateSchedule(
    id: string,
    dto: UpdatePipelineScheduleDto,
    userId: string,
    userRole?: string,
    apiKeyProjectId?: string | null,
  ): Promise<PipelineScheduleResponseDto> {
    const existing = await this.getById(id);
    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    const cronExpression = dto.cronExpression ?? existing.cronExpression;
    const timezone = dto.timezone ?? existing.timezone;
    const enabled = dto.enabled ?? existing.enabled;

    const updates: Partial<typeof pipelineSchedules.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.cronExpression !== undefined) updates.cronExpression = dto.cronExpression;
    if (dto.timezone !== undefined) updates.timezone = dto.timezone;
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;

    // Recompute nextRunAt whenever the cadence changes or a disabled schedule is
    // re-enabled, so it doesn't fire against a stale/out-of-date next time.
    const cadenceChanged = dto.cronExpression !== undefined || dto.timezone !== undefined;
    const reEnabled = dto.enabled === true && !existing.enabled;
    if (enabled && (cadenceChanged || reEnabled)) {
      updates.nextRunAt = this.computeNextRun(cronExpression, timezone, new Date());
    } else if (cadenceChanged) {
      // Validate even when disabled, so a bad expression is rejected at write time.
      this.computeNextRun(cronExpression, timezone, new Date());
    }

    const [row] = await db
      .update(pipelineSchedules)
      .set(updates)
      .where(eq(pipelineSchedules.id, id))
      .returning();

    return this.toResponse(row);
  }

  async deleteSchedule(
    id: string,
    userId: string,
    userRole?: string,
    apiKeyProjectId?: string | null,
  ): Promise<void> {
    const existing = await this.getById(id);
    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );
    await db.delete(pipelineSchedules).where(eq(pipelineSchedules.id, id));
    this.logger.log(`Deleted pipeline schedule ${id}`);
  }

  // ==================== Due-run engine ====================

  /**
   * Find enabled schedules whose nextRunAt is due, atomically claim each, and
   * fire its target pipeline. Called by the @Cron poller. Never throws — a bad
   * schedule records its own `lastError` and the rest continue.
   *
   * @returns counts for observability/testing.
   */
  async runDueSchedules(now: Date = new Date()): Promise<{ due: number; ran: number }> {
    const stale = new Date(now.getTime() - CLAIM_STALE_MS);

    const dueRows = await db
      .select()
      .from(pipelineSchedules)
      .where(
        and(
          eq(pipelineSchedules.enabled, true),
          lte(pipelineSchedules.nextRunAt, now),
          or(
            isNull(pipelineSchedules.executionStartedAt),
            lt(pipelineSchedules.executionStartedAt, stale),
          ),
        ),
      );

    let ran = 0;
    for (const schedule of dueRows) {
      // Atomic claim: the conditional UPDATE only succeeds for the worker that
      // flips executionStartedAt from null/stale to now — a concurrent poller's
      // UPDATE matches zero rows. This is the double-fire guard (not an
      // in-process boolean), safe even if replicas are added later.
      const claimed = await db
        .update(pipelineSchedules)
        .set({ executionStartedAt: now, updatedAt: now })
        .where(
          and(
            eq(pipelineSchedules.id, schedule.id),
            or(
              isNull(pipelineSchedules.executionStartedAt),
              lt(pipelineSchedules.executionStartedAt, stale),
            ),
          ),
        )
        .returning({ id: pipelineSchedules.id });

      if (claimed.length === 0) {
        continue; // another worker claimed it first
      }

      ran++;
      await this.executeSchedule(schedule, now);
    }

    return { due: dueRows.length, ran };
  }

  /**
   * Fire one schedule's target pipeline in a system context, then advance
   * lastRunAt/nextRunAt and record any error, releasing the claim. Swallows all
   * errors — a failing run must not stop the poller or wedge the schedule.
   */
  private async executeSchedule(schedule: PipelineSchedule, now: Date): Promise<void> {
    let lastError: string | null = null;
    try {
      const outcome = await this.systemTrigger.triggerByProxyRuleId(schedule.targetProxyRuleId, {
        source: `/internal/schedule/${schedule.id}`,
        body: {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          firedAt: now.toISOString(),
        },
        // No user: a true system run (createdBy stays null).
        captureDebug: false,
      });

      if (!outcome.found) {
        lastError = `Target proxy rule ${schedule.targetProxyRuleId} not found`;
      } else if (!outcome.hasPipeline) {
        lastError = `Target proxy rule ${schedule.targetProxyRuleId} has no pipeline configuration`;
      } else if (outcome.result && !outcome.result.success) {
        lastError = outcome.result.error?.message || 'Pipeline execution failed';
      }
    } catch (error) {
      lastError = (error as Error).message;
      this.logger.error(`Schedule ${schedule.id} threw during execution: ${lastError}`);
    }

    // Advance the schedule and release the claim regardless of outcome, so a
    // persistently-failing schedule retries next cadence instead of hot-looping.
    let nextRunAt: Date;
    try {
      nextRunAt = this.computeNextRun(schedule.cronExpression, schedule.timezone, now);
    } catch (error) {
      // Cron became unparseable somehow — back off an hour and record it.
      nextRunAt = new Date(now.getTime() + 60 * 60 * 1000);
      lastError = `Invalid cron expression: ${(error as Error).message}`;
    }

    await db
      .update(pipelineSchedules)
      .set({
        lastRunAt: now,
        nextRunAt,
        executionStartedAt: null,
        lastError,
        updatedAt: new Date(),
      })
      .where(eq(pipelineSchedules.id, schedule.id));

    if (lastError) {
      this.logger.warn(`Schedule ${schedule.id} ran with error: ${lastError}`);
    } else {
      this.logger.debug(`Schedule ${schedule.id} ran; next at ${nextRunAt.toISOString()}`);
    }
  }

  // ==================== Helpers ====================

  /**
   * Compute the next fire time from a cron expression in a timezone. Throws
   * BadRequestException on an invalid expression/timezone — used both to
   * validate at write time and to advance after a run.
   */
  private computeNextRun(cronExpression: string, timezone: string, from: Date): Date {
    try {
      const interval = parser.parseExpression(cronExpression, {
        tz: timezone,
        currentDate: from,
      });
      return interval.next().toDate();
    } catch (error) {
      throw new BadRequestException(
        `Invalid cron expression or timezone: ${(error as Error).message}`,
      );
    }
  }

  private async assertTargetInProject(proxyRuleId: string, projectId: string): Promise<void> {
    const [row] = await db
      .select({ projectId: proxyRuleSets.projectId })
      .from(proxyRules)
      .innerJoin(proxyRuleSets, eq(proxyRules.ruleSetId, proxyRuleSets.id))
      .where(eq(proxyRules.id, proxyRuleId))
      .limit(1);

    if (!row) {
      throw new BadRequestException(`Target proxy rule not found: ${proxyRuleId}`);
    }
    if (row.projectId !== projectId) {
      throw new BadRequestException('Target proxy rule does not belong to this project');
    }
  }

  private async getById(id: string): Promise<PipelineSchedule> {
    const [row] = await db
      .select()
      .from(pipelineSchedules)
      .where(eq(pipelineSchedules.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Pipeline schedule not found: ${id}`);
    }
    return row;
  }

  private toResponse(row: PipelineSchedule): PipelineScheduleResponseDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      targetProxyRuleId: row.targetProxyRuleId,
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt || undefined,
      nextRunAt: row.nextRunAt || undefined,
      executionStartedAt: row.executionStartedAt || undefined,
      lastError: row.lastError || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
