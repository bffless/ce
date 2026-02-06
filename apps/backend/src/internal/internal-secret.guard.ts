import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * InternalSecretGuard
 *
 * Guards internal API endpoints for Control Plane → CE communication.
 * Validates X-Workspace-Secret header against WORKSPACE_SECRET env var.
 *
 * This allows the Control Plane to fetch user/org data from CE.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-workspace-secret'];
    const expectedSecret = this.config.get<string>('WORKSPACE_SECRET');

    // If no secret is configured, block all internal requests
    if (!expectedSecret) {
      throw new UnauthorizedException('WORKSPACE_SECRET not configured');
    }

    if (!secret || secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid workspace secret');
    }

    return true;
  }
}
