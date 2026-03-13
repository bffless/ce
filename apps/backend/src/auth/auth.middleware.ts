import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { middleware } from 'supertokens-node/framework/express';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Auth middleware that wraps SuperTokens middleware with additional
 * expired token detection for better client-side handling.
 *
 * For API requests with expired access tokens, returns a 401 with
 * "session expired" message (no "unauthorised") so clients know to
 * attempt a token refresh before giving up.
 *
 * For browser requests, continues normally - guards will redirect to login.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Check for expired access token BEFORE SuperTokens middleware
    const accessToken = (req as any).cookies?.sAccessToken;

    if (accessToken) {
      try {
        // Decode JWT (SuperTokens exposes access token as JWT)
        // We just decode without verification - SuperTokens will verify later
        const decoded = jwt.decode(accessToken) as { exp?: number } | null;

        if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
          // Token is expired
          this.logger.debug(`Access token expired for ${req.method} ${req.path}`);

          // Set flag for downstream use
          (req as any).tokenExpired = true;

          // For API requests, return "try refresh" response immediately
          // This prevents unnecessary pipeline/controller execution
          if (this.isApiRequest(req)) {
            this.logger.debug('Returning session expired response for API request');
            return res.status(401).json({
              message: 'session expired',
              code: 'TRY_REFRESH_TOKEN',
            });
          }

          // For browser requests, continue - guards will handle redirect
        }
      } catch (error) {
        // Invalid token format - let SuperTokens middleware handle it
        this.logger.debug(`Failed to decode access token: ${error}`);
      }
    }

    // Continue with SuperTokens middleware
    middleware()(req, res, next);
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
