import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getSession, SessionContainer } from 'supertokens-node/recipe/session';
import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { isApiRequest } from '../common/request-kind';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 401 body texts for a failed session check. These are the exact strings
 * SuperTokens' own error handler used to write (it answered these requests
 * itself before issue #775), and the frontend's `baseQueryWithReauth`
 * (apps/frontend/src/services/api.ts) keys on them: "unauthorised" means no
 * session at all (skip the refresh attempt, go to /login); anything else on a
 * 401 triggers a silent POST /api/auth/session/refresh and retry. Keep them.
 */
export const SESSION_401_NO_SESSION = 'unauthorised';
export const SESSION_401_TRY_REFRESH = 'try refresh token';

/**
 * Map a `getSession()` rejection to the 401 body SuperTokens would have sent.
 * A present-but-expired access token is `TRY_REFRESH_TOKEN` (the client should
 * refresh); every other failure (token theft, unparsable token, ...) is a plain
 * "unauthorised". Compared by string so specs can mock the session module.
 */
export function sessionErrorMessage(error: unknown): string {
  const type = (error as { type?: unknown } | null)?.type;
  return type === 'TRY_REFRESH_TOKEN' ? SESSION_401_TRY_REFRESH : SESSION_401_NO_SESSION;
}

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

    // Read the session with sessionRequired: false (same as OptionalAuthGuard).
    // The express verifySession() middleware must NOT be used here: on a missing
    // session it writes SuperTokens' own 401 and never calls back, so anything the
    // guard does afterwards is a second write (ERR_HTTP_HEADERS_SENT, issue #775).
    // getSession resolves undefined when there is no session and rejects for a
    // present-but-invalid token (TRY_REFRESH_TOKEN) - both take the failure path,
    // which owns the response (401 JSON or /login redirect).
    let session: SessionContainer | undefined;
    try {
      session = await getSession(request, response, { sessionRequired: false });
    } catch (error) {
      return this.handleAuthFailure(request, response, sessionErrorMessage(error));
    }

    if (!session) {
      return this.handleAuthFailure(request, response, SESSION_401_NO_SESSION);
    }

    // verifySession() used to set request.session as a side effect; getSession()
    // does not. Handlers (AuthController.getSession, SetupController) and the
    // global EmailVerificationGuard still read request.session, so restore it.
    (request as Request & { session?: SessionContainer }).session = session;

    try {
      const userId = session.getUserId();

      // Fetch user from database to get role
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      // Attach user info to request for use in controllers
      (
        request as Request & {
          user?: { id: string; sessionHandle: string; email?: string; role?: string };
        }
      ).user = {
        id: userId,
        sessionHandle: session.getHandle(),
        email: user?.email,
        role: user?.role,
      };

      return true;
    } catch {
      // User lookup failed - treated as an auth failure, as before
      return this.handleAuthFailure(request, response, 'Authentication required');
    }
  }

  /**
   * Handle authentication failure based on request type
   * - API requests: throw UnauthorizedException (returns 401 JSON with `message`)
   * - Browser navigations: redirect to /login?tryRefresh=true (frontend handles refresh)
   */
  private handleAuthFailure(request: Request, response: Response, message: string): never {
    // API requests should get a 401 JSON response, not a redirect
    if (isApiRequest(request)) {
      throw new UnauthorizedException(message);
    }

    // Browser request - redirect to login with tryRefresh param
    // Server can't reliably check for refresh token cookie due to cookie path restrictions
    // The frontend login page will attempt session refresh before showing the form
    // Never write over a response something upstream already sent - that turns an
    // auth failure into an ERR_HTTP_HEADERS_SENT 500. The exception filter skips
    // writing when headers are sent, so throwing is always safe.
    if (!response.headersSent) {
      const originalUrl = request.originalUrl || request.url || '/';
      const loginUrl = `/login?redirect=${encodeURIComponent(originalUrl)}&tryRefresh=true`;
      response.redirect(302, loginUrl);
    }

    // After redirect, throw to prevent further processing
    // This exception will be caught by NestJS but the response is already sent
    throw new UnauthorizedException('Redirected for authentication');
  }
}
