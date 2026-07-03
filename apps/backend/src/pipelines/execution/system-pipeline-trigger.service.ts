import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Request } from 'express';
import { db } from '../../db/client';
import { proxyRules, proxyRuleSets } from '../../db/schema';
import { PipelineConfig } from '../../db/schema/proxy-rules.schema';
import { PipelineExecutionService } from './pipeline-execution.service';
import { PipelineDebugResult } from './pipeline-context.interface';
import { Pipeline, PipelineStep } from '../types';

/**
 * Options for triggering a proxy rule's pipeline outside of an HTTP request.
 */
export interface SystemTriggerOptions {
  /** Request-body payload the pipeline sees as `request.body`. */
  body?: Record<string, unknown>;
  /**
   * Acting user context. Omit for a true system run with no session — inserts
   * then record a null `createdBy`. (Passing a non-existent user id would break
   * the createdBy FK, so callers without a real user MUST leave this undefined.)
   */
  user?: { id: string; email?: string; role?: string };
  /** Synthetic request path, used in logs/metadata. */
  source?: string;
  /** Retain per-step debug snapshots in memory (default false). */
  captureDebug?: boolean;
}

/**
 * Outcome of a system trigger.
 */
export interface SystemTriggerResult {
  /** Whether the target proxy rule was found. */
  found: boolean;
  /** Whether the found rule actually has a pipeline configuration to run. */
  hasPipeline: boolean;
  projectId?: string;
  pipelineName?: string;
  /** Execution result (present only when a pipeline actually ran). */
  result?: PipelineDebugResult;
}

/**
 * Runs a proxy rule's pipeline without an inbound HTTP request — the shared
 * "synthetic request + system context" trigger. Extracted from the onboarding
 * executor (which used it inline) so both onboarding rules and scheduled
 * pipelines drive pipelines the same way instead of duplicating the
 * request-building + Pipeline-assembly dance.
 */
@Injectable()
export class SystemPipelineTriggerService {
  private readonly logger = new Logger(SystemPipelineTriggerService.name);

  constructor(private readonly pipelineExecutionService: PipelineExecutionService) {}

  /**
   * Look up the proxy rule by id, assemble its pipeline, and execute it under a
   * synthetic request. Does not persist an execution log — the caller decides
   * whether/how to log (their metadata differs).
   */
  async triggerByProxyRuleId(
    proxyRuleId: string,
    options: SystemTriggerOptions = {},
  ): Promise<SystemTriggerResult> {
    const [ruleWithProject] = await db
      .select({ rule: proxyRules, projectId: proxyRuleSets.projectId })
      .from(proxyRules)
      .innerJoin(proxyRuleSets, eq(proxyRules.ruleSetId, proxyRuleSets.id))
      .where(eq(proxyRules.id, proxyRuleId))
      .limit(1);

    if (!ruleWithProject) {
      return { found: false, hasPipeline: false };
    }

    const { rule, projectId } = ruleWithProject;
    const pipelineConfig = rule.pipelineConfig as PipelineConfig | null;
    if (!pipelineConfig || !pipelineConfig.steps || pipelineConfig.steps.length === 0) {
      return { found: true, hasPipeline: false, projectId };
    }

    const pipeline = this.buildPipeline(rule.id, projectId, pipelineConfig);
    const source = options.source || '/internal/pipeline';
    const syntheticReq = this.buildSyntheticRequest(source, options.body ?? {});

    const result = await this.pipelineExecutionService.executePipelineWithDebug(
      pipeline,
      syntheticReq,
      options.user,
      { captureDebug: options.captureDebug === true },
    );

    return {
      found: true,
      hasPipeline: true,
      projectId,
      pipelineName: pipelineConfig.name,
      result,
    };
  }

  /** Assemble a runnable Pipeline from a proxy rule's stored config. */
  private buildPipeline(
    ruleId: string,
    projectId: string,
    config: PipelineConfig,
  ): Pipeline & { steps: PipelineStep[] } {
    const mapStep = (prefix: string) => (step: PipelineConfig['steps'][number], index: number) => ({
      id: step.id || `${prefix}-${index}`,
      pipelineId: ruleId,
      name: step.name || `${prefix}_${index + 1}`,
      handlerType: step.handlerType,
      config: step.config,
      order: index,
      isEnabled: step.isEnabled !== false,
    });

    return {
      id: ruleId,
      projectId,
      name: config.name || 'System pipeline',
      validators: config.validators || [],
      steps: config.steps.map(mapStep('step')),
      postSteps: config.postSteps?.map(mapStep('post-step')),
    };
  }

  /** Build the minimal Express-request shape the execution engine consumes. */
  private buildSyntheticRequest(path: string, body: Record<string, unknown>): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    return {
      path,
      method: 'POST',
      headers,
      body,
      query: {},
      get: (key: string) => headers[key.toLowerCase()],
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
  }
}
