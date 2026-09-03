import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { eq, and, or } from 'drizzle-orm';
import { getSession } from 'supertokens-node/recipe/session';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { asc } from 'drizzle-orm';
import { db } from '../db/client';
import {
  projects,
  deploymentAliases,
  domainMappings,
  users,
  apiKeys,
  aliasProxyRuleSets,
} from '../db/schema';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyService } from './proxy.service';
import { EmailFormHandlerService } from './email-form-handler.service';
import { ProxyRule, ProxyType, PipelineConfig } from '../db/schema/proxy-rules.schema';
import { ConfigService } from '@nestjs/config';
import { PipelineExecutionService } from '../pipelines/execution';
import {
  PipelineExecutionLogService,
  PIPELINE_LOG_ID_HEADER,
} from '../pipelines/pipeline-execution-log.service';
import {
  PipelineUser,
  PipelineDebugResult,
} from '../pipelines/execution/pipeline-context.interface';
import {
  insufficientScopeHeader,
  pipelineFromRule,
  statusForPipelineError,
} from './pipeline-from-rule';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { CustomDomainAuthService } from '../auth/custom-domain-auth.service';
import { resolveAppToken } from '../auth/app-token.util';
import { VisibilityService, AccessControlInfo } from '../domains/visibility.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';
import { UserGroupsService } from '../user-groups/user-groups.service';
import {
  findMatchingRule as findMatchingRuleShared,
  matchesPattern as matchesPatternShared,
  resolveProjectDefaultRuleSetIds as resolveProjectDefaultRuleSetIdsShared,
  resolveRuleSetIdsForAlias as resolveRuleSetIdsForAliasShared,
} from './rule-resolution';

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

/**
 * Pipeline error codes that map to a 4xx response (see the status mapping in
 * handlePipelineExecution): validator outcomes an anonymous caller can trigger
 * on any public rule. These stay debug-gated for execution-log persistence;
 * everything else in a failed result is treated as an execution failure and is
 * always logged (#724). Expressed as an exclusion list so a future unmapped
 * error code defaults to "persist" (fail-visible), matching its 500 response.
 */
const CLIENT_FAULT_ERROR_CODES: ReadonlySet<string> = new Set([
  'VALIDATION_ERROR', // 400
  'AUTH_REQUIRED', // 401
  'AUTHORIZATION_ERROR', // 403
  'RATE_LIMIT_EXCEEDED', // 429
]);

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProxyMiddleware.name);

  // Simple cache for rules (TTL: 10 seconds)
  private ruleCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 10000;

  constructor(
    private readonly proxyRulesService: ProxyRulesService,
    private readonly proxyService: ProxyService,
    private readonly emailFormHandlerService: EmailFormHandlerService,
    private readonly configService: ConfigService,
    private readonly pipelineExecutionService: PipelineExecutionService,
    private readonly executionLogService: PipelineExecutionLogService,
    private readonly visibilityService: VisibilityService,
    private readonly permissionsService: PermissionsService,
    private readonly trafficRoutingService: TrafficRoutingService,
    private readonly userGroupsService: UserGroupsService,
  ) {}

  /**
   * Get the effective proxy type for a rule.
   * Handles backward compatibility with the legacy internalRewrite boolean.
   */
  private getProxyType(rule: ProxyRule): ProxyType {
    // If proxyType is explicitly set and not the default external_proxy
    if (rule.proxyType && rule.proxyType !== 'external_proxy') {
      return rule.proxyType;
    }

    // Backward compatibility: if internalRewrite is true, treat as internal_rewrite
    if (rule.internalRewrite) {
      return 'internal_rewrite';
    }

    return rule.proxyType || 'external_proxy';
  }

  /**
   * True when a rule forwards an auth endpoint (/api/auth/*) to a backend.
   *
   * Only rules the project owner explicitly mapped to the auth backend qualify, and
   * only as a plain proxy - a pipeline or email handler mounted on an auth path is
   * app code, so it stays behind the visibility gate.
   */
  private isAuthProxyRule(rule: ProxyRule): boolean {
    if (this.getProxyType(rule) !== 'external_proxy') {
      return false;
    }

    const pattern = rule.pathPattern ?? '';
    return pattern === '/api/auth' || pattern.startsWith('/api/auth/');
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Only handle /public/* routes
    if (!req.path.startsWith('/public/')) {
      return next();
    }

    try {
      // Check for subdomain-alias format first: /public/subdomain-alias/{aliasName}/{subpath...}
      // This format is used by nginx wildcard server blocks for preview alias subdomains
      const subdomainMatch = req.path.match(/^\/public\/subdomain-alias\/([^/]+)(\/.*)?$/);
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
      let effectiveRuleSetIds: string[] = [];
      let aliasName: string | null = null;
      let resolvedCommitSha: string | null = isSha ? ref : null;

      if (!isSha) {
        aliasName = ref;
        // Look up alias to get its proxy rule sets and commitSha
        const alias = await this.getAliasByName(project.id, ref);
        if (alias) {
          if (alias.commitSha) {
            resolvedCommitSha = alias.commitSha;
          }
          // Resolve rule set IDs: join table → legacy column → project default
          effectiveRuleSetIds = await this.resolveRuleSetIdsForAlias(
            alias.id,
            alias.proxyRuleSetId,
          );
        }
      }

      // Fall back to project defaults if no rule sets resolved
      if (effectiveRuleSetIds.length === 0) {
        effectiveRuleSetIds = await this.resolveProjectDefaultRuleSetIds(
          project.id,
          project.defaultProxyRuleSetId,
        );
      }

      // Apply traffic splitting: check traffic rules and variant cookie
      // This applies to domain-mapped requests (with X-Forwarded-Host) where the URL
      // uses an alias (not a raw SHA). Traffic rules and cookies allow A/B testing by
      // redirecting users to content from a different alias.
      const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
      if (forwardedHost && !isSha && aliasName) {
        // First, evaluate traffic rules (including header-based rules)
        const variantSelection = await this.trafficRoutingService.selectVariant(
          forwardedHost,
          req.cookies?.[TrafficRoutingService.VARIANT_COOKIE_NAME],
          req.query as Record<string, string>,
          req.cookies,
          req.headers as Record<string, string | string[] | undefined>,
        );

        if (variantSelection && variantSelection.selectedAlias !== aliasName) {
          const variantAlias = await this.getAliasByName(
            project.id,
            variantSelection.selectedAlias,
          );
          if (variantAlias?.commitSha) {
            this.logger.debug(
              `Traffic splitting: selected variant "${variantSelection.selectedAlias}" overriding URL alias "${aliasName}"`,
            );
            resolvedCommitSha = variantAlias.commitSha;
            // Update effectiveRuleSetIds if variant alias has its own rules
            const variantRuleSetIds = await this.resolveRuleSetIdsForAlias(
              variantAlias.id,
              variantAlias.proxyRuleSetId,
            );
            if (variantRuleSetIds.length > 0) {
              effectiveRuleSetIds = variantRuleSetIds;
            }
            aliasName = variantSelection.selectedAlias;

            // Set variant cookie if this is a new selection
            if (variantSelection.isNewSelection) {
              res.cookie(
                TrafficRoutingService.VARIANT_COOKIE_NAME,
                variantSelection.selectedAlias,
                {
                  maxAge:
                    variantSelection.stickySessionDuration === 0
                      ? 10 * 365 * 24 * 60 * 60 * 1000 // No expiration: 10 years
                      : variantSelection.stickySessionDuration * 1000,
                  httpOnly: false,
                  secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
                  sameSite: 'lax',
                  path: '/',
                },
              );
            }
          }
        }
      }

      // Get effective rules from the resolved rule sets
      const rules = await this.getCachedRulesMulti(effectiveRuleSetIds);
      this.logger.debug(
        `Proxy middleware: path=${subpathForMatching}, ruleSetIds=${JSON.stringify(effectiveRuleSetIds)}, rulesCount=${rules.length}`,
      );
      if (rules.length === 0) {
        return next();
      }

      // Find matching rule using the appropriate subpath and method
      const matchedRule = this.findMatchingRule(rules, subpathForMatching, req.method);
      if (!matchedRule) {
        this.logger.debug(
          `Proxy middleware: no matching rule for ${req.method} ${subpathForMatching}`,
        );
        return next();
      }

      // Get the effective proxy type (handles backward compatibility)
      const proxyType = this.getProxyType(matchedRule);

      // Handle internal rewrite (no HTTP proxy - just rewrite the URL and continue)
      // This continues to PublicController which has its own visibility check
      if (proxyType === 'internal_rewrite') {
        const newSubpath = this.buildRewritePath(matchedRule, subpathForMatching);
        // Rewrite the URL path for file serving
        // Replace the subpath portion while keeping the /public/{owner}/{repo}/{ref}/ prefix
        const oldPath = req.path;
        const newPath = oldPath.replace(parsed.subpath, newSubpath);
        req.url = req.url.replace(req.path, newPath);

        // Also update the route params - the wildcard param '0' contains the file path
        // This is needed because req.params is already populated by route matching
        // and won't be updated by just modifying req.url
        if (req.params && req.params['0']) {
          // Remove leading slash from newSubpath to match how Express extracts the wildcard
          req.params['0'] = newSubpath.startsWith('/') ? newSubpath.slice(1) : newSubpath;
        }

        // Mark as internally rewritten so controller applies domain mapping path prefix
        (req as any).__internalRewrite = true;

        this.logger.log(
          `Internal rewrite: ${subpathForMatching} → ${newSubpath} (rule: ${matchedRule.id}, params[0]: ${req.params?.['0']})`,
        );
        return next();
      }

      // For all other proxy types (pipeline, email_form_handler, external_proxy),
      // check visibility BEFORE handling - these bypass PublicController
      const visibilityResult = await this.checkVisibilityAndAuth(
        req,
        res,
        project,
        aliasName,
        matchedRule,
      );
      if (visibilityResult === 'blocked') {
        return; // Response already sent
      }

      // Handle email form handler
      if (proxyType === 'email_form_handler') {
        this.logger.debug(`Email form handler: ${subpathForMatching} (rule: ${matchedRule.id})`);
        return this.emailFormHandlerService.handleSubmission(req, res, matchedRule);
      }

      // Handle pipeline execution
      if (proxyType === 'pipeline') {
        this.logger.debug(`Pipeline execution: ${subpathForMatching} (rule: ${matchedRule.id})`);
        const deployment = resolvedCommitSha
          ? {
              owner: project.owner,
              repo: project.name,
              commitSha: resolvedCommitSha,
              alias: aliasName ?? undefined,
            }
          : undefined;
        return this.handlePipelineExecution(req, res, matchedRule, project.id, deployment);
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
   *
   * For domain-mapped requests (www.example.com), the aliasName might not match a real alias
   * (e.g., "www"). In that case, we fall back to looking up the domain mapping to find
   * the actual project and alias.
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
    const subpathForMatching = originalUri ? this.extractPathFromUri(originalUri) : subpath;

    // Look up alias by name (across all projects)
    let alias = await this.getAliasByNameGlobal(aliasName);
    let project: typeof projects.$inferSelect | null = null;
    let resolvedAliasName = aliasName;

    if (!alias) {
      // Alias not found by name - check if this is a domain-mapped request
      // by looking up the X-Forwarded-Host header
      const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
      if (!forwardedHost) {
        return next();
      }

      // Look up domain mapping to find the actual project and alias
      const domainInfo = await this.resolveDomainMapping(forwardedHost);
      if (!domainInfo) {
        return next();
      }

      project = domainInfo.project;
      resolvedAliasName = domainInfo.aliasName;

      // Get the alias record for rule lookup
      alias = await this.getAliasByName(project.id, resolvedAliasName);
      // alias may still be null if the domain mapping points to an alias that doesn't exist,
      // but we can still use project default rules

      this.logger.debug(
        `Domain mapping resolved: host=${forwardedHost}, project=${project.owner}/${project.name}, alias=${resolvedAliasName}`,
      );
    }

    // Get project if we haven't already (happens when alias was found directly)
    if (!project) {
      project = await this.getProjectById(alias!.projectId);
      if (!project) {
        return next();
      }
    }

    // Apply traffic splitting: check traffic rules and variant cookie
    // This runs AFTER we've resolved the project, regardless of whether the alias
    // was found globally or via domain mapping. This ensures traffic rules work
    // for all request paths (dedicated domain server blocks, wildcard subdomains, etc.)
    const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
    if (forwardedHost) {
      const variantSelection = await this.trafficRoutingService.selectVariant(
        forwardedHost,
        req.cookies?.[TrafficRoutingService.VARIANT_COOKIE_NAME],
        req.query as Record<string, string>,
        req.cookies,
        req.headers as Record<string, string | string[] | undefined>,
      );

      if (variantSelection && variantSelection.selectedAlias !== resolvedAliasName) {
        const variantAlias = await this.getAliasByName(project.id, variantSelection.selectedAlias);
        if (variantAlias) {
          this.logger.debug(
            `Traffic splitting: selected variant "${variantSelection.selectedAlias}" overriding alias "${resolvedAliasName}"`,
          );
          alias = variantAlias;
          resolvedAliasName = variantSelection.selectedAlias;

          // Set variant cookie if this is a new selection
          if (variantSelection.isNewSelection) {
            res.cookie(TrafficRoutingService.VARIANT_COOKIE_NAME, variantSelection.selectedAlias, {
              maxAge:
                variantSelection.stickySessionDuration === 0
                  ? 10 * 365 * 24 * 60 * 60 * 1000 // No expiration: 10 years
                  : variantSelection.stickySessionDuration * 1000,
              httpOnly: false,
              secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
              sameSite: 'lax',
              path: '/',
            });
          }
        }
      }
    }

    // Determine effective rule sets:
    // 1. Alias's own rule sets (join table, then legacy column)
    // 2. For preview aliases without rules, check manual aliases with same commit SHA
    // 3. Fall back to project default
    let effectiveRuleSetIds: string[] = [];

    if (alias) {
      effectiveRuleSetIds = await this.resolveRuleSetIdsForAlias(alias.id, alias.proxyRuleSetId);

      if (effectiveRuleSetIds.length === 0 && alias.isAutoPreview) {
        // Try to inherit ALL rule sets from a manual alias pointing to the same commit
        const inheritedIds = await this.findProxyRuleSetsFromCommitAliases(
          alias.projectId,
          alias.commitSha,
        );
        if (inheritedIds.length > 0) {
          effectiveRuleSetIds = inheritedIds;
        }
      }
    }

    if (effectiveRuleSetIds.length === 0) {
      effectiveRuleSetIds = await this.resolveProjectDefaultRuleSetIds(
        project.id,
        project.defaultProxyRuleSetId,
      );
    }

    // Get effective rules from the resolved rule sets
    const rules = await this.getCachedRulesMulti(effectiveRuleSetIds);
    this.logger.debug(
      `Subdomain proxy middleware: path=${subpathForMatching}, alias=${resolvedAliasName}, ruleSetIds=${JSON.stringify(effectiveRuleSetIds)}, rulesCount=${rules.length}`,
    );
    if (rules.length === 0) {
      return next();
    }

    // Find matching rule
    const matchedRule = this.findMatchingRule(rules, subpathForMatching, req.method);
    if (!matchedRule) {
      this.logger.debug(
        `Subdomain proxy middleware: no matching rule for ${req.method} ${subpathForMatching}`,
      );
      return next();
    }

    // Get the effective proxy type (handles backward compatibility)
    const proxyType = this.getProxyType(matchedRule);

    // Handle internal rewrite (no HTTP proxy - just rewrite the URL and continue)
    // This continues to PublicController which has its own visibility check
    if (proxyType === 'internal_rewrite') {
      const newSubpath = this.buildRewritePath(matchedRule, subpathForMatching);
      // For subdomain-alias format, replace the subpath after /public/subdomain-alias/{aliasName}/
      const oldPath = req.path;
      const newPath = oldPath.replace(subpath, newSubpath);
      req.url = req.url.replace(req.path, newPath);

      // Also update the route params - the wildcard param '0' contains the file path
      if (req.params && req.params['0']) {
        req.params['0'] = newSubpath.startsWith('/') ? newSubpath.slice(1) : newSubpath;
      }

      // Mark as internally rewritten so controller applies domain mapping path prefix
      (req as any).__internalRewrite = true;

      this.logger.log(
        `Subdomain internal rewrite: ${subpathForMatching} → ${newSubpath} (alias: ${resolvedAliasName}, rule: ${matchedRule.id})`,
      );
      return next();
    }

    // For all other proxy types (pipeline, email_form_handler, external_proxy),
    // check visibility BEFORE handling - these bypass PublicController
    const visibilityResult = await this.checkVisibilityAndAuth(
      req,
      res,
      project,
      resolvedAliasName,
      matchedRule,
    );
    if (visibilityResult === 'blocked') {
      return; // Response already sent
    }

    // Handle email form handler
    if (proxyType === 'email_form_handler') {
      this.logger.debug(
        `Subdomain email form handler: ${subpathForMatching} (alias: ${resolvedAliasName}, rule: ${matchedRule.id})`,
      );
      return this.emailFormHandlerService.handleSubmission(req, res, matchedRule);
    }

    // Handle pipeline execution
    if (proxyType === 'pipeline') {
      this.logger.debug(
        `Subdomain pipeline execution: ${subpathForMatching} (alias: ${resolvedAliasName}, rule: ${matchedRule.id})`,
      );
      const deployment = alias?.commitSha
        ? {
            owner: project.owner,
            repo: project.name,
            commitSha: alias.commitSha,
            alias: resolvedAliasName ?? undefined,
          }
        : undefined;
      return this.handlePipelineExecution(req, res, matchedRule, project.id, deployment);
    }

    this.logger.debug(
      `Subdomain proxy match: ${subpathForMatching} → ${matchedRule.targetUrl} (alias: ${resolvedAliasName}, rule: ${matchedRule.id})`,
    );

    // Forward request
    await this.proxyService.forward(req, res, matchedRule, subpathForMatching);
  }

  /**
   * Check visibility and authentication for proxy requests.
   * This enforces project/alias visibility before allowing proxy handling.
   *
   * For private deployments:
   * - If not authenticated: returns 401 with appropriate message
   * - If authenticated but insufficient role: returns 403
   *
   * @returns 'allowed' if request should proceed, 'blocked' if response was sent
   */
  private async checkVisibilityAndAuth(
    req: Request,
    res: Response,
    project: typeof projects.$inferSelect,
    aliasName: string | null,
    matchedRule?: ProxyRule,
  ): Promise<'allowed' | 'blocked'> {
    // A private deployment gates every /api/* call on a valid session. That would
    // include the endpoint used to renew an expired session, leaving the client no
    // way out: refreshing requires the session that only refreshing can restore.
    // Let the auth endpoints through - SuperTokens authenticates them itself.
    if (matchedRule && this.isAuthProxyRule(matchedRule)) {
      return 'allowed';
    }

    // A rule that opted out of the gate serves pre-credential callers (OAuth
    // discovery under /.well-known, a webhook receiver). Its own validators still run.
    if (matchedRule?.bypassVisibility) {
      return 'allowed';
    }

    // Resolve access control - check domain mapping first (for subdomain requests),
    // then fall back to alias/project
    let accessControl: AccessControlInfo | null = null;

    // Check if this is a domain-mapped request (has X-Forwarded-Host)
    const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;
    if (forwardedHost) {
      // Try to resolve from domain mapping - this handles domain-level visibility overrides
      accessControl = await this.visibilityService.resolveAccessControlByDomain(forwardedHost);
    }

    // If no domain-level access control, fall back to alias or project
    if (!accessControl) {
      if (aliasName) {
        accessControl = await this.visibilityService.resolveAccessControlForAlias(
          project.id,
          aliasName,
        );
      } else {
        // No alias - use project defaults
        accessControl = {
          isPublic: project.isPublic,
          unauthorizedBehavior:
            (project.unauthorizedBehavior as 'not_found' | 'redirect_login') || 'not_found',
          requiredRole:
            (project.requiredRole as
              | 'authenticated'
              | 'viewer'
              | 'contributor'
              | 'admin'
              | 'owner') || 'authenticated',
          source: 'project',
        };
      }
    }

    // If public, allow the request
    if (accessControl.isPublic) {
      return 'allowed';
    }

    // Private deployment - check authentication
    const user = await this.getOptionalUser(req, res);

    if (!user) {
      // Not authenticated
      this.logger.debug(`Proxy blocked: not authenticated for private ${aliasName || 'project'}`);

      if (this.isApiRequest(req)) {
        // RFC 9728 §5.1: tell a bearer client where the resource's OAuth metadata is
        // (an app-shipped /.well-known rule), so a connector can start its flow.
        this.setResourceMetadataHint(req, res);
        // Check if token was expired (set by AuthMiddleware)
        // If so, the response was already sent by AuthMiddleware
        // This is a fallback for cases where AuthMiddleware didn't catch it
        const tokenExpired = (req as any).tokenExpired;

        if (tokenExpired) {
          // Token was expired - signal try refresh (SuperTokens format)
          res.status(401).json({
            message: 'try refresh token',
          });
        } else {
          // No token at all (SuperTokens format)
          res.status(401).json({
            message: 'unauthorised',
          });
        }
      } else {
        // Browser request - redirect to login
        const fullUrl = this.buildFullRequestUrl(req);
        const authUrl = await this.getAuthRedirectUrl(req, fullUrl);
        res.redirect(302, authUrl);
      }

      return 'blocked';
    }

    // An app token is bound to one project: valid, but not for here.
    if (user.tokenProjectId && user.tokenProjectId !== project.id) {
      this.logger.debug(
        `Proxy blocked: app token bound to ${user.tokenProjectId}, not ${project.id}`,
      );
      res.status(403).json({
        message: 'Token is bound to another project',
        code: 'TOKEN_PROJECT_MISMATCH',
      });
      return 'blocked';
    }

    // Authenticated - check role requirements
    const userRole = await this.permissionsService.getUserProjectRole(user.id, project.id);

    if (!this.permissionsService.meetsRoleRequirement(userRole, accessControl.requiredRole)) {
      this.logger.debug(
        `Proxy blocked: user ${user.id} has role ${userRole}, needs ${accessControl.requiredRole}`,
      );

      res.status(403).json({
        message: 'Access denied',
        code: 'FORBIDDEN',
        requiredRole: accessControl.requiredRole,
        currentRole: userRole,
      });

      return 'blocked';
    }

    // User has access
    return 'allowed';
  }

  /**
   * `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"`
   * (RFC 9728 §5.1) on a 401 that reached CE through a domain host. The document itself is
   * the app's to ship (a rule served despite visibility); CE only points at where it would be.
   */
  private setResourceMetadataHint(req: Request, res: Response): void {
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    if (!host) return;
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="https://${host.split(',')[0].trim()}/.well-known/oauth-protected-resource"`,
    );
  }

  /**
   * Determines if this is an API request (expects JSON response)
   * vs a browser request (can handle redirects)
   */
  private isApiRequest(req: Request): boolean {
    const acceptHeader = req.headers.accept || '';
    const contentType = req.headers['content-type'] || '';

    // XHR/fetch requests typically want JSON
    if (acceptHeader.includes('application/json')) {
      return true;
    }

    // Requests sending JSON are likely API calls
    if (contentType.includes('application/json')) {
      return true;
    }

    // X-Requested-With header indicates AJAX
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return true;
    }

    // API key header indicates programmatic access
    if (req.headers['x-api-key']) {
      return true;
    }

    // A bearer credential (an app token) is never a browser: 401 JSON, not a redirect
    if (req.headers.authorization) {
      return true;
    }

    // Accept header starts with application/* (not text/html) suggests API client
    if (acceptHeader.startsWith('application/') && !acceptHeader.includes('text/html')) {
      return true;
    }

    // Default: treat as browser request
    return false;
  }

  /**
   * Build the full request URL including protocol, host, and path
   */
  private buildFullRequestUrl(req: Request): string {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const originalUri = req.headers['x-original-uri'] as string | undefined;
    const path = originalUri || req.originalUrl;

    return `${protocol}://${host}${path}`;
  }

  /**
   * Get the auth redirect URL for private deployments.
   * Matches PublicController's getAuthRedirectUrl logic.
   */
  private async getAuthRedirectUrl(req: Request, redirectUrl: string): Promise<string> {
    const host = (req.headers['x-forwarded-host'] || req.get('host')) as string;
    const requestDomain = host?.split(':')[0]; // Remove port if present

    // Check if this is a custom domain by looking it up in domain_mappings
    const [mapping] = await db
      .select()
      .from(domainMappings)
      .where(and(eq(domainMappings.domain, requestDomain), eq(domainMappings.isActive, true)))
      .limit(1);

    if (mapping?.domainType === 'custom') {
      // Custom domain - redirect to workspace admin with customDomainRelay param
      const protocol = 'https';
      const originalUri = req.headers['x-original-uri'] as string | undefined;
      const originalPath = originalUri || req.originalUrl || '/';

      const adminDomain = this.configService.get<string>('ADMIN_DOMAIN');
      let loginHost: string;

      if (adminDomain) {
        loginHost = adminDomain;
      } else {
        const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || 'localhost';
        loginHost = `admin.${primaryDomain}`;
      }

      const params = new URLSearchParams({
        customDomainRelay: 'true',
        targetDomain: requestDomain,
        redirect: originalPath,
      });

      return `${protocol}://${loginHost}/login?${params.toString()}`;
    }

    // Standard workspace domain redirect
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const params = `redirect=${encodeURIComponent(redirectUrl)}&tryRefresh=true`;

    const adminDomain = this.configService.get<string>('ADMIN_DOMAIN');
    if (adminDomain) {
      return `${protocol}://${adminDomain}/login?${params}`;
    }

    // Fallback for self-hosted setups
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || 'localhost';
    return `${protocol}://admin.${primaryDomain}/login?${params}`;
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
   * Find proxy rule set IDs from manual aliases that point to the same commit.
   * This allows auto-preview aliases to inherit proxy rules from manual aliases
   * (like "production" or "preview") that point to the same commit SHA.
   *
   * Reads the join table first (modern multi-rule-set attachment), then falls
   * back to the legacy single-id column. Returns ALL inherited rule set IDs in
   * `order` so every rule applied to the manual alias also applies to the
   * auto-preview alias.
   */
  private async findProxyRuleSetsFromCommitAliases(
    projectId: string,
    commitSha: string,
  ): Promise<string[]> {
    const manualAliases = await db
      .select({ id: deploymentAliases.id, proxyRuleSetId: deploymentAliases.proxyRuleSetId })
      .from(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, projectId),
          eq(deploymentAliases.commitSha, commitSha),
          eq(deploymentAliases.isAutoPreview, false),
        ),
      );

    for (const manual of manualAliases) {
      const joinRows = await db
        .select({ proxyRuleSetId: aliasProxyRuleSets.proxyRuleSetId })
        .from(aliasProxyRuleSets)
        .where(eq(aliasProxyRuleSets.aliasId, manual.id))
        .orderBy(asc(aliasProxyRuleSets.order));

      if (joinRows.length > 0) {
        return joinRows.map((r) => r.proxyRuleSetId);
      }
      if (manual.proxyRuleSetId) {
        return [manual.proxyRuleSetId];
      }
    }

    return [];
  }

  /**
   * Get project by ID (returns null if not found)
   */
  private async getProjectById(projectId: string): Promise<typeof projects.$inferSelect | null> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    return project || null;
  }

  /**
   * Resolve a domain mapping by hostname to get the project and alias.
   * Handles both direct domain matches and primary domain lookups (www handling).
   *
   * @returns Object with project and aliasName, or null if not found
   */
  private async resolveDomainMapping(
    host: string,
  ): Promise<{ project: typeof projects.$inferSelect; aliasName: string } | null> {
    // Build domain variants: check both www and non-www versions
    const wwwVariant = host.startsWith('www.') ? host : `www.${host}`;
    const nonWwwVariant = host.startsWith('www.') ? host.slice(4) : host;

    // Try direct domain match first (checking both www/non-www)
    let [mapping] = await db
      .select()
      .from(domainMappings)
      .where(
        and(
          or(
            eq(domainMappings.domain, host),
            eq(domainMappings.domain, wwwVariant),
            eq(domainMappings.domain, nonWwwVariant),
          ),
          eq(domainMappings.isActive, true),
        ),
      )
      .limit(1);

    // If no direct match, check if host is the primary domain or www.primary_domain
    if (!mapping) {
      const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || 'localhost';
      if (host === primaryDomain || host === `www.${primaryDomain}`) {
        const [primaryMapping] = await db
          .select()
          .from(domainMappings)
          .where(and(eq(domainMappings.isPrimary, true), eq(domainMappings.isActive, true)))
          .limit(1);

        if (primaryMapping) {
          mapping = primaryMapping;
        }
      }
    }

    if (!mapping || !mapping.projectId || !mapping.alias) {
      return null;
    }

    // Redirect domain type doesn't serve content
    if (mapping.domainType === 'redirect') {
      return null;
    }

    const project = await this.getProjectById(mapping.projectId);
    if (!project) {
      return null;
    }

    return {
      project,
      aliasName: mapping.alias,
    };
  }

  /** Rule resolution lives in `rule-resolution.ts`, shared with the in-process invoker. */
  private resolveRuleSetIdsForAlias(
    aliasId: string,
    legacyProxyRuleSetId: string | null,
  ): Promise<string[]> {
    return resolveRuleSetIdsForAliasShared(aliasId, legacyProxyRuleSetId);
  }

  private resolveProjectDefaultRuleSetIds(
    projectId: string,
    legacyDefaultProxyRuleSetId: string | null,
  ): Promise<string[]> {
    return resolveProjectDefaultRuleSetIdsShared(projectId, legacyDefaultProxyRuleSetId);
  }

  /**
   * Get rules with caching based on rule set ID
   *
   * @deprecated Use getCachedRulesMulti instead
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
   * Get rules with caching based on multiple rule set IDs.
   * Merges rules from all sets with deduplication.
   */
  private async getCachedRulesMulti(ruleSetIds: string[]): Promise<ProxyRule[]> {
    if (ruleSetIds.length === 0) {
      return [];
    }

    // For single rule set, use the existing cache path
    if (ruleSetIds.length === 1) {
      return this.getCachedRules(ruleSetIds[0]);
    }

    // Cache key based on sorted IDs for consistency
    const cacheKey = `rulesets:${ruleSetIds.join(',')}`;
    const cached = this.ruleCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      return cached.rules;
    }

    const rules = await this.proxyRulesService.getEffectiveRulesForMultipleRuleSets(ruleSetIds);
    this.ruleCache.set(cacheKey, { rules, expiry: Date.now() + this.CACHE_TTL });
    return rules;
  }

  /**
   * Find a matching rule for the given subpath and HTTP method
   * Rules are already sorted by order, so the first match wins
   *
   * Method matching:
   * - If rule.method is null, it matches any HTTP method
   * - If rule.method is set, it must match the request method (case-insensitive)
   */
  private findMatchingRule(rules: ProxyRule[], subpath: string, method?: string): ProxyRule | null {
    return findMatchingRuleShared(rules, subpath, method);
  }

  /**
   * Handle pipeline execution for pipeline proxy rules.
   * Builds a Pipeline object from the proxy rule's pipelineConfig and executes it.
   */
  private async handlePipelineExecution(
    req: Request,
    res: Response,
    rule: ProxyRule,
    projectId: string,
    deployment?: { owner: string; repo: string; commitSha: string; alias?: string },
  ): Promise<void> {
    // Built the way the in-process invoker builds a sibling (pipeline-from-rule.ts).
    const pipeline = pipelineFromRule(rule, projectId);
    if (!pipeline) {
      this.logger.error(`Pipeline rule ${rule.id} has no pipeline configuration`);
      res.status(500).json({
        error: 'Pipeline configuration missing',
        code: 'PIPELINE_CONFIG_MISSING',
      });
      return;
    }
    const pipelineConfig = rule.pipelineConfig as PipelineConfig;

    // Hoisted so the outer catch can attribute its failure log to the caller.
    let user: PipelineUser | undefined;

    try {
      // If pipeline has file_upload_handler, parse multipart before executing
      const uploadStep = pipelineConfig.steps.find((s) => s.handlerType === 'file_upload_handler');
      if (uploadStep) {
        const uploadConfig = uploadStep.config as any;
        const fileField = uploadConfig?.fileField || 'file';
        const hardLimit = 50 * 1024 * 1024; // 50MB absolute ceiling
        const maxFileSize = Math.min(uploadConfig?.maxFileSize || hardLimit, hardLimit);
        await this.parseMultipartUpload(req, fileField, maxFileSize);
      }

      // Extract user from session if available (optional - don't fail if not authenticated)
      user = await this.getOptionalUser(req, res);

      // Enrich with group memberships for the sandboxed pipeline context. Group
      // lookup must never take the request down: on failure, degrade to "no groups".
      let pipelineUser: PipelineUser | undefined = user;
      if (user) {
        try {
          pipelineUser = {
            ...user,
            groups: await this.userGroupsService.getGroupIdsForUser(user.id),
          };
        } catch (error) {
          this.logger.warn(`Group membership lookup failed for ${user.id}: ${error}`);
          pipelineUser = { ...user, groups: [] };
        }
      }

      // Execute the pipeline with deployment context for skills access
      const result = await this.pipelineExecutionService.executePipelineWithDebug(
        pipeline,
        req,
        pipelineUser,
        // Only retain in-memory debug snapshots when this rule actually persists
        // them; otherwise they're built and thrown away, needlessly pressuring the heap.
        { deployment, captureDebug: rule.debugEnabled },
      );

      // If the response was already sent (e.g., by a streaming handler), don't try to send again
      if (res.headersSent) {
        return;
      }

      // When this run persists an execution log, choose the row id up front so
      // the response can carry it (X-Pipeline-Log-Id) while the insert below
      // stays fire-and-forget. A caller that gets a failed response can then
      // fetch GET /api/pipeline-logs/:id directly instead of matching by
      // timestamp. Execution failures (the unmapped-to-4xx bucket that answers
      // 500) are always logged (#724) so production rules leave a record
      // without debug mode. Successes AND client-fault validator outcomes
      // (400/401/403/429) stay debug-gated: those are triggerable by anonymous
      // public traffic on every request, and logging them would add DB write
      // load exactly under rate-limit/bot pressure and crowd the small
      // per-rule retention window with 4xx noise. An unmapped error code
      // defaults to "persist" (fail-visible).
      const isExecutionFailure =
        !result.success && !CLIENT_FAULT_ERROR_CODES.has(result.error?.code ?? '');
      const shouldPersistLog = rule.debugEnabled || isExecutionFailure;
      const logId = shouldPersistLog ? randomUUID() : undefined;

      if (result.success && result.response) {
        // Set response headers if provided
        if (result.response.headers) {
          for (const [key, value] of Object.entries(result.response.headers)) {
            res.setHeader(key, value);
          }
        }
        if (logId) {
          res.setHeader(PIPELINE_LOG_ID_HEADER, logId);
        }
        // Use res.send (not res.json): for string bodies (text/plain, text/html,
        // application/x-sh, etc.) res.json would JSON.stringify the string and
        // produce `"#!/bin/sh\n..."` instead of the raw script. res.send writes
        // strings verbatim, calls res.json for objects/arrays, and respects the
        // Content-Type header we already set above.
        res.status(result.response.status).send(result.response.body);
      } else {
        // Pipeline failed - map error codes to appropriate HTTP status codes
        // (pipeline-from-rule.ts, shared with the in-process invoker)
        const statusCode = statusForPipelineError(result.error?.code);
        if (statusCode === 401) this.setResourceMetadataHint(req, res);
        // RFC 6750 §3.1: a token that lacks the rule's scope is told which one.
        const scopeHeader = insufficientScopeHeader(result.error);
        if (scopeHeader) {
          res.setHeader('WWW-Authenticate', scopeHeader);
        }
        if (logId) {
          res.setHeader(PIPELINE_LOG_ID_HEADER, logId);
        }
        res.status(statusCode).json({
          success: false,
          error: result.error,
        });
      }

      // Fire-and-forget: persist execution log when debug is enabled or the
      // run hit an execution failure. Wait for post-steps to complete so their
      // debug info is included (with debug off, result.debug is absent and the
      // log service stores a minimal envelope).
      if (logId) {
        const persistLog = async () => {
          if (result.postStepsPromise) {
            try {
              const postStepsDebug = await result.postStepsPromise;
              if (result.debug && postStepsDebug.length > 0) {
                result.debug.postSteps = postStepsDebug;
              }
            } catch (err) {
              this.logger.error('Failed to capture post-steps debug info', err);
            }
          }
          await this.executionLogService.log(
            rule.id,
            projectId,
            result,
            {
              ip: req.ip,
              userAgent: req.headers['user-agent'],
              userId: user?.id,
            },
            req.method,
            req.path,
            logId,
          );
        };
        persistLog().catch((err) =>
          this.logger.error('Failed to persist pipeline execution log', err),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // A thrown error is an execution failure (answered as 500): always
      // persist a log row (#724) so the failure is visible even with debug
      // off, and let the response carry the row id when it hasn't gone out yet.
      const logId = randomUUID();
      if (!res.headersSent) {
        res.setHeader(PIPELINE_LOG_ID_HEADER, logId);
        res.status(500).json({
          error: 'Pipeline execution failed',
          code: 'PIPELINE_EXECUTION_ERROR',
          message,
        });
      }
      const failedResult: PipelineDebugResult = {
        success: false,
        error: { code: 'PIPELINE_EXECUTION_ERROR', message },
      };
      this.executionLogService
        .log(
          rule.id,
          projectId,
          failedResult,
          {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            userId: user?.id,
          },
          req.method,
          req.path,
          logId,
        )
        .catch((err) => this.logger.error('Failed to persist pipeline execution log', err));
    }
  }

  /**
   * Parse multipart form data using multer (for file upload pipelines).
   * Populates req.file with the uploaded file buffer.
   */
  private parseMultipartUpload(
    req: Request,
    fieldName = 'file',
    maxFileSize = 50 * 1024 * 1024,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxFileSize },
      }).single(fieldName);
      upload(req, {} as any, (err: any) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Optionally extract user from session without failing if not authenticated.
   * Returns undefined if no session exists or user cannot be determined.
   */
  private async getOptionalUser(req: Request, res: Response): Promise<PipelineUser | undefined> {
    try {
      // Check if user was already populated by a guard
      if ((req as any).user?.id) {
        this.logger.debug(`User already on request: ${(req as any).user.id}`);
        return this.fromGuardUser((req as any).user);
      }

      this.logger.debug(`Attempting to get session for ${req.path}`);

      // Try SuperTokens session first. Its own try/catch: a session lookup that
      // throws (a malformed cookie, SuperTokens not initialised in a unit test)
      // must not hide the credentials tried after it.
      const session = await getSession(req, res, { sessionRequired: false }).catch((error) => {
        this.logger.debug(`Session lookup failed: ${error}`);
        return undefined;
      });
      if (session) {
        const userId = session.getUserId();
        this.logger.debug(`SuperTokens session found for user: ${userId}`);

        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (user) {
          this.logger.debug(`User authenticated via SuperTokens: ${userId}, role: ${user.role}`);
          return {
            id: userId,
            email: user.email || undefined,
            role: user.role || undefined,
            credential: 'session',
          };
        }
      }

      // Try a Bearer app token: the member, narrowed by its scopes (app-token.util)
      const resolved = await resolveAppToken(req.headers.authorization);
      if (resolved) {
        this.logger.debug(`User authenticated via app token: ${resolved.user.id}`);
        return {
          id: resolved.user.id,
          email: resolved.user.email || undefined,
          role: resolved.user.role || undefined,
          credential: 'app_token',
          scopes: resolved.token.scopes,
          tokenProjectId: resolved.token.projectId,
        };
      }

      // Try custom domain JWT auth (bffless_access cookie)
      const customDomainUser = await this.tryCustomDomainAuth(req);
      if (customDomainUser) {
        return { ...customDomainUser, credential: 'custom_domain' };
      }

      // Try API key authentication (X-API-Key header)
      const apiKeyUser = await this.tryApiKeyAuth(req);
      if (apiKeyUser) {
        return { ...apiKeyUser, credential: 'api_key' };
      }

      this.logger.debug('No session, custom domain auth, or API key found');
      return undefined;
    } catch (error) {
      // Silently fail - this is optional auth
      this.logger.warn(`Optional user extraction failed: ${error}`);
      return undefined;
    }
  }

  /**
   * A user a guard already attached (`OptionalAuthGuard` shape), as the
   * pipeline user: an app token's credential block becomes the flat
   * `credential` / `scopes` / `tokenProjectId` the validators read.
   */
  private fromGuardUser(user: {
    id: string;
    email?: string;
    role?: string;
    apiKeyId?: string;
    credential?: { kind: string; scopes?: string[]; projectId?: string };
  }): PipelineUser {
    const base: PipelineUser = { id: user.id, email: user.email, role: user.role };
    if (user.credential?.kind === 'app_token') {
      return {
        ...base,
        credential: 'app_token',
        scopes: user.credential.scopes ?? [],
        tokenProjectId: user.credential.projectId,
      };
    }
    if (user.apiKeyId) return { ...base, credential: 'api_key' };
    return base;
  }

  /**
   * Try to authenticate via custom domain cookies (bffless_access).
   * Used for custom domains that have their own JWT-based auth.
   */
  private async tryCustomDomainAuth(
    req: Request,
  ): Promise<{ id: string; email?: string; role?: string } | undefined> {
    try {
      const accessToken = (req as any).cookies?.[CustomDomainAuthService.ACCESS_COOKIE_NAME];
      if (!accessToken) {
        return undefined;
      }

      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      if (!jwtSecret) {
        this.logger.warn('JWT_SECRET not configured for custom domain auth');
        return undefined;
      }

      // Validate the JWT token
      const decoded = jwt.verify(accessToken, jwtSecret, {
        algorithms: ['HS256'],
      }) as { sub: string; email: string; role: string; domain: string; type: string };

      // Verify this is an access token
      if (decoded.type !== 'access') {
        this.logger.debug('Token is not an access token');
        return undefined;
      }

      // Verify the domain matches the request
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const requestDomain = typeof host === 'string' ? host.split(':')[0] : undefined;

      if (decoded.domain !== requestDomain) {
        this.logger.debug(
          `Custom domain auth: domain mismatch (token: ${decoded.domain}, request: ${requestDomain})`,
        );
        return undefined;
      }

      // Verify user still exists in the database
      const [user] = await db.select().from(users).where(eq(users.id, decoded.sub)).limit(1);
      if (!user) {
        this.logger.debug(`Custom domain auth: user ${decoded.sub} not found`);
        return undefined;
      }

      if (user.disabled) {
        this.logger.debug(`Custom domain auth: user ${decoded.sub} is disabled`);
        return undefined;
      }

      this.logger.debug(
        `User authenticated via custom domain: ${decoded.sub}, role: ${decoded.role}`,
      );
      return {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        this.logger.debug('Custom domain access token expired');
      } else {
        this.logger.debug(`Custom domain auth failed: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * Try to authenticate via API key (X-API-Key header).
   * Uses the same validation logic as ApiKeyGuard.
   */
  private async tryApiKeyAuth(
    req: Request,
  ): Promise<{ id: string; email?: string; role?: string } | undefined> {
    try {
      const apiKey = req.headers['x-api-key'];
      if (!apiKey || typeof apiKey !== 'string') {
        return undefined;
      }

      const allKeys = await db.select().from(apiKeys);

      let matchedKey: (typeof allKeys)[0] | null = null;
      for (const keyRecord of allKeys) {
        const isMatch = await bcrypt.compare(apiKey, keyRecord.key);
        if (isMatch) {
          matchedKey = keyRecord;
          break;
        }
      }

      if (!matchedKey) {
        this.logger.debug('API key provided but no match found');
        return undefined;
      }

      if (matchedKey.expiresAt && new Date() > new Date(matchedKey.expiresAt)) {
        this.logger.debug('API key has expired');
        return undefined;
      }

      // Update last used timestamp
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, matchedKey.id));

      this.logger.debug(`User authenticated via API key: ${matchedKey.userId}`);
      return {
        id: matchedKey.userId,
        role: 'user',
      };
    } catch (error) {
      this.logger.debug(`API key auth failed: ${error}`);
      return undefined;
    }
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
   * Check if a path matches a pattern. `*` is a wildcard that matches any
   * sequence of characters (including slashes). Supports wildcards at any
   * position.
   *
   * Examples:
   * - Exact:   '/graphql' matches only '/graphql'
   * - Prefix:  '/api/*' matches '/api', '/api/', '/api/users', '/api/posts/1'
   * - Suffix:  '*.json' matches '/config.json', '/data.json'
   * - Middle:  '/api/uploads/feedback-*' matches '/api/uploads/feedback-screenshots'
   */
  private matchesPattern(pattern: string, path: string): boolean {
    return matchesPatternShared(pattern, path);
  }
}
