import { Injectable, Logger } from '@nestjs/common';
import { eq, desc, sql, and, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelineExecutionLogs } from '../db/schema';
import type { PipelineDebugResult } from './execution/pipeline-context.interface';
import type { PipelineLogRequestMeta } from '../db/schema/pipeline-execution-logs.schema';

/**
 * Response header carrying the `pipeline_execution_logs.id` of the row a
 * pipeline proxy-rule response was logged under. Only present when the rule has
 * `debugEnabled`; the value resolves at `GET /api/pipeline-logs/:logId`.
 */
export const PIPELINE_LOG_ID_HEADER = 'X-Pipeline-Log-Id';

@Injectable()
export class PipelineExecutionLogService {
  private readonly logger = new Logger(PipelineExecutionLogService.name);
  private readonly DEFAULT_RETENTION = 50;

  /**
   * Persist a pipeline execution log and cleanup old entries beyond retention limit.
   *
   * `logId` lets the caller choose the row id up front — the proxy middleware
   * generates it before the HTTP response goes out so it can be echoed back as
   * `X-Pipeline-Log-Id` while the insert itself stays fire-and-forget. When
   * omitted the DB default (random uuid) applies. Resolves to the row id.
   */
  async log(
    proxyRuleId: string,
    projectId: string,
    result: PipelineDebugResult,
    requestMeta: PipelineLogRequestMeta,
    method: string,
    path: string,
    logId?: string,
  ): Promise<string> {
    // Determine status code
    let statusCode = 500;
    if (result.success && result.response) {
      statusCode = result.response.status;
    } else if (result.error) {
      const errorCode = result.error.code;
      if (errorCode === 'VALIDATION_ERROR') statusCode = 400;
      else if (errorCode === 'AUTH_REQUIRED') statusCode = 401;
      else if (errorCode === 'AUTHORIZATION_ERROR') statusCode = 403;
      else if (errorCode === 'RATE_LIMIT_EXCEEDED') statusCode = 429;
      else statusCode = 500;
    }

    const stepsCount = result.debug?.steps?.length ?? 0;

    const [inserted] = await db
      .insert(pipelineExecutionLogs)
      .values({
        ...(logId ? { id: logId } : {}),
        projectId,
        proxyRuleId,
        success: result.success,
        statusCode,
        method,
        path,
        durationMs: result.debug?.totalDurationMs ?? 0,
        stepsCount,
        errorCode: result.error?.code ?? null,
        errorMessage: result.error?.message ?? null,
        errorStep: result.error?.step ?? null,
        requestMeta,
        debug: result.debug ?? {
          validators: [],
          steps: [],
          totalDurationMs: 0,
          startTime: '',
          endTime: '',
        },
      })
      .returning({ id: pipelineExecutionLogs.id });

    // Cleanup old entries beyond retention limit
    await this.cleanup(proxyRuleId, this.DEFAULT_RETENTION);

    return inserted.id;
  }

  /**
   * Get paginated logs for a rule, newest first.
   */
  async getByRuleId(
    ruleId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{
    logs: Array<{
      id: string;
      success: boolean;
      statusCode: number;
      method: string;
      path: string;
      durationMs: number;
      stepsCount: number;
      errorCode: string | null;
      errorMessage: string | null;
      errorStep: string | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const offset = (page - 1) * pageSize;

    const [logs, countResult] = await Promise.all([
      db
        .select({
          id: pipelineExecutionLogs.id,
          success: pipelineExecutionLogs.success,
          statusCode: pipelineExecutionLogs.statusCode,
          method: pipelineExecutionLogs.method,
          path: pipelineExecutionLogs.path,
          durationMs: pipelineExecutionLogs.durationMs,
          stepsCount: pipelineExecutionLogs.stepsCount,
          errorCode: pipelineExecutionLogs.errorCode,
          errorMessage: pipelineExecutionLogs.errorMessage,
          errorStep: pipelineExecutionLogs.errorStep,
          createdAt: pipelineExecutionLogs.createdAt,
        })
        .from(pipelineExecutionLogs)
        .where(eq(pipelineExecutionLogs.proxyRuleId, ruleId))
        .orderBy(desc(pipelineExecutionLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pipelineExecutionLogs)
        .where(eq(pipelineExecutionLogs.proxyRuleId, ruleId)),
    ]);

    return {
      logs,
      total: countResult[0]?.count ?? 0,
      page,
      pageSize,
    };
  }

  /**
   * Get a single log by ID with full debug data.
   */
  async getById(id: string) {
    const [log] = await db
      .select()
      .from(pipelineExecutionLogs)
      .where(eq(pipelineExecutionLogs.id, id))
      .limit(1);

    return log ?? null;
  }

  /**
   * Get count of logs for a rule (for badge display).
   */
  async getCountByRuleId(ruleId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pipelineExecutionLogs)
      .where(eq(pipelineExecutionLogs.proxyRuleId, ruleId));

    return result?.count ?? 0;
  }

  /**
   * Delete all logs for a rule.
   */
  async deleteByRuleId(ruleId: string): Promise<void> {
    await db.delete(pipelineExecutionLogs).where(eq(pipelineExecutionLogs.proxyRuleId, ruleId));
  }

  /**
   * Delete oldest logs beyond the retention limit for a rule.
   */
  private async cleanup(ruleId: string, keepCount: number): Promise<void> {
    try {
      // Find the Nth newest log's createdAt
      const cutoffRows = await db
        .select({ createdAt: pipelineExecutionLogs.createdAt })
        .from(pipelineExecutionLogs)
        .where(eq(pipelineExecutionLogs.proxyRuleId, ruleId))
        .orderBy(desc(pipelineExecutionLogs.createdAt))
        .limit(1)
        .offset(keepCount);

      if (cutoffRows.length === 0) {
        return; // Under retention limit
      }

      const cutoff = cutoffRows[0].createdAt;
      await db
        .delete(pipelineExecutionLogs)
        .where(
          and(
            eq(pipelineExecutionLogs.proxyRuleId, ruleId),
            lt(pipelineExecutionLogs.createdAt, cutoff),
          ),
        );
    } catch (err) {
      this.logger.error('Failed to cleanup pipeline execution logs', err);
    }
  }
}
