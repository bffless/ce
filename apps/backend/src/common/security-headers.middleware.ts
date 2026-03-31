import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * Sets default security headers on all responses.
 *
 * These headers were previously split between nginx (X-Frame-Options, etc.)
 * and Helmet (CSP frame-ancestors). Now consolidated here so they can be
 * made configurable per-project/per-route in the future.
 *
 * For /public/* routes (hosted user content), frame-related headers are skipped
 * so that hosted sites can control their own framing policy.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly frameAncestors: string[];

  private readonly isLocalDev: boolean;

  constructor(private readonly configService: ConfigService) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
    const adminDomain = this.configService.get<string>('ADMIN_DOMAIN') || '';
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN') || '';

    // In local dev, CSP frame-ancestors doesn't work with arbitrary ports
    // (e.g., frontend on :5173 iframing backend on :3000). Skip frame
    // restrictions entirely — same behavior as the old Helmet config.
    this.isLocalDev =
      frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1');

    // Build frame-ancestors list from environment
    const ancestors: string[] = ["'self'"];

    if (frontendUrl) {
      ancestors.push(frontendUrl);
    }
    if (adminDomain) {
      if (!adminDomain.startsWith('http')) {
        ancestors.push(`https://${adminDomain}`, `http://${adminDomain}`);
      } else {
        ancestors.push(adminDomain);
      }
    }
    if (primaryDomain) {
      ancestors.push(`https://*.${primaryDomain}`, `https://${primaryDomain}`);
    }

    this.frameAncestors = ancestors;
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Always set these baseline headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // For public routes (hosted user content), skip frame restrictions.
    // Hosted sites should control their own framing policy.
    const isPublicRoute = req.path.startsWith('/public');

    if (!isPublicRoute && !this.isLocalDev) {
      // Use CSP frame-ancestors instead of X-Frame-Options.
      // frame-ancestors supports multiple origins and is the modern standard.
      // X-Frame-Options is not set because CSP frame-ancestors supersedes it,
      // and X-Frame-Options doesn't support multiple origins.
      res.setHeader(
        'Content-Security-Policy',
        `frame-ancestors ${this.frameAncestors.join(' ')}`,
      );
    }

    next();
  }
}
