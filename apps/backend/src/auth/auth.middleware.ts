import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { middleware } from 'supertokens-node/framework/express';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

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
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
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
          // This prevents unnecessary pipeline/controller execution
          // Uses SuperTokens response format for consistency
          if (this.isApiRequest(req)) {
            this.logger.debug('Returning try refresh token response for API request');
            return res.status(401).json({
              message: 'try refresh token',
            });
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
}
