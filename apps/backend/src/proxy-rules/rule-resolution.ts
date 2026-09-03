import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { aliasProxyRuleSets, projectDefaultProxyRuleSets } from '../db/schema';
import { ProxyRule } from '../db/schema/proxy-rules.schema';
import { matchesMethod } from './method-match';

/**
 * Rule resolution, shared by the edge (`ProxyMiddleware`) and the in-process
 * invoker (`RuleInvokerService`, the `mcp_handler`'s sibling calls) — pure
 * functions over the db client, lifted verbatim out of the middleware so the
 * two paths cannot drift: a sibling rule is found exactly as the edge would
 * find it.
 */

/**
 * Resolve rule set IDs for an alias.
 * Checks join table first, falls back to legacy proxyRuleSetId column.
 */
export async function resolveRuleSetIdsForAlias(
  aliasId: string,
  legacyProxyRuleSetId: string | null,
): Promise<string[]> {
  const joinRows = await db
    .select({ proxyRuleSetId: aliasProxyRuleSets.proxyRuleSetId })
    .from(aliasProxyRuleSets)
    .where(eq(aliasProxyRuleSets.aliasId, aliasId))
    .orderBy(asc(aliasProxyRuleSets.order));

  if (joinRows.length > 0) {
    return joinRows.map((r) => r.proxyRuleSetId);
  }

  if (legacyProxyRuleSetId) {
    return [legacyProxyRuleSetId];
  }

  return [];
}

/**
 * Resolve default rule set IDs for a project.
 * Checks join table first, falls back to legacy defaultProxyRuleSetId column.
 */
export async function resolveProjectDefaultRuleSetIds(
  projectId: string,
  legacyDefaultProxyRuleSetId: string | null,
): Promise<string[]> {
  const joinRows = await db
    .select({ proxyRuleSetId: projectDefaultProxyRuleSets.proxyRuleSetId })
    .from(projectDefaultProxyRuleSets)
    .where(eq(projectDefaultProxyRuleSets.projectId, projectId))
    .orderBy(asc(projectDefaultProxyRuleSets.order));

  if (joinRows.length > 0) {
    return joinRows.map((r) => r.proxyRuleSetId);
  }

  if (legacyDefaultProxyRuleSetId) {
    return [legacyDefaultProxyRuleSetId];
  }

  return [];
}

/**
 * The effective rule-set ids for (project, alias): the alias's sets (join
 * table → legacy column), else the project's defaults — the middleware's
 * order, exactly.
 */
export async function resolveEffectiveRuleSetIds(
  project: { id: string; defaultProxyRuleSetId: string | null },
  alias: { id: string; proxyRuleSetId: string | null } | null,
): Promise<string[]> {
  let ids: string[] = [];
  if (alias) {
    ids = await resolveRuleSetIdsForAlias(alias.id, alias.proxyRuleSetId);
  }
  if (ids.length === 0) {
    ids = await resolveProjectDefaultRuleSetIds(project.id, project.defaultProxyRuleSetId);
  }
  return ids;
}

/**
 * Match a path against a rule pattern. Supports exact matches and glob
 * wildcards — trailing (`/api/*`), leading (`*.json`) and middle
 * (`/api/*​/users`).
 *
 * Note: '/prefix/*' matches '/prefix/' and '/prefix/<sub>' but NOT the bare
 * '/prefix' — the wildcard requires a path separator. This lets a same-named
 * client-side SPA route (e.g. bare '/auth') fall through to the SPA fallback
 * while subpaths (e.g. '/auth/signin') are still proxied. To also match the
 * bare prefix, use '/prefix*' or add an explicit '/prefix' rule.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (!pattern.includes('*')) return false;

  // Glob → regex: escape regex metacharacters (but not '*'), then replace
  // '*' with '.*' and anchor. Handles trailing, leading, and middle wildcards.
  const regexSource =
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  return new RegExp(regexSource).test(path);
}

/**
 * Find the first enabled rule matching (path, method) — rules are already in
 * priority order (set order, then rule order).
 */
export function findMatchingRule(
  rules: ProxyRule[],
  subpath: string,
  method?: string,
): ProxyRule | null {
  const requestMethod = method?.toUpperCase();

  for (const rule of rules) {
    if (!rule.isEnabled) {
      continue;
    }

    if (!matchesPattern(rule.pathPattern, subpath)) {
      continue;
    }

    // Check method(s): methods[] wins, else single method, else any (case-insensitive)
    if (!matchesMethod(rule, requestMethod)) {
      continue;
    }

    return rule;
  }
  return null;
}
