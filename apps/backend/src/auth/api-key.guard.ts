import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getSession, SessionContainer } from 'supertokens-node/recipe/session';
import { db } from '../db/client';
import { apiKeys, users } from '../db/schema';
import { IS_PUBLIC_KEY, SESSION_401_NO_SESSION, sessionErrorMessage } from './session-auth.guard';
import { requestUserFromAppToken, resolveAppToken } from './app-token.util';

/**
 * API Key authentication guard with session fallback
 * Used for GitHub Actions and other programmatic access via X-API-Key header
 * Falls back to session authentication if no API key is present
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
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

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const apiKey = request.headers['x-api-key'];

    // If no API key, try a Bearer app token, then fall back to session authentication.
    // A token is a project-fenced pseudo-key here (role pinned as keys are, never
    // elevated) — see app-token.util `requestUserFromAppToken`. Any other bearer
    // falls through exactly as before.
    if (!apiKey || typeof apiKey !== 'string') {
      const resolved = await resolveAppToken(request.headers.authorization);
      if (resolved) {
        request.user = requestUserFromAppToken(resolved, { pinRoleLikeApiKey: true });
        return true;
      }
      return this.validateSession(request, response);
    }

    try {
      // Get all API keys from database
      // Note: In production, consider adding an index or caching for performance
      const allKeys = await db.select().from(apiKeys);

      // Find matching key by comparing hashed values
      let matchedKey: (typeof allKeys)[0] | null = null;
      for (const keyRecord of allKeys) {
        const isMatch = await bcrypt.compare(apiKey, keyRecord.key);
        if (isMatch) {
          matchedKey = keyRecord;
          break;
        }
      }

      if (!matchedKey) {
        throw new UnauthorizedException('Invalid API key');
      }

      // Check if key has expired
      if (matchedKey.expiresAt && new Date() > new Date(matchedKey.expiresAt)) {
        throw new UnauthorizedException('API key has expired');
      }

      // Update last used timestamp
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, matchedKey.id));

      // Phase 3H.6: Attach user and API key info to request
      // API keys default to 'user' role (permissions checked via ProjectPermissionGuard)
      request.user = {
        id: matchedKey.userId,
        apiKeyId: matchedKey.id,
        apiKeyProjectId: matchedKey.projectId, // null for global keys
        role: 'user', // API key users default role
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private async validateSession(request: any, response: any): Promise<boolean> {
    // Read the session with sessionRequired: false (same as OptionalAuthGuard).
    // The express verifySession() middleware must NOT be used here: on a missing
    // session it writes SuperTokens' own 401 and never calls back, so the guard's
    // own throw becomes a second write (ERR_HTTP_HEADERS_SENT, issue #775).
    // The 401 body texts mirror what SuperTokens used to write; the frontend's
    // silent-refresh flow keys on them (see session-auth.guard.ts).
    let session: SessionContainer | undefined;
    try {
      session = await getSession(request, response, { sessionRequired: false });
    } catch (error) {
      throw new UnauthorizedException(sessionErrorMessage(error));
    }

    if (!session) {
      throw new UnauthorizedException(SESSION_401_NO_SESSION);
    }

    // verifySession() used to set request.session as a side effect; getSession()
    // does not. The global EmailVerificationGuard and session handlers still read
    // request.session, so restore it.
    request.session = session;

    try {
      const userId = session.getUserId();

      // Get user from database to include role information
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      // Phase 3H.6: Attach user info to request for use in controllers
      request.user = {
        id: userId,
        sessionHandle: session.getHandle(),
        email: user?.email,
        role: user?.role,
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Authentication required');
    }
  }
}
