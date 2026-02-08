import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { verifySession } from 'supertokens-node/recipe/session/framework/express';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { db } from '../db/client';
import { apiKeys, users } from '../db/schema';
import { IS_PUBLIC_KEY } from './session-auth.guard';

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

    // If no API key, fall back to session authentication
    if (!apiKey || typeof apiKey !== 'string') {
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
    try {
      // Verify session using SuperTokens
      await verifySession()(request, response, (err?: any) => {
        if (err) {
          throw new UnauthorizedException('Invalid or expired session');
        }
      });

      // Session is now available on request.session
      const session: SessionContainer = request.session;

      if (!session) {
        throw new UnauthorizedException('No active session');
      }

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
