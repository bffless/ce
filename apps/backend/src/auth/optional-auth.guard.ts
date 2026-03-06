import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getSession } from 'supertokens-node/recipe/session';
import { SessionContainer } from 'supertokens-node/recipe/session';
import { db } from '../db/client';
import { apiKeys, users } from '../db/schema';
import { CustomDomainAuthService } from './custom-domain-auth.service';

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
  private readonly logger = new Logger(OptionalAuthGuard.name);
  private customDomainAuthService: CustomDomainAuthService | null = null;

  constructor() {
    // Lazy-load CustomDomainAuthService to avoid circular dependency issues
    // The service will be created on first use
  }

  private getCustomDomainAuthService(): CustomDomainAuthService | null {
    if (!this.customDomainAuthService) {
      try {
        // Import dynamically to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { CustomDomainAuthService } = require('./custom-domain-auth.service');
        const { ConfigService } = require('@nestjs/config');
        // Create a minimal ConfigService for JWT_SECRET access
        const configService = {
          get: (key: string) => process.env[key],
        } as any;
        this.customDomainAuthService = new CustomDomainAuthService(configService);
      } catch (error) {
        this.logger.debug('CustomDomainAuthService not available');
        return null;
      }
    }
    return this.customDomainAuthService;
  }

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
    const sessionAuthenticated = await this.trySessionAuth(request, response);
    if (sessionAuthenticated) {
      return true; // Continue with authenticated user
    }

    // Try custom domain cookie authentication
    const customDomainAuthenticated = await this.tryCustomDomainAuth(request);
    if (customDomainAuthenticated) {
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

  /**
   * Try to authenticate via custom domain cookies (bffless_access).
   * This is used for custom domains that have their own JWT-based auth
   * instead of SuperTokens session cookies.
   */
  private async tryCustomDomainAuth(request: any): Promise<boolean> {
    try {
      const accessToken = request.cookies?.[CustomDomainAuthService.ACCESS_COOKIE_NAME];
      if (!accessToken) {
        return false;
      }

      const authService = this.getCustomDomainAuthService();
      if (!authService) {
        return false;
      }

      const payload = authService.validateAccessToken(accessToken);
      if (!payload) {
        return false;
      }

      // Verify the domain matches the request
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const requestDomain = host?.split(':')[0]; // Remove port if present

      if (payload.domain !== requestDomain) {
        this.logger.debug(
          `Custom domain auth: domain mismatch (token: ${payload.domain}, request: ${requestDomain})`,
        );
        return false;
      }

      // Verify user still exists in the database
      const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);

      if (!user) {
        this.logger.debug(`Custom domain auth: user ${payload.sub} not found`);
        return false;
      }

      // Check if user is disabled
      if (user.disabled) {
        this.logger.debug(`Custom domain auth: user ${payload.sub} is disabled`);
        return false;
      }

      // Attach user info to request for use in controllers
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        allowedRepositories: undefined, // Custom domain users don't have repo restrictions
      };

      this.logger.debug(`Custom domain auth: authenticated user ${payload.sub} on domain ${payload.domain}`);
      return true;
    } catch (error) {
      // Silently fail - this is optional auth
      this.logger.debug('Custom domain auth failed', error);
      return false;
    }
  }
}
