import { PipelineConfig, ProxyRule } from '../../db/schema/proxy-rules.schema';
import { findMatchingRule, matchesPattern } from '../../proxy-rules/rule-resolution';
import {
  McpHandlerConfig,
  OAuthProtectedResourceConfig,
} from '../execution/step-handler.interface';
import { AuthRequiredConfig } from '../types';

/**
 * The RFC 9728 protected-resource document for an `mcp_handler`, as pure
 * functions over the alias's effective rules — shared by the
 * `oauth_protected_resource` step (the edge) and `OAuthService`'s RFC 8707
 * `resource` resolution (which reads the same config in-process instead of
 * fetching the document it would itself serve). One derivation, two callers.
 */

export const PROTECTED_RESOURCE_HANDLER = 'oauth_protected_resource';
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

export interface ProtectedResourceDocument {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: ['header'];
  resource_name?: string;
  resource_documentation?: string;
}

/** Every step of a rule's pipeline (main and post), or none for a non-pipeline rule. */
export function pipelineStepsOf(
  rule: Pick<ProxyRule, 'pipelineConfig'> | null | undefined,
): PipelineConfig['steps'] {
  const config = rule?.pipelineConfig as PipelineConfig | null | undefined;
  if (!config) return [];
  return [...(config.steps ?? []), ...(config.postSteps ?? [])];
}

/** Whether a rule's pipeline carries an enabled step of the given handler type, anywhere. */
export function pipelineHasHandler(
  rule: Pick<ProxyRule, 'pipelineConfig'> | null | undefined,
  handlerType: string,
): boolean {
  return pipelineStepsOf(rule).some(
    (step) => step.handlerType === handlerType && step.isEnabled !== false,
  );
}

/** Whether a rule's pattern answers the well-known path — bare (`…/oauth-protected-resource*`) or suffixed. */
export function answersWellKnownPath(rule: Pick<ProxyRule, 'pathPattern'>): boolean {
  return (
    matchesPattern(rule.pathPattern, PROTECTED_RESOURCE_PATH) ||
    rule.pathPattern.startsWith(PROTECTED_RESOURCE_PATH)
  );
}

/**
 * The `oauth_protected_resource` step that *is* a rule's answer: the first
 * enabled main step (the handler always terminates, so nothing after it runs
 * and nothing before it may). Undefined when the step is absent, disabled, or
 * preceded by another step — a pipeline that does work before publishing the
 * document is not "just the document".
 */
export function protectedResourceStepOf(
  rule: Pick<ProxyRule, 'pipelineConfig'> | null | undefined,
): OAuthProtectedResourceConfig | undefined {
  const config = rule?.pipelineConfig as PipelineConfig | null | undefined;
  const first = (config?.steps ?? []).find((s) => s.isEnabled !== false);
  if (!first || first.handlerType !== PROTECTED_RESOURCE_HANDLER) return undefined;
  return first.config as unknown as OAuthProtectedResourceConfig;
}

/**
 * Whether a matched rule serves the protected-resource document through the
 * dedicated handler — the case the visibility gate lets through without the
 * rule saying `bypassVisibility` (the handler implies it). Deliberately
 * narrow: the rule must answer the well-known path and the step must be its
 * whole answer, so the implication cannot widen an unrelated rule that merely
 * carries the step somewhere in its pipeline.
 */
export function servesProtectedResourceDocument(
  rule: Pick<ProxyRule, 'pipelineConfig' | 'pathPattern'> | null | undefined,
): boolean {
  return !!rule && answersWellKnownPath(rule) && protectedResourceStepOf(rule) !== undefined;
}

/**
 * The `oauth_protected_resource` config that answers discovery for `resourcePath`
 * on an alias, as a client would find it: the path-suffixed form first
 * (`/.well-known/oauth-protected-resource/api/mcp`, RFC 9728 §3), then the bare
 * path — and only when that step's own `resource` is `resourcePath`, so the
 * scopes read are the resource's, not another server's on the same alias.
 * Undefined when the alias's matched rule is not this handler (an app-shipped
 * `function_handler` document, or nothing at all).
 */
export function findProtectedResourceConfig(
  rules: ProxyRule[],
  resourcePath: string,
): OAuthProtectedResourceConfig | undefined {
  const wanted = resourcePath.replace(/\/+$/, '');
  const names = (config: OAuthProtectedResourceConfig | undefined) =>
    config && config.resource.replace(/\/+$/, '') === wanted ? config : undefined;
  const suffixed = findMatchingRule(rules, `${PROTECTED_RESOURCE_PATH}${resourcePath}`, 'GET');
  return (
    names(protectedResourceStepOf(suffixed)) ??
    names(protectedResourceStepOf(findMatchingRule(rules, PROTECTED_RESOURCE_PATH, 'GET')))
  );
}

/**
 * The `mcp_handler` rule at `resource`: the first enabled rule whose pipeline
 * carries an `mcp_handler` step and whose pattern matches the path.
 */
export function findMcpRule(
  rules: ProxyRule[],
  resource: string,
): { rule: ProxyRule; config: McpHandlerConfig } | undefined {
  for (const rule of rules) {
    if (!rule.isEnabled || !matchesPattern(rule.pathPattern, resource)) continue;
    const step = pipelineStepsOf(rule).find(
      (s) => s.handlerType === 'mcp_handler' && s.isEnabled !== false,
    );
    if (step) return { rule, config: step.config as unknown as McpHandlerConfig };
  }
  return undefined;
}

/**
 * The scopes an `mcp_handler`'s tools need, as the union (first appearance
 * order) of `requiredScopes` on the `auth_required` validators of the sibling
 * rules its tools map to — each sibling resolved as the edge resolves it
 * (`findMatchingRule`, the tool's method, POST by default).
 */
export function deriveScopes(rules: ProxyRule[], mcp: McpHandlerConfig): string[] {
  const scopes: string[] = [];
  for (const tool of mcp.tools ?? []) {
    if (!tool?.rule?.path) continue;
    const sibling = findMatchingRule(rules, tool.rule.path, tool.rule.method ?? 'POST');
    if (!sibling) continue;
    const validators = (sibling.pipelineConfig as PipelineConfig | null)?.validators ?? [];
    for (const validator of validators) {
      if (validator.type !== 'auth_required') continue;
      const required = (validator.config as AuthRequiredConfig | undefined)?.requiredScopes ?? [];
      for (const scope of required) {
        if (typeof scope === 'string' && scope !== '' && !scopes.includes(scope)) {
          scopes.push(scope);
        }
      }
    }
  }
  return scopes;
}

/**
 * `scopes_supported` for a handler config: declared verbatim, else derived from
 * the `mcp_handler` at `resource` (empty when there is none).
 */
export function scopesSupportedFor(
  config: OAuthProtectedResourceConfig,
  rules: ProxyRule[],
): string[] {
  if (Array.isArray(config.scopes)) return [...config.scopes];
  const mcp = findMcpRule(rules, config.resource);
  return mcp ? deriveScopes(rules, mcp.config) : [];
}

/** The document itself. `rules` is only consulted for what the config leaves out. */
export function protectedResourceDocument(input: {
  host: string;
  issuer: string;
  config: OAuthProtectedResourceConfig;
  rules: ProxyRule[];
}): ProtectedResourceDocument {
  const { host, issuer, config, rules } = input;
  const needsMcp = !Array.isArray(config.scopes) || !config.resourceName;
  const mcp = needsMcp ? findMcpRule(rules, config.resource) : undefined;
  const scopes = Array.isArray(config.scopes)
    ? [...config.scopes]
    : mcp
      ? deriveScopes(rules, mcp.config)
      : [];
  const name = config.resourceName || mcp?.config.serverInfo?.name;
  const doc: ProtectedResourceDocument = {
    resource: `https://${host}${config.resource}`,
    authorization_servers: [issuer],
    scopes_supported: scopes,
    bearer_methods_supported: ['header'],
  };
  if (name) doc.resource_name = name;
  if (config.resourceDocumentation) doc.resource_documentation = config.resourceDocumentation;
  return doc;
}

/**
 * The path a client appended to the well-known path (RFC 9728 §3: a resource
 * `https://h/api/mcp` is looked up at `/.well-known/oauth-protected-resource/api/mcp`),
 * from the public-relative request path; `''` for the bare path, undefined when
 * the path does not contain the well-known prefix at all.
 */
export function protectedResourceSuffix(requestPath: string): string | undefined {
  const path = requestPath.split('?')[0];
  const at = path.indexOf(PROTECTED_RESOURCE_PATH);
  if (at < 0) return undefined;
  return path.slice(at + PROTECTED_RESOURCE_PATH.length).replace(/\/+$/, '');
}

/** Whether a suffix names this handler's resource: empty (the bare path) or equal to it. */
export function suffixNamesResource(suffix: string | undefined, resource: string): boolean {
  if (suffix === undefined || suffix === '') return true;
  return suffix === resource.replace(/\/+$/, '');
}
