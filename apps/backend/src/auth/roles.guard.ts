import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';

export const ROLES_KEY = 'roles';

/**
 * Role-based access control guard
 * Checks if the authenticated user has the required role(s)
 * Use with @Roles() decorator
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get user from database to check role
    const dbUser = await this.authService.getUserById(user.id);

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    // Check if user has required role
    const hasRole = requiredRoles.some((role) => dbUser.role === role);

    if (!hasRole) {
      throw new ForbiddenException(`Access denied. Required roles: ${requiredRoles.join(', ')}`);
    }

    // Attach full user object to request
    request.user = {
      ...user,
      email: dbUser.email,
      role: dbUser.role,
    };

    return true;
  }
}
