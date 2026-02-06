import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getSession } from 'supertokens-node/recipe/session';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { db } from '../db/client';
import { apiKeys, users } from '../db/schema';

/**
 * Optional authentication guard
 * Tries to authenticate via API key or session, but allows the request to continue
 * even if authentication fails. This is useful for endpoints that can work with
 * or without authentication (e.g., serving public assets or private assets with auth).
 *
 * If authentication succeeds, attaches user info to request.user
 * If authentication fails, request.user remains undefined
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const apiKey = request.headers['x-api-key'];

    // Try API key authentication first
    if (apiKey && typeof apiKey === 'string') {
      const authenticated = await this.tryApiKeyAuth(request, apiKey);
      if (authenticated) {
        return true; // Continue with authenticated user
      }
    }

    // Try session authentication
    const authenticated = await this.trySessionAuth(request, response);
    if (authenticated) {
      return true; // Continue with authenticated user
    }

    // No authentication succeeded, but continue anyway (request.user will be undefined)
    return true;
  }

  private async tryApiKeyAuth(request: any, apiKey: string): Promise<boolean> {
    try {
      // Get all API keys from database
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
        return false;
      }

      // Check if key has expired
      if (matchedKey.expiresAt && new Date() > new Date(matchedKey.expiresAt)) {
        return false;
      }

      // Update last used timestamp
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, matchedKey.id));

      // Phase 3H.7: allowedRepositories removed, use projectId instead
      // Attach user and API key info to request
      request.user = {
        id: matchedKey.userId,
        apiKeyId: matchedKey.id,
        projectId: matchedKey.projectId,
      };

      return true;
    } catch (error) {
      // Silently fail - this is optional auth
      return false;
    }
  }

  private async trySessionAuth(request: any, response: any): Promise<boolean> {
    try {
      // Get session using SuperTokens with sessionRequired: false
      // This will not throw or respond with 401 if session doesn't exist
      const session: SessionContainer | undefined = await getSession(request, response, {
        sessionRequired: false,
      });

      if (!session) {
        return false;
      }

      const userId = session.getUserId();

      // Get user from database to include role information
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!user) {
        return false;
      }

      // Attach user info to request for use in controllers
      request.user = {
        id: userId,
        sessionHandle: session.getHandle(),
        email: user.email,
        role: user.role,
        allowedRepositories: undefined, // Session users don't have repo restrictions
      };

      return true;
    } catch (error) {
      // Silently fail - this is optional auth
      return false;
    }
  }
}
