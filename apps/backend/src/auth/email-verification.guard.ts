import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import EmailVerification from 'supertokens-node/recipe/emailverification';
import { RecipeUserId } from 'supertokens-node';
import { IS_PUBLIC_KEY } from './session-auth.guard';
import { SKIP_EMAIL_VERIFICATION_KEY } from './decorators/skip-email-verification.decorator';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/**
 * Global guard that enforces email verification when the feature flag is enabled.
 *
 * When no email provider is configured, SuperTokens logs the verification link
 * to the console as a fallback -- verification is still enforced.
 *
 * Runs after route-specific guards. Skips verification for:
 * - Public routes (@Public decorator)
 * - Routes with @SkipEmailVerification decorator
 * - Unauthenticated requests (no session)
 * - API key authenticated requests
 * - When feature flag ENABLE_EMAIL_VERIFICATION is disabled
 */
@Injectable()
export class EmailVerificationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Skip for routes with @SkipEmailVerification()
    const skipVerification = this.reflector.getAllAndOverride<boolean>(
      SKIP_EMAIL_VERIFICATION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipVerification) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { session?: any; user?: any }>();

    // Skip if no session (unauthenticated routes handled by other guards)
    if (!request.session) {
      return true;
    }

    // Skip for API key auth (CI/CD uploads shouldn't be blocked)
    if (request.user?.apiKeyId) {
      return true;
    }

    // Check if feature flag is enabled
    const isEnabled = await this.featureFlagsService.isEnabled('ENABLE_EMAIL_VERIFICATION');
    if (!isEnabled) {
      return true;
    }

    // Check email verification status
    try {
      const userId = request.session.getUserId();
      const recipeUserId = new RecipeUserId(userId);
      const isVerified = await EmailVerification.isEmailVerified(recipeUserId);

      if (isVerified) {
        return true;
      }

      // Email not verified - handle based on request type
      const response = context.switchToHttp().getResponse<Response>();
      if (this.isApiRequest(request)) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email address before accessing this resource.',
        });
      }

      // Browser request - redirect to verify-email page
      response.redirect(302, '/verify-email');
      throw new ForbiddenException('Redirected for email verification');
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // If SuperTokens call fails, don't block the user
      console.error('[EmailVerificationGuard] Error checking verification status:', error);
      return true;
    }
  }

  private isApiRequest(request: Request): boolean {
    const acceptHeader = request.headers.accept || '';
    const contentType = request.headers['content-type'] || '';

    if (acceptHeader.includes('application/json')) return true;
    if (contentType.includes('application/json')) return true;
    if (request.headers['x-requested-with'] === 'XMLHttpRequest') return true;
    if (request.headers['x-api-key']) return true;
    if (acceptHeader.startsWith('application/') && !acceptHeader.includes('text/html')) return true;

    return false;
  }
}
