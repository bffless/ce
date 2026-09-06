import { findSibling, isRecord, matchesPattern, type SiblingRule } from './model';

/**
 * Where an `mcp_handler`'s OAuth discovery document (RFC 9728) comes from, read
 * off the rule set the way the backend's `pipelines/mcp/protected-resource.ts`
 * reads it — so the Server tab can say what `scopes_supported` a client will
 * see before anything is saved. A miss is a hint, not an error: another set
 * attached to the same alias may carry the rule.
 */

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const PROTECTED_RESOURCE_HANDLER = 'oauth_protected_resource';

interface StepLike {
  handlerType: string;
  config: Record<string, unknown>;
  isEnabled?: boolean;
}

interface ValidatorLike {
  type: string;
  config?: Record<string, unknown>;
}

export interface DiscoveryRule extends SiblingRule {
  pipelineConfig?: {
    steps?: StepLike[];
    postSteps?: StepLike[];
    validators?: ValidatorLike[];
  } | null;
}

export interface ProtectedResourceConfig {
  resource: string;
  scopes?: string[];
  resourceName?: string;
  resourceDocumentation?: string;
}

export interface ToolRef {
  rule: { path: string; method?: string };
}

export interface McpRuleInfo {
  rule: DiscoveryRule;
  serverName: string;
  tools: ToolRef[];
}

export type DiscoverySummary =
  | {
      kind: 'handler';
      rulePath: string;
      scopes: { mode: 'declared' | 'derived'; values: string[] };
    }
  | { kind: 'custom'; rulePath: string }
  | { kind: 'none' };

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Every enabled step of a rule's pipeline (main and post). */
export function stepsOf(rule: DiscoveryRule | undefined): StepLike[] {
  const config = rule?.pipelineConfig;
  if (!config) return [];
  return [...(config.steps ?? []), ...(config.postSteps ?? [])].filter(
    (s) => s.isEnabled !== false,
  );
}

/**
 * The `oauth_protected_resource` step that is a rule's whole answer — its first
 * enabled main step, as the backend requires before the step implies the
 * visibility bypass; undefined otherwise.
 */
export function protectedResourceConfigOf(
  rule: DiscoveryRule | undefined,
): ProtectedResourceConfig | undefined {
  const step = (rule?.pipelineConfig?.steps ?? []).find((s) => s.isEnabled !== false);
  if (!step || step.handlerType !== PROTECTED_RESOURCE_HANDLER) return undefined;
  const c = isRecord(step.config) ? step.config : {};
  return {
    resource: typeof c.resource === 'string' ? c.resource : '',
    scopes: Array.isArray(c.scopes) ? strList(c.scopes) : undefined,
    resourceName: typeof c.resourceName === 'string' ? c.resourceName : undefined,
    resourceDocumentation:
      typeof c.resourceDocumentation === 'string' ? c.resourceDocumentation : undefined,
  };
}

/** The first enabled rule whose pattern matches `resource` and whose pipeline is an `mcp_handler`. */
export function findMcpRule(rules: DiscoveryRule[], resource: string): McpRuleInfo | undefined {
  if (!resource) return undefined;
  for (const rule of rules) {
    if (!rule.isEnabled || !matchesPattern(rule.pathPattern, resource)) continue;
    const step = stepsOf(rule).find((s) => s.handlerType === 'mcp_handler');
    if (!step) continue;
    const c = isRecord(step.config) ? step.config : {};
    const serverInfo = isRecord(c.serverInfo) ? c.serverInfo : {};
    const tools: ToolRef[] = Array.isArray(c.tools)
      ? c.tools.flatMap((t: unknown) => {
          if (!isRecord(t) || !isRecord(t.rule) || typeof t.rule.path !== 'string') return [];
          return [
            {
              rule: {
                path: t.rule.path,
                method: typeof t.rule.method === 'string' ? t.rule.method : undefined,
              },
            },
          ];
        })
      : [];
    return {
      rule,
      serverName: typeof serverInfo.name === 'string' ? serverInfo.name : '',
      tools,
    };
  }
  return undefined;
}

/**
 * The union (first-appearance order) of `requiredScopes` on the `auth_required`
 * validators of the sibling rules the tools map to — the backend's derivation.
 */
export function deriveScopes(rules: DiscoveryRule[], tools: ToolRef[]): string[] {
  const scopes: string[] = [];
  for (const tool of tools) {
    if (!tool.rule.path) continue;
    const sibling = findSibling(rules, tool.rule.path, tool.rule.method ?? 'POST');
    for (const validator of sibling?.pipelineConfig?.validators ?? []) {
      if (validator.type !== 'auth_required') continue;
      for (const scope of strList(validator.config?.requiredScopes)) {
        if (scope && !scopes.includes(scope)) scopes.push(scope);
      }
    }
  }
  return scopes;
}

/** Whether a rule answers the well-known path (bare or suffixed). */
export function answersWellKnown(rule: DiscoveryRule): boolean {
  return (
    rule.isEnabled &&
    (matchesPattern(rule.pathPattern, PROTECTED_RESOURCE_PATH) ||
      rule.pathPattern.startsWith(PROTECTED_RESOURCE_PATH))
  );
}

/**
 * Where discovery for the `mcp_handler` rule `ruleId` (with the given tools —
 * the edited ones, so the answer is live) comes from within this set.
 */
export function discoveryFor(
  rules: DiscoveryRule[],
  input: { ruleId?: string; tools: ToolRef[] },
): DiscoverySummary {
  const ownPath = rules.find((r) => r.id === input.ruleId)?.pathPattern;
  const handlerRules = rules
    .filter(answersWellKnown)
    .map((rule) => ({ rule, config: protectedResourceConfigOf(rule) }))
    .filter((x): x is { rule: DiscoveryRule; config: ProtectedResourceConfig } => !!x.config);
  const own = ownPath
    ? handlerRules.find((x) => matchesPattern(ownPath, x.config.resource))
    : handlerRules[0];
  if (own) {
    return {
      kind: 'handler',
      rulePath: own.rule.pathPattern,
      scopes: own.config.scopes
        ? { mode: 'declared', values: own.config.scopes }
        : { mode: 'derived', values: deriveScopes(rules, input.tools) },
    };
  }
  const custom = rules.find(answersWellKnown);
  if (custom) return { kind: 'custom', rulePath: custom.pathPattern };
  return { kind: 'none' };
}
