import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  id: string;
  email?: string;
  role?: string;
  sessionHandle?: string;
  apiKeyId?: string;
  // Phase 3H.6: Removed allowedRepositories - use project permissions instead
}

/**
 * Decorator to get the current authenticated user from the request
 * Works with both session-based auth and API key auth
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: CurrentUserData) {
 *   return user;
 * }
 *
 * @example
 * // Get specific property
 * @Get('profile')
 * getProfile(@CurrentUser('email') email: string) {
 *   return { email };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
