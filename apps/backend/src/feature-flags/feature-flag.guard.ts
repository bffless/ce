import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Metadata key for required feature flags
 */
export const REQUIRED_FLAGS_KEY = 'requiredFeatureFlags';

/**
 * Decorator to require specific feature flags for a route
 *
 * @example
 * ```typescript
 * @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
 * @Post('ssl/wildcard/request')
 * async requestWildcardCertificate() { ... }
 * ```
 */
export const RequireFeatureFlags = (...flags: string[]) => SetMetadata(REQUIRED_FLAGS_KEY, flags);

/**
 * Guard that checks if required feature flags are enabled.
 * Returns 403 Forbidden if any required flag is disabled.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFlags = this.reflector.getAllAndOverride<string[]>(REQUIRED_FLAGS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No flags required, allow access
    if (!requiredFlags || requiredFlags.length === 0) {
      return true;
    }

    // Check all required flags
    for (const flag of requiredFlags) {
      const isEnabled = await this.featureFlagsService.isEnabled(flag);
      if (!isEnabled) {
        throw new ForbiddenException(`This feature is disabled. Required feature flag: ${flag}`);
      }
    }

    return true;
  }
}
