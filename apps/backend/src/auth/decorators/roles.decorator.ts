import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../roles.guard';

/**
 * Decorator to specify required roles for a route
 * Use with RolesGuard
 *
 * @example
 * @Roles('admin')
 * @Get('users')
 * getAllUsers() { ... }
 *
 * @example
 * @Roles('admin', 'moderator')
 * @Delete(':id')
 * deleteUser() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
