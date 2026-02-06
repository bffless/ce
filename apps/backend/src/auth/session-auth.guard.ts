import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifySession } from 'supertokens-node/recipe/session/framework/express';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { Request, Response } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Session-based authentication guard using SuperTokens
 * Verifies that a valid session exists for the request
 *
 * For browser requests with invalid sessions:
 * - Redirects to /login?tryRefresh=true - the frontend handles session refresh
 *
 * For API requests (JSON): returns 401 Unauthorized
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    try {
      // Verify session using SuperTokens
      await verifySession()(request, response, (err) => {
        if (err) {
          throw new UnauthorizedException('Invalid or expired session');
        }
      });

      // Session is now available on request.session
      const session = (request as Request & { session?: SessionContainer }).session;

      if (!session) {
        throw new UnauthorizedException('No active session');
      }

      // Attach user info to request for use in controllers
      (request as Request & { user?: { id: string; sessionHandle: string } }).user = {
        id: session.getUserId(),
        sessionHandle: session.getHandle(),
      };

      return true;
    } catch {
      // Session validation failed - handle based on request type
      return this.handleAuthFailure(request, response);
    }
  }

  /**
   * Handle authentication failure based on request type
   * - API requests: throw UnauthorizedException (returns 401 JSON)
   * - Browser requests: redirect to /login?tryRefresh=true (frontend handles refresh)
   */
  private handleAuthFailure(request: Request, response: Response): never {
    // API requests should get a 401 JSON response, not a redirect
    if (this.isApiRequest(request)) {
      throw new UnauthorizedException('Authentication required');
    }

    // Browser request - redirect to login with tryRefresh param
    // Server can't reliably check for refresh token cookie due to cookie path restrictions
    // The frontend login page will attempt session refresh before showing the form
    const originalUrl = request.originalUrl || request.url || '/';
    const loginUrl = `/login?redirect=${encodeURIComponent(originalUrl)}&tryRefresh=true`;
    response.redirect(302, loginUrl);

    // After redirect, throw to prevent further processing
    // This exception will be caught by NestJS but the response is already sent
    throw new UnauthorizedException('Redirected for authentication');
  }

  /**
   * Determines if this is an API request (expects JSON response)
   * vs a browser request (can handle redirects)
   */
  private isApiRequest(request: Request): boolean {
    const acceptHeader = request.headers.accept || '';
    const contentType = request.headers['content-type'] || '';

    // XHR/fetch requests typically want JSON
    if (acceptHeader.includes('application/json')) {
      return true;
    }

    // Requests sending JSON are likely API calls
    if (contentType.includes('application/json')) {
      return true;
    }

    // X-Requested-With header indicates AJAX
    if (request.headers['x-requested-with'] === 'XMLHttpRequest') {
      return true;
    }

    // API key header indicates programmatic access
    if (request.headers['x-api-key']) {
      return true;
    }

    // Accept header starts with application/* (not text/html) suggests API client
    // Note: Browsers typically send Accept: text/html,application/xhtml+xml,... first
    if (acceptHeader.startsWith('application/') && !acceptHeader.includes('text/html')) {
      return true;
    }

    // Default: treat as browser request (can handle redirects)
    return false;
  }
}
