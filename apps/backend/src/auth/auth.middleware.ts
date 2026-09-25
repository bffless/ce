import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { middleware } from 'supertokens-node/framework/express';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { VisibilityService } from '../domains/visibility.service';
import { isApiRequest } from '../common/request-kind';

/**
 * Auth middleware that wraps SuperTokens middleware with additional
 * expired token detection for better client-side handling.
 *
 * Handles both auth methods:
 * - SuperTokens (sAccessToken cookie) - for subdomain/admin panel auth
 * - Custom domain auth (bffless_access cookie) - for custom domain auth
 *
 * For API requests with expired access tokens, returns a 401 with
 * "try refresh token" message (SuperTokens format) so clients know to
 * attempt a token refresh before giving up.
 *
 * For browser requests, continues normally - guards will redirect to login.
 *
 * IMPORTANT: For /public/* routes on public domains, we skip the 401
 * response and let the request continue to PublicController, which
 * will serve the content without authentication.
 *
 * Likewise for an auth endpoint reached through an alias or subdomain host
 * (issue #811): nginx rewrites `POST /api/auth/session/refresh` on such a host
 * to `/public/subdomain-alias/<alias>/api/auth/...` (or
 * `/public/<owner>/<repo>/alias/<alias>/api/auth/...`), so `isAuthEndpoint`
 * does not see it. Answering 401 here would mean the refresh itself is refused
 * and the session can never recover. Whether the request may pass is the
 * matched proxy rule's call, and only ProxyMiddleware has that rule: it lets an
 * auth proxy rule (`isAuthProxyRule`) through and answers this same
 * "try refresh token" 401 from `req.tokenExpired` for anything else. So for
 * that one shape the expired-token check only sets the flag and defers.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly visibilityService: VisibilityService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Use originalUrl which preserves the full path even after nginx proxy_pass
    // req.path may be stripped by nginx depending on proxy configuration
    const requestPath = req.originalUrl?.split('?')[0] || req.path;

    // Skip expired token check for auth endpoints - they need to work with expired tokens!
    // These are the endpoints used to sign in, refresh, or manage sessions
    if (this.isAuthEndpoint(requestPath)) {
      return middleware()(req, res, next);
    }

    // Check for expired access token BEFORE SuperTokens middleware
    // Supports both SuperTokens (sAccessToken) and custom domain auth (bffless_access)
    const supertokensToken = (req as any).cookies?.sAccessToken;
    const customDomainToken = (req as any).cookies?.bffless_access;
    const accessToken = supertokensToken || customDomainToken;

    if (accessToken) {
      try {
        // Decode JWT (both SuperTokens and custom domain auth use JWTs)
        // We just decode without verification - auth guards will verify later
        const decoded = jwt.decode(accessToken) as { exp?: number } | null;

        if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
          // Token is expired
          const tokenType = supertokensToken ? 'SuperTokens' : 'custom domain';
          this.logger.debug(`${tokenType} access token expired for ${req.method} ${requestPath}`);

          // Set flag for downstream use
          (req as any).tokenExpired = true;

          // For API requests, return "try refresh" response immediately
          // UNLESS this is a public route on a public domain - then let it through
          // This prevents unnecessary pipeline/controller execution
          // Uses SuperTokens response format for consistency
          if (isApiRequest(req)) {
            if (this.isAuthPathBehindPublicPrefix(req)) {
              // An auth endpoint on an alias / subdomain host (#811). Defer to
              // ProxyMiddleware: it has the matched rule, lets an auth proxy rule
              // through, and answers this same 401 (via req.tokenExpired) otherwise.
              this.logger.debug(
                `Deferring expired-token check for auth path behind public prefix: ${requestPath}`,
              );
            } else if (await this.isPublicRoute(req)) {
              // Public route on a public domain - continue to the controller,
              // it will serve public content
              this.logger.debug(`Skipping 401 for expired token on public domain: ${requestPath}`);
            } else {
              this.logger.debug('Returning try refresh token response for API request');
              return res.status(401).json({
                message: 'try refresh token',
              });
            }
          }

          // For browser requests, continue - guards will handle redirect
        }
      } catch (error) {
        // Invalid token format - let downstream middleware/guards handle it
        this.logger.debug(`Failed to decode access token: ${error}`);
      }
    }

    // Continue with SuperTokens middleware
    middleware()(req, res, next);
  }

  /**
   * Check if this is a public route on a public domain.
   * If so, we should skip the 401 "try refresh token" response and let
   * the request continue to the controller, which will serve public content.
   *
   * @param req - The Express request object
   * @returns true if this is a public route that should bypass auth, false otherwise
   */
  private async isPublicRoute(req: Request): Promise<boolean> {
    const requestPath = req.originalUrl?.split('?')[0] || req.path;

    // Only check /public/* routes - other routes require auth
    if (!requestPath.startsWith('/public/')) {
      return false;
    }

    // Get the host from X-Forwarded-Host (set by nginx) or Host header
    const host =
      (req.headers['x-forwarded-host'] as string) || (req.headers['host'] as string) || '';

    // Strip port if present
    const domain = host.split(':')[0];

    if (!domain) {
      this.logger.debug('No domain found in request headers, treating as private');
      return false;
    }

    try {
      // Check if this domain is configured as public
      const accessControl = await this.visibilityService.resolveAccessControlByDomain(domain);

      if (accessControl === null) {
        // Domain not found in mappings - let the controller handle it
        // (could be primary domain, subdomain, or unknown)
        this.logger.debug(`Domain ${domain} not found in mappings, continuing to controller`);
        return true; // Let the request through, PublicController will handle visibility
      }

      if (accessControl.isPublic) {
        this.logger.debug(`Domain ${domain} is public, bypassing auth for ${requestPath}`);
        return true;
      }

      this.logger.debug(`Domain ${domain} is private, requiring auth for ${requestPath}`);
      return false;
    } catch (error) {
      // On error, be permissive and let the request through
      // The controller will handle the access control check
      this.logger.debug(`Error checking domain visibility: ${error}, continuing to controller`);
      return true;
    }
  }

  /**
   * The public-prefix shapes nginx rewrites an alias / subdomain host request into -
   * the same three `ProxyMiddleware` parses (`handleSubdomainAlias`, `parsePublicPath`).
   * Group 1 is the remainder: the app-level path.
   */
  private static readonly PUBLIC_PREFIX =
    /^\/public\/(?:subdomain-alias\/[^/]+|[^/]+\/[^/]+\/alias\/[^/]+|[^/]+\/[^/]+\/[^/]+)(\/.*)?$/;

  /**
   * The app-level path of a request that arrived rewritten under `/public/...`:
   * `X-Original-URI` (what the client asked for; every domain and wildcard server
   * block sets it), else the remainder after the public prefix - the precedence
   * `ProxyMiddleware` matches rules with. `null` when the request is not one.
   */
  private appPathBehindPublicPrefix(req: Request): string | null {
    const requestPath = req.originalUrl?.split('?')[0] || req.path;
    if (!requestPath.startsWith('/public/')) {
      return null;
    }
    const originalUri = req.headers['x-original-uri'];
    if (typeof originalUri === 'string' && originalUri) {
      return originalUri.split('?')[0];
    }
    const match = requestPath.match(AuthMiddleware.PUBLIC_PREFIX);
    return match ? match[1] || '/' : null;
  }

  /**
   * True when a `/public/...`-rewritten request is, at the app level, an auth
   * endpoint (`/api/auth`, `/api/auth/...`) - the only paths an auth proxy rule
   * (`ProxyMiddleware.isAuthProxyRule`) can match, so the only ones whose
   * expired-token verdict is deferred to it.
   */
  private isAuthPathBehindPublicPrefix(req: Request): boolean {
    const appPath = this.appPathBehindPublicPrefix(req);
    return appPath === '/api/auth' || appPath?.startsWith('/api/auth/') === true;
  }

  /**
   * Check if this is an auth-related endpoint that should skip token expiry checks.
   * These endpoints need to work even with expired tokens.
   */
  private isAuthEndpoint(path: string): boolean {
    // SuperTokens auth endpoints
    if (path.startsWith('/api/auth/')) {
      return true;
    }
    // Also skip for the auth path without /api prefix (if used)
    if (path.startsWith('/auth/')) {
      return true;
    }
    // Custom domain auth endpoints (used by bffless_access/bffless_refresh)
    if (path.startsWith('/_bffless/auth')) {
      return true;
    }
    return false;
  }
}
