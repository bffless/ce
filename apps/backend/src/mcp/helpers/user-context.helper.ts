import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';

export interface McpUserContext {
  id: string;
  role: string;
  /**
   * Project scope from the authenticating API key.
   * - `undefined`: session auth, no api-key context
   * - `null`: global (unscoped) api-key
   * - string: api-key restricted to this project id
   */
  apiKeyProjectId?: string | null;
}

/**
 * Extract user from the HTTP request and look up actual DB role.
 * ApiKeyGuard hardcodes role as 'user' (api-key.guard.ts:73),
 * so we fetch the real role from DB (same pattern as RolesGuard).
 */
export async function getUserContext(
  request: any,
  authService: AuthService,
): Promise<McpUserContext> {
  const user = request?.user;
  if (!user?.id) {
    throw new UnauthorizedException('No authenticated user found');
  }

  // Look up the real role from DB since API key auth hardcodes 'user'
  const dbUser = await authService.getUserById(user.id);
  if (!dbUser) {
    throw new UnauthorizedException('User not found');
  }

  return {
    id: dbUser.id,
    role: dbUser.role,
    apiKeyProjectId: user.apiKeyProjectId,
  };
}
