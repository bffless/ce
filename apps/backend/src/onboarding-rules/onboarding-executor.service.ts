import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
import { Request } from 'express';
import { db } from '../db/client';
import {
  OnboardingRule,
  OnboardingTrigger,
  OnboardingAction,
  OnboardingCondition,
  GrantRepoAccessParams,
  AssignRoleParams,
  AddToGroupParams,
  RunPipelineParams,
} from '../db/schema/onboarding-rules.schema';
import {
  onboardingRuleExecutions,
  ActionExecutionResult,
  ExecutionStatus,
  NewOnboardingRuleExecution,
} from '../db/schema/onboarding-rule-executions.schema';
import { projects, projectPermissions, users, userGroupMembers, proxyRules, proxyRuleSets } from '../db/schema';
import { PipelineConfig } from '../db/schema/proxy-rules.schema';
import { OnboardingRulesService } from './onboarding-rules.service';
import { PipelineExecutionService } from '../pipelines/execution/pipeline-execution.service';
import { PipelineExecutionLogService } from '../pipelines/pipeline-execution-log.service';
import { Pipeline, PipelineStep } from '../pipelines/types';

/**
 * Context for executing onboarding rules
 */
export interface OnboardingContext {
  userId: string;
  userEmail: string;
  trigger: OnboardingTrigger;
  /** Role from invitation (only for invite_accepted trigger) */
  invitationRole?: string;
}

@Injectable()
export class OnboardingExecutorService implements OnModuleInit {
  private readonly logger = new Logger(OnboardingExecutorService.name);
  private pipelineExecutionService: PipelineExecutionService;
  private executionLogService: PipelineExecutionLogService;

  constructor(
    private readonly rulesService: OnboardingRulesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.pipelineExecutionService = this.moduleRef.get(PipelineExecutionService, { strict: false });
    this.executionLogService = this.moduleRef.get(PipelineExecutionLogService, { strict: false });
  }

  /**
   * Execute all matching onboarding rules for a user event
   */
  async executeRulesForUser(context: OnboardingContext): Promise<void> {
    const { userId, userEmail, trigger } = context;

    this.logger.log(`Executing onboarding rules for user ${userEmail} (trigger: ${trigger})`);

    // Get all enabled rules for this trigger
    const rules = await this.rulesService.getEnabledRulesByTrigger(trigger);

    if (rules.length === 0) {
      this.logger.debug(`No onboarding rules configured for trigger: ${trigger}`);
      return;
    }

    this.logger.log(`Found ${rules.length} rules to evaluate`);

    // Execute each rule
    for (const rule of rules) {
      await this.executeRule(rule, context);
    }
  }

  /**
   * Execute a single onboarding rule
   */
  private async executeRule(rule: OnboardingRule, context: OnboardingContext): Promise<void> {
    const { userId, userEmail, trigger } = context;

    // Check if conditions match
    if (rule.conditions && rule.conditions.length > 0) {
      const conditionsMatch = this.evaluateConditions(rule.conditions, userEmail);
      if (!conditionsMatch) {
        this.logger.debug(`Rule "${rule.name}" skipped: conditions not met for ${userEmail}`);
        await this.logExecution(rule, userId, trigger, 'skipped', [], null);
        return;
      }
    }

    this.logger.log(`Executing rule "${rule.name}" for user ${userEmail}`);

    // Execute each action
    const results: ActionExecutionResult[] = [];

    for (const action of rule.actions) {
      const result = await this.executeAction(action, rule, context);
      results.push(result);
    }

    // Determine overall status
    const successCount = results.filter((r) => r.success).length;
    const totalCount = results.length;
    let status: ExecutionStatus;
    let errorMessage: string | null = null;

    if (successCount === totalCount) {
      status = 'success';
    } else if (successCount === 0) {
      status = 'failed';
      errorMessage = results.map((r) => r.error).filter(Boolean).join('; ');
    } else {
      status = 'partial';
      errorMessage = results
        .filter((r) => !r.success)
        .map((r) => r.error)
        .filter(Boolean)
        .join('; ');
    }

    await this.logExecution(rule, userId, trigger, status, results, errorMessage);

    this.logger.log(
      `Rule "${rule.name}" execution complete: ${status} (${successCount}/${totalCount} actions)`,
    );
  }

  /**
   * Evaluate conditions against user email
   */
  private evaluateConditions(conditions: OnboardingCondition[], email: string): boolean {
    // All conditions must match (AND logic)
    return conditions.every((condition) => this.evaluateCondition(condition, email));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: OnboardingCondition, email: string): boolean {
    const emailLower = email.toLowerCase();

    switch (condition.type) {
      case 'email_domain': {
        // Check if email ends with @domain
        const domain = condition.value.toLowerCase();
        return emailLower.endsWith(`@${domain}`);
      }
      case 'email_pattern': {
        // Glob-like pattern matching
        try {
          const pattern = condition.value.toLowerCase();
          const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          );
          return regex.test(emailLower);
        } catch {
          this.logger.warn(`Invalid email pattern: ${condition.value}`);
          return false;
        }
      }
      default:
        this.logger.warn(`Unknown condition type: ${(condition as any).type}`);
        return false;
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: OnboardingAction,
    rule: OnboardingRule,
    context: OnboardingContext,
  ): Promise<ActionExecutionResult> {
    try {
      switch (action.type) {
        case 'grant_repo_access':
          return await this.executeGrantRepoAccess(
            action.params as GrantRepoAccessParams,
            rule,
            context,
          );
        case 'assign_role':
          return await this.executeAssignRole(
            action.params as AssignRoleParams,
            context,
          );
        case 'add_to_group':
          return await this.executeAddToGroup(
            action.params as AddToGroupParams,
            context,
          );
        case 'run_pipeline':
          return await this.executeRunPipeline(
            action.params as RunPipelineParams,
            context,
          );
        default:
          return {
            action,
            success: false,
            error: `Unknown action type: ${(action as any).type}`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Action ${action.type} failed: ${message}`);
      return {
        action,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Execute grant_repo_access action
   */
  private async executeGrantRepoAccess(
    params: GrantRepoAccessParams,
    rule: OnboardingRule,
    context: OnboardingContext,
  ): Promise<ActionExecutionResult> {
    const { repository, role } = params;
    const { userId } = context;

    // Parse repository "owner/name"
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      return {
        action: { type: 'grant_repo_access', params },
        success: false,
        error: `Invalid repository format: ${repository} (expected "owner/name")`,
      };
    }

    // Find the project
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (!project) {
      return {
        action: { type: 'grant_repo_access', params },
        success: false,
        error: `Repository not found: ${repository}`,
      };
    }

    // Check if user already has permission
    const [existing] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(
          eq(projectPermissions.projectId, project.id),
          eq(projectPermissions.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      // User already has access - idempotent, treat as success
      this.logger.debug(`User already has ${existing.role} access to ${repository}`);
      return {
        action: { type: 'grant_repo_access', params },
        success: true,
        message: `User already has ${existing.role} access (unchanged)`,
      };
    }

    // Grant permission using rule creator as grantedBy
    await db.insert(projectPermissions).values({
      projectId: project.id,
      userId,
      role,
      grantedBy: rule.createdBy,
    });

    this.logger.log(`Granted ${role} access to ${repository} for user ${userId}`);

    return {
      action: { type: 'grant_repo_access', params },
      success: true,
      message: `Granted ${role} access to ${repository}`,
    };
  }

  /**
   * Execute assign_role action (workspace-level role)
   */
  private async executeAssignRole(
    params: AssignRoleParams,
    context: OnboardingContext,
  ): Promise<ActionExecutionResult> {
    const { role } = params;
    const { userId } = context;

    // Update user's role
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      return {
        action: { type: 'assign_role', params },
        success: false,
        error: `User not found: ${userId}`,
      };
    }

    this.logger.log(`Assigned workspace role ${role} to user ${userId}`);

    return {
      action: { type: 'assign_role', params },
      success: true,
      message: `Assigned workspace role: ${role}`,
    };
  }

  /**
   * Execute add_to_group action
   */
  private async executeAddToGroup(
    params: AddToGroupParams,
    context: OnboardingContext,
  ): Promise<ActionExecutionResult> {
    const { groupId } = params;
    const { userId } = context;

    // Check if user is already in group
    const [existing] = await db
      .select()
      .from(userGroupMembers)
      .where(
        and(
          eq(userGroupMembers.groupId, groupId),
          eq(userGroupMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        action: { type: 'add_to_group', params },
        success: true,
        message: 'User already in group (unchanged)',
      };
    }

    // Add user to group
    await db.insert(userGroupMembers).values({
      groupId,
      userId,
    });

    this.logger.log(`Added user ${userId} to group ${groupId}`);

    return {
      action: { type: 'add_to_group', params },
      success: true,
      message: `Added to group ${groupId}`,
    };
  }

  /**
   * Execute run_pipeline action
   */
  private async executeRunPipeline(
    params: RunPipelineParams,
    context: OnboardingContext,
  ): Promise<ActionExecutionResult> {
    const { proxyRuleId } = params;
    const { userId, userEmail, trigger } = context;

    // Fetch the proxy rule with its project ID
    const [ruleWithProject] = await db
      .select({
        rule: proxyRules,
        projectId: proxyRuleSets.projectId,
      })
      .from(proxyRules)
      .innerJoin(proxyRuleSets, eq(proxyRules.ruleSetId, proxyRuleSets.id))
      .where(eq(proxyRules.id, proxyRuleId))
      .limit(1);

    if (!ruleWithProject) {
      return {
        action: { type: 'run_pipeline', params },
        success: false,
        error: `Proxy rule not found: ${proxyRuleId}`,
      };
    }

    const rule = ruleWithProject.rule;
    const projectId = ruleWithProject.projectId;

    const pipelineConfig = rule.pipelineConfig as PipelineConfig | null;
    if (!pipelineConfig || !pipelineConfig.steps || pipelineConfig.steps.length === 0) {
      return {
        action: { type: 'run_pipeline', params },
        success: false,
        error: `Proxy rule ${proxyRuleId} has no pipeline configuration`,
      };
    }

    // Build Pipeline object from proxy rule config (same pattern as proxy.middleware.ts)
    const pipeline: Pipeline & { steps: PipelineStep[] } = {
      id: rule.id,
      projectId,
      name: pipelineConfig.name || `Onboarding pipeline`,
      validators: pipelineConfig.validators || [],
      steps: pipelineConfig.steps.map((step, index) => ({
        id: step.id || `step-${index}`,
        pipelineId: rule.id,
        name: step.name || `step_${index + 1}`,
        handlerType: step.handlerType,
        config: step.config,
        order: index,
        isEnabled: step.isEnabled !== false,
      })),
      postSteps: pipelineConfig.postSteps?.map((step, index) => ({
        id: step.id || `post-step-${index}`,
        pipelineId: rule.id,
        name: step.name || `post_step_${index + 1}`,
        handlerType: step.handlerType,
        config: step.config,
        order: index,
        isEnabled: step.isEnabled !== false,
      })),
    };

    // Build a synthetic request with user context in the body
    const syntheticReq = {
      path: '/internal/onboarding-pipeline',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        userId,
        email: userEmail,
        trigger,
        invitationRole: context.invitationRole,
      },
      query: {},
      get: (key: string) => {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        return headers[key.toLowerCase()];
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const user = { id: userId, email: userEmail };

    const result = await this.pipelineExecutionService.executePipelineWithDebug(
      pipeline,
      syntheticReq,
      user,
    );

    // Persist execution log (fire-and-forget, same as proxy middleware)
    if (rule.debugEnabled) {
      this.executionLogService.log(rule.id, projectId, result, {
        ip: '127.0.0.1',
        userAgent: 'onboarding-executor',
        userId,
      }, 'POST', '/internal/onboarding-pipeline').catch((err) =>
        this.logger.error('Failed to persist pipeline execution log', err),
      );
    }

    if (result.success) {
      this.logger.log(`Pipeline ${pipelineConfig.name} executed successfully for user ${userId}`);
      return {
        action: { type: 'run_pipeline', params },
        success: true,
        message: `Pipeline "${pipelineConfig.name}" executed successfully`,
      };
    }

    const errorMsg = result.error || 'Pipeline execution failed';
    this.logger.error(`Pipeline ${pipelineConfig.name} failed for user ${userId}: ${errorMsg}`);
    return {
      action: { type: 'run_pipeline', params },
      success: false,
      error: `Pipeline "${pipelineConfig.name}" failed: ${errorMsg}`,
    };
  }

  /**
   * Log execution result to audit table
   */
  private async logExecution(
    rule: OnboardingRule,
    userId: string,
    trigger: OnboardingTrigger,
    status: ExecutionStatus,
    details: ActionExecutionResult[],
    errorMessage: string | null,
  ): Promise<void> {
    try {
      await db.insert(onboardingRuleExecutions).values({
        ruleId: rule.id,
        ruleName: rule.name,
        userId,
        trigger,
        status,
        details,
        errorMessage,
      } satisfies NewOnboardingRuleExecution);
    } catch (error) {
      // Don't fail the onboarding if logging fails
      this.logger.error(`Failed to log execution: ${error}`);
    }
  }
}
