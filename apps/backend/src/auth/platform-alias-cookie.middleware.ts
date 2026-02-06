import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * Platform Alias Cookie Middleware
 *
 * Handles cookie domain rewriting for platform aliases.
 *
 * In PaaS mode, workspaces can have platform aliases (e.g., console.sahp.app)
 * that point to the full workspace hostname (e.g., console.workspace.sahp.app).
 *
 * Problem: SuperTokens sets cookies with Domain=.console.workspace.sahp.app
 * Solution: When request comes from console.sahp.app, rewrite to Domain=console.sahp.app
 *
 * Session behavior:
 * - console.workspace.sahp.app         → Session A (cookie domain: .console.workspace.sahp.app)
 * - admin.console.workspace.sahp.app   → Session A (shared via wildcard)
 * - console.sahp.app (alias)           → Session B (cookie domain: console.sahp.app)
 *
 * Configuration:
 * - PLATFORM_ALIAS_DOMAIN: The alias domain for this workspace (e.g., console.sahp.app)
 */
@Injectable()
export class PlatformAliasCookieMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PlatformAliasCookieMiddleware.name);
  private readonly aliasDomain: string | undefined;

  constructor(private configService: ConfigService) {
    this.aliasDomain = this.configService.get<string>('PLATFORM_ALIAS_DOMAIN');
    if (this.aliasDomain) {
      this.logger.log(`Platform alias cookie middleware enabled for: ${this.aliasDomain}`);
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Only apply if this workspace has a platform alias configured
    if (!this.aliasDomain) {
      return next();
    }

    const host = req.headers.host || '';

    // Check if request is from the platform alias (with or without port)
    const isFromAlias = host === this.aliasDomain || host.startsWith(`${this.aliasDomain}:`);

    if (isFromAlias) {
      // Intercept setHeader to rewrite Set-Cookie headers
      const originalSetHeader = res.setHeader.bind(res);

      res.setHeader = (name: string, value: string | number | readonly string[]): Response => {
        if (name.toLowerCase() === 'set-cookie') {
          const rewrite = (cookie: string): string => {
            // Remove existing Domain attribute and set to alias domain
            const withoutDomain = cookie.replace(/;\s*Domain=[^;]*/gi, '');
            return `${withoutDomain}; Domain=${this.aliasDomain}`;
          };

          if (Array.isArray(value)) {
            value = value.map(rewrite);
          } else if (typeof value === 'string') {
            value = rewrite(value);
          }
        }
        return originalSetHeader(name, value);
      };
    }

    next();
  }
}
