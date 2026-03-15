import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { eq, and, or } from 'drizzle-orm';
import { getSession } from 'supertokens-node/recipe/session';
import * as jwt from 'jsonwebtoken';
import { db } from '../db/client';
import { projects, deploymentAliases, domainMappings, users } from '../db/schema';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyService } from './proxy.service';
import { EmailFormHandlerService } from './email-form-handler.service';
import { ProxyRule, ProxyType, PipelineConfig } from '../db/schema/proxy-rules.schema';
import { ConfigService } from '@nestjs/config';
import { PipelineExecutionService } from '../pipelines/execution';
import { Pipeline, PipelineStep } from '../pipelines/types';
import { CustomDomainAuthService } from '../auth/custom-domain-auth.service';
import { VisibilityService, AccessControlInfo } from '../domains/visibility.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';

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
    private readonly emailFormHandlerService: EmailFormHandlerService,
    private readonly configService: ConfigService,
    private readonly pipelineExecutionService: PipelineExecutionService,
    private readonly visibilityService: VisibilityService,
    private readonly permissionsService: PermissionsService,
    private readonly trafficRoutingService: TrafficRoutingService,
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
      let effectiveRuleSetId: string | null = project.defaultProxyRuleSetId;
      let aliasName: string | null = null;
      let resolvedCommitSha: string | null = isSha ? ref : null;

      if (!isSha) {
        aliasName = ref;
        // Look up alias to get its proxyRuleSetId and commitSha
        const alias = await this.getAliasByName(project.id, ref);
        if (alias?.proxyRuleSetId) {
          // Alias has its own rule set - use it (overrides project default)
          effectiveRuleSetId = alias.proxyRuleSetId;
        }
        if (alias?.commitSha) {
          resolvedCommitSha = alias.commitSha;
        }
        // If alias doesn't have a rule set, fall through to project default
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
          const variantAlias = await this.getAliasByName(project.id, variantSelection.selectedAlias);
          if (variantAlias?.commitSha) {
            this.logger.debug(
              `Traffic splitting: selected variant "${variantSelection.selectedAlias}" overriding URL alias "${aliasName}"`,
            );
            resolvedCommitSha = variantAlias.commitSha;
            // Update effectiveRuleSetId if variant alias has its own rules
            if (variantAlias.proxyRuleSetId) {
              effectiveRuleSetId = variantAlias.proxyRuleSetId;
            }
            aliasName = variantSelection.selectedAlias;

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

      // Get effective rules from the resolved rule set
      const rules = await this.getCachedRules(effectiveRuleSetId);
      this.logger.debug(
        `Proxy middleware: path=${subpathForMatching}, ruleSetId=${effectiveRuleSetId}, rulesCount=${rules.length}`,
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
      const visibilityResult = await this.checkVisibilityAndAuth(req, res, project, aliasName);
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
          ? { owner: project.owner, repo: project.name, commitSha: resolvedCommitSha }
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

    // Determine effective rule set:
    // 1. Alias's own proxyRuleSetId (if set)
    // 2. For preview aliases without rules, check manual aliases with same commit SHA
    // 3. Fall back to project default
    let effectiveRuleSetId = alias?.proxyRuleSetId ?? null;

    if (!effectiveRuleSetId && alias?.isAutoPreview) {
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
    this.logger.debug(
      `Subdomain proxy middleware: path=${subpathForMatching}, alias=${resolvedAliasName}, ruleSetId=${effectiveRuleSetId}, rulesCount=${rules.length}`,
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
        ? { owner: project.owner, repo: project.name, commitSha: alias.commitSha }
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
  ): Promise<'allowed' | 'blocked'> {
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
   * Find a matching rule for the given subpath and HTTP method
   * Rules are already sorted by order, so the first match wins
   *
   * Method matching:
   * - If rule.method is null, it matches any HTTP method
   * - If rule.method is set, it must match the request method (case-insensitive)
   */
  private findMatchingRule(rules: ProxyRule[], subpath: string, method?: string): ProxyRule | null {
    const requestMethod = method?.toUpperCase();

    for (const rule of rules) {
      if (!rule.isEnabled) {
        continue;
      }

      // Check path pattern first
      if (!this.matchesPattern(rule.pathPattern, subpath)) {
        continue;
      }

      // Check method if specified on rule
      if (rule.method && requestMethod && rule.method.toUpperCase() !== requestMethod) {
        continue;
      }

      return rule;
    }
    return null;
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
    deployment?: { owner: string; repo: string; commitSha: string },
  ): Promise<void> {
    const pipelineConfig = rule.pipelineConfig as PipelineConfig | null;

    if (!pipelineConfig || !pipelineConfig.steps || pipelineConfig.steps.length === 0) {
      this.logger.error(`Pipeline rule ${rule.id} has no pipeline configuration`);
      res.status(500).json({
        error: 'Pipeline configuration missing',
        code: 'PIPELINE_CONFIG_MISSING',
      });
      return;
    }

    // Build Pipeline object from proxy rule config
    const pipeline: Pipeline & { steps: PipelineStep[] } = {
      id: rule.id,
      projectId: projectId,
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
    };

    try {
      // Extract user from session if available (optional - don't fail if not authenticated)
      const user = await this.getOptionalUser(req, res);

      // Execute the pipeline with deployment context for skills access
      const result = await this.pipelineExecutionService.executePipelineWithDebug(
        pipeline,
        req,
        user,
        { deployment },
      );

      // If the response was already sent (e.g., by a streaming handler), don't try to send again
      if (res.headersSent) {
        return;
      }

      if (result.success && result.response) {
        // Set response headers if provided
        if (result.response.headers) {
          for (const [key, value] of Object.entries(result.response.headers)) {
            res.setHeader(key, value);
          }
        }
        res.status(result.response.status).json(result.response.body);
      } else {
        // Pipeline failed - map error codes to appropriate HTTP status codes
        const errorCode = result.error?.code;
        let statusCode = 500;
        if (errorCode === 'VALIDATION_ERROR') {
          statusCode = 400;
        } else if (errorCode === 'AUTH_REQUIRED') {
          statusCode = 401;
        } else if (errorCode === 'AUTHORIZATION_ERROR') {
          statusCode = 403;
        } else if (errorCode === 'RATE_LIMIT_EXCEEDED') {
          statusCode = 429;
        }
        res.status(statusCode).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      this.logger.error(
        `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Pipeline execution failed',
          code: 'PIPELINE_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Optionally extract user from session without failing if not authenticated.
   * Returns undefined if no session exists or user cannot be determined.
   */
  private async getOptionalUser(
    req: Request,
    res: Response,
  ): Promise<{ id: string; email?: string; role?: string } | undefined> {
    try {
      // Check if user was already populated by a guard
      if ((req as any).user?.id) {
        this.logger.debug(`User already on request: ${(req as any).user.id}`);
        return (req as any).user;
      }

      this.logger.debug(`Attempting to get session for ${req.path}`);

      // Try SuperTokens session first
      const session = await getSession(req, res, { sessionRequired: false });
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
          };
        }
      }

      // Try custom domain JWT auth (bffless_access cookie)
      const customDomainUser = await this.tryCustomDomainAuth(req);
      if (customDomainUser) {
        return customDomainUser;
      }

      this.logger.debug('No session or custom domain auth found');
      return undefined;
    } catch (error) {
      // Silently fail - this is optional auth
      this.logger.warn(`Optional user extraction failed: ${error}`);
      return undefined;
    }
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
