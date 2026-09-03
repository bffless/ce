import { PipelineConfig, ProxyRule } from '../db/schema/proxy-rules.schema';
import { Pipeline, PipelineStep } from '../pipelines/types';

/**
 * A `Pipeline` from a pipeline proxy rule's stored config — shared by the edge
 * (`ProxyMiddleware.handlePipelineExecution`) and the in-process invoker, so a
 * sibling rule is built exactly as the edge builds it.
 */
export function pipelineFromRule(
  rule: ProxyRule,
  projectId: string,
): (Pipeline & { steps: PipelineStep[] }) | null {
  const pipelineConfig = rule.pipelineConfig as PipelineConfig | null;
  if (!pipelineConfig || !pipelineConfig.steps || pipelineConfig.steps.length === 0) {
    return null;
  }
  return {
    id: rule.id,
    projectId,
    name: pipelineConfig.name || `Pipeline for ${rule.pathPattern}`,
    validators: pipelineConfig.validators || [],
    steps: pipelineConfig.steps.map((step, index) => ({
      id: step.id || `step-${index}`,
      pipelineId: rule.id,
      name: step.name || `step_${index + 1}`, // Fallback for legacy data without names
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
}

/** The HTTP status a failed pipeline answers with, by its error code — the edge's table. */
export function statusForPipelineError(code: string | undefined): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'AUTH_REQUIRED':
      return 401;
    case 'AUTHORIZATION_ERROR':
      return 403;
    case 'RATE_LIMIT_EXCEEDED':
      return 429;
    default:
      return 500;
  }
}

/** `WWW-Authenticate` for a scope refusal (RFC 6750 §3.1), or undefined. */
export function insufficientScopeHeader(
  error: { code?: string; details?: unknown } | undefined,
): string | undefined {
  const details = error?.details as { code?: string; missingScopes?: string[] } | undefined;
  if (
    error?.code === 'AUTHORIZATION_ERROR' &&
    details?.code === 'insufficient_scope' &&
    details.missingScopes?.length
  ) {
    return `Bearer error="insufficient_scope", scope="${details.missingScopes.join(' ')}"`;
  }
  return undefined;
}
