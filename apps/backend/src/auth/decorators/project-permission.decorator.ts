import { SetMetadata } from '@nestjs/common';

export const PROJECT_ROLE_KEY = 'projectRole';
export const ALLOW_PUBLIC_ACCESS_KEY = 'allowPublicAccess';

/**
 * Decorator to specify required project role for a route
 * Use with ProjectPermissionGuard
 *
 * @example
 * @RequireProjectRole('viewer')
 * @Get(':owner/:repo')
 * getRepository() { ... }
 *
 * @example
 * @RequireProjectRole('contributor')
 * @Post(':owner/:repo/deployments')
 * createDeployment() { ... }
 */
export const RequireProjectRole = (role: 'owner' | 'admin' | 'contributor' | 'viewer') =>
  SetMetadata(PROJECT_ROLE_KEY, role);

/**
 * Decorator to allow public access to a route if project is public
 * Use with ProjectPermissionGuard for read-only endpoints
 *
 * @example
 * @AllowPublicAccess()
 * @RequireProjectRole('viewer')
 * @Get(':owner/:repo/files')
 * browseFiles() { ... }
 */
export const AllowPublicAccess = () => SetMetadata(ALLOW_PUBLIC_ACCESS_KEY, true);
