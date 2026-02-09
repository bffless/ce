import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { projects, deploymentAliases } from '../db/schema';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyService } from './proxy.service';
import { ProxyRule } from '../db/schema/proxy-rules.schema';

interface ParsedPublicPath {
  owner: string;
  repo: string;
  ref: string;
  subpath: string;
}

interface CacheEntry {
  rules: ProxyRule[];
  expiry: number;
}

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProxyMiddleware.name);

  // Simple cache for rules (TTL: 10 seconds)
  private ruleCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 10000;

  constructor(
    private readonly proxyRulesService: ProxyRulesService,
    private readonly proxyService: ProxyService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Only handle /public/* routes
    if (!req.path.startsWith('/public/')) {
      return next();
    }

    try {
      // Check for subdomain-alias format first: /public/subdomain-alias/{aliasName}/{subpath...}
      // This format is used by nginx wildcard server blocks for preview alias subdomains
      const subdomainMatch = req.path.match(
        /^\/public\/subdomain-alias\/([^/]+)(\/.*)?$/,
      );
      if (subdomainMatch) {
        return this.handleSubdomainAlias(req, res, next, subdomainMatch);
      }

      const parsed = this.parsePublicPath(req.path);
      if (!parsed) {
        return next();
      }

      const { owner, repo, ref } = parsed;

      // Check for X-Original-URI header (set by nginx for domain-mapped requests)
      // This contains the original request path before nginx rewrote it
      const originalUri = req.headers['x-original-uri'] as string | undefined;

      // Use original URI for proxy rule matching if available (domain-mapped request)
      // Otherwise use the subpath from the parsed path (direct /public/ access)
      const subpathForMatching = originalUri
        ? this.extractPathFromUri(originalUri)
        : parsed.subpath;

      // Look up project (including defaultProxyRuleSetId)
      const project = await this.getProjectByOwnerName(owner, repo);
      if (!project) {
        return next();
      }

      // Determine if ref is alias or SHA (40 hex chars = SHA)
      const isSha = /^[a-f0-9]{40}$/i.test(ref);
      let effectiveRuleSetId: string | null = project.defaultProxyRuleSetId;

      if (!isSha) {
        // Look up alias to get its proxyRuleSetId
        const alias = await this.getAliasByName(project.id, ref);
        if (alias?.proxyRuleSetId) {
          // Alias has its own rule set - use it (overrides project default)
          effectiveRuleSetId = alias.proxyRuleSetId;
        }
        // If alias doesn't have a rule set, fall through to project default
      }

      // Get effective rules from the resolved rule set
      const rules = await this.getCachedRules(effectiveRuleSetId);
      if (rules.length === 0) {
        return next();
      }

      // Find matching rule using the appropriate subpath
      const matchedRule = this.findMatchingRule(rules, subpathForMatching);
      if (!matchedRule) {
        return next();
      }

      // Handle internal rewrite (no HTTP proxy - just rewrite the URL and continue)
      if (matchedRule.internalRewrite) {
        const newSubpath = this.buildRewritePath(matchedRule, subpathForMatching);
        // Rewrite the URL path for file serving
        // Replace the subpath portion while keeping the /public/{owner}/{repo}/{ref}/ prefix
        const oldPath = req.path;
        const newPath = oldPath.replace(parsed.subpath, newSubpath);
        req.url = req.url.replace(req.path, newPath);

        this.logger.debug(
          `Internal rewrite: ${subpathForMatching} → ${newSubpath} (rule: ${matchedRule.id})`,
        );
        return next();
      }

      this.logger.debug(
        `Proxy match: ${subpathForMatching} → ${matchedRule.targetUrl} (rule: ${matchedRule.id})`,
      );

      // Forward request using the original URI path for correct backend routing
      await this.proxyService.forward(req, res, matchedRule, subpathForMatching);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Proxy middleware error: ${err.message}`);
      // Fall through to static asset serving on error
      next();
    }
  }

  /**
   * Handle subdomain-alias format: /public/subdomain-alias/{aliasName}/{subpath...}
   * This format is used by nginx wildcard server blocks for preview alias subdomains.
   * We need to look up the alias first to get the project and proxy rules.
   */
  private async handleSubdomainAlias(
    req: Request,
    res: Response,
    next: NextFunction,
    match: RegExpMatchArray,
  ): Promise<void> {
    const aliasName = match[1];
    const subpath = match[2] || '/';

    // Check for X-Original-URI header (set by nginx for wildcard subdomain requests)
    const originalUri = req.headers['x-original-uri'] as string | undefined;
    const subpathForMatching = originalUri
      ? this.extractPathFromUri(originalUri)
      : subpath;

    // Look up alias by name (across all projects)
    const alias = await this.getAliasByNameGlobal(aliasName);
    if (!alias) {
      return next();
    }

    // Get project to check for default proxy rule set
    const project = await this.getProjectById(alias.projectId);
    if (!project) {
      return next();
    }

    // Determine effective rule set:
    // 1. Alias's own proxyRuleSetId (if set)
    // 2. For preview aliases without rules, check manual aliases with same commit SHA
    // 3. Fall back to project default
    let effectiveRuleSetId = alias.proxyRuleSetId;

    if (!effectiveRuleSetId && alias.isAutoPreview) {
      // Try to inherit from a manual alias pointing to the same commit
      effectiveRuleSetId = await this.findProxyRuleSetFromCommitAliases(
        alias.projectId,
        alias.commitSha,
      );
    }

    if (!effectiveRuleSetId) {
      effectiveRuleSetId = project.defaultProxyRuleSetId;
    }

    // Get effective rules from the resolved rule set
    const rules = await this.getCachedRules(effectiveRuleSetId);
    if (rules.length === 0) {
      return next();
    }

    // Find matching rule
    const matchedRule = this.findMatchingRule(rules, subpathForMatching);
    if (!matchedRule) {
      return next();
    }

    // Handle internal rewrite (no HTTP proxy - just rewrite the URL and continue)
    if (matchedRule.internalRewrite) {
      const newSubpath = this.buildRewritePath(matchedRule, subpathForMatching);
      // For subdomain-alias format, replace the subpath after /public/subdomain-alias/{aliasName}/
      const oldPath = req.path;
      const newPath = oldPath.replace(subpath, newSubpath);
      req.url = req.url.replace(req.path, newPath);

      this.logger.debug(
        `Subdomain internal rewrite: ${subpathForMatching} → ${newSubpath} (alias: ${aliasName}, rule: ${matchedRule.id})`,
      );
      return next();
    }

    this.logger.debug(
      `Subdomain proxy match: ${subpathForMatching} → ${matchedRule.targetUrl} (alias: ${aliasName}, rule: ${matchedRule.id})`,
    );

    // Forward request
    await this.proxyService.forward(req, res, matchedRule, subpathForMatching);
  }

  /**
   * Extract the path portion from a URI (strips query string)
   * e.g., "/api/posts?page=1" → "/api/posts"
   */
  private extractPathFromUri(uri: string): string {
    const queryIndex = uri.indexOf('?');
    return queryIndex >= 0 ? uri.substring(0, queryIndex) : uri;
  }

  /**
   * Parse the public path to extract owner, repo, ref, and subpath
   * Supports two formats:
   * 1. /public/{owner}/{repo}/alias/{aliasName}/{subpath...} - for domain-mapped requests
   * 2. /public/{owner}/{repo}/{ref}/{subpath...} - for direct SHA/branch access
   */
  private parsePublicPath(path: string): ParsedPublicPath | null {
    // First, try to match alias format: /public/{owner}/{repo}/alias/{aliasName}/{subpath...}
    const aliasMatch = path.match(/^\/public\/([^/]+)\/([^/]+)\/alias\/([^/]+)(\/.*)?$/);
    if (aliasMatch) {
      return {
        owner: aliasMatch[1],
        repo: aliasMatch[2],
        ref: aliasMatch[3], // This is the alias name
        subpath: aliasMatch[4] || '/',
      };
    }

    // Fall back to direct format: /public/{owner}/{repo}/{ref}/{subpath...}
    const match = path.match(/^\/public\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      ref: match[3],
      subpath: match[4] || '/',
    };
  }

  /**
   * Get project by owner and name (returns null if not found)
   */
  private async getProjectByOwnerName(
    owner: string,
    name: string,
  ): Promise<typeof projects.$inferSelect | null> {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    return project || null;
  }

  /**
   * Get alias by project ID and alias name
   */
  private async getAliasByName(
    projectId: string,
    aliasName: string,
  ): Promise<typeof deploymentAliases.$inferSelect | null> {
    const [alias] = await db
      .select()
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
      )
      .limit(1);

    return alias || null;
  }

  /**
   * Get alias by name globally (across all projects)
   * Used for subdomain-alias lookups where we don't know the project yet
   */
  private async getAliasByNameGlobal(
    aliasName: string,
  ): Promise<typeof deploymentAliases.$inferSelect | null> {
    const [alias] = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.alias, aliasName))
      .limit(1);

    return alias || null;
  }

  /**
   * Find a proxy rule set ID from manual aliases that point to the same commit.
   * This allows preview aliases to inherit proxy rules from manual aliases
   * (like "production") that point to the same commit SHA.
   *
   * @returns The proxyRuleSetId from a manual alias with the same commit, or null
   */
  private async findProxyRuleSetFromCommitAliases(
    projectId: string,
    commitSha: string,
  ): Promise<string | null> {
    // Find manual aliases (non-preview) with the same commit that have proxy rules
    const [aliasWithRules] = await db
      .select({ proxyRuleSetId: deploymentAliases.proxyRuleSetId })
      .from(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, projectId),
          eq(deploymentAliases.commitSha, commitSha),
          eq(deploymentAliases.isAutoPreview, false),
        ),
      )
      .limit(1);

    return aliasWithRules?.proxyRuleSetId || null;
  }

  /**
   * Get project by ID (returns null if not found)
   */
  private async getProjectById(
    projectId: string,
  ): Promise<typeof projects.$inferSelect | null> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return project || null;
  }

  /**
   * Get rules with caching based on rule set ID
   *
   * Resolution order:
   *   1. If alias has a proxyRuleSetId -> use that rule set
   *   2. Else if project has a defaultProxyRuleSetId -> use that rule set
   *   3. Else -> no proxy rules
   */
  private async getCachedRules(ruleSetId: string | null): Promise<ProxyRule[]> {
    if (!ruleSetId) {
      return [];
    }

    const cacheKey = `ruleset:${ruleSetId}`;
    const cached = this.ruleCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      return cached.rules;
    }

    const rules = await this.proxyRulesService.getEffectiveRulesForRuleSet(ruleSetId);
    this.ruleCache.set(cacheKey, { rules, expiry: Date.now() + this.CACHE_TTL });
    return rules;
  }

  /**
   * Find a matching rule for the given subpath
   * Rules are already sorted by order, so the first match wins
   */
  private findMatchingRule(rules: ProxyRule[], subpath: string): ProxyRule | null {
    for (const rule of rules) {
      if (!rule.isEnabled) {
        continue;
      }
      if (this.matchesPattern(rule.pathPattern, subpath)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * Build the rewritten path for internal rewrite rules.
   *
   * For exact matches: return target path directly
   * For wildcard patterns: apply substitution
   */
  private buildRewritePath(rule: ProxyRule, originalPath: string): string {
    const targetPath = rule.targetUrl; // For internal rewrites, targetUrl is actually a path

    // For exact matches: return target path directly
    // /env.json matched by pattern /env.json → target /environments/production.json
    if (!rule.pathPattern.includes('*')) {
      return targetPath;
    }

    // For prefix wildcard patterns: /api/* with targetUrl /v2/api
    // /api/users becomes /v2/api/users
    if (rule.pathPattern.endsWith('/*')) {
      const prefix = rule.pathPattern.slice(0, -2);
      if (originalPath.startsWith(prefix + '/')) {
        const remainder = originalPath.substring(prefix.length);
        return targetPath.replace(/\/$/, '') + remainder;
      }
      if (originalPath === prefix) {
        return targetPath;
      }
    }

    // For suffix wildcard patterns: *.json with targetUrl /data/
    // /config.json becomes /data/config.json
    if (rule.pathPattern.startsWith('*')) {
      const suffix = rule.pathPattern.slice(1);
      if (originalPath.endsWith(suffix)) {
        const filename = originalPath.substring(originalPath.lastIndexOf('/') + 1);
        return targetPath.replace(/\/$/, '') + '/' + filename;
      }
    }

    // Fallback: just return target path
    return targetPath;
  }

  /**
   * Check if a path matches a pattern
   *
   * Supported patterns:
   * - Exact: '/graphql' matches only '/graphql'
   * - Prefix wildcard: '/api/*' matches '/api/', '/api/users', '/api/posts/1'
   * - Suffix wildcard: '*.json' matches '/config.json', '/data.json'
   */
  private matchesPattern(pattern: string, path: string): boolean {
    // Prefix wildcard: /api/*
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      // Match if path starts with prefix + '/' OR path equals prefix exactly
      return path.startsWith(prefix + '/') || path === prefix;
    }

    // Suffix wildcard: *.json
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      return path.endsWith(suffix);
    }

    // Exact match
    return path === pattern;
  }
}
