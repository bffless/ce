import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ProjectResolverService } from './project-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PUBLIC_PROJECT_ACCESS_KEY } from './decorators/public-project-access.decorator';

/**
 * Phase C: Defense-in-depth gate that prevents a user with a valid workspace
 * session from interacting with project-scoped data routes on a sister site
 * they have no membership in.
 *
 * Phase A blocks fresh signins by non-members. Phase B reports non-members as
 * `{ user: null }` from `/session` so the AuthDialog UI hides personalized
 * features. But the cookie is still valid: a malicious client could skip the
 * UI and POST directly to a data route. This guard closes that gap on every
 * route that authenticates a user, defaulting to deny when:
 *
 *   1. The workspace master switch `REQUIRE_PROJECT_MEMBERSHIP` is on,
 *   2. The request hostname resolves to a project (not the admin domain),
 *   3. A user is already attached to the request (an auth guard ran before
 *      this one and populated `req.user`),
 *   4. That user holds NO project_permissions row for the resolved project.
 *
 * Pass-through cases (return true without throwing):
 *   - Master switch off (legacy "any workspace user authenticates anywhere"
 *     behavior).
 *   - Route opted out via `@PublicProjectAccess()`.
 *   - No `req.user` — request is anonymous, or earlier auth guards rejected
 *     it. `OptionalAuthGuard` populates `req.user` only on successful auth;
 *     fully anonymous public requests are unaffected by this guard.
 *   - API-key authenticated requests (`req.user.apiKeyId`). API keys are
 *     CI/CD credentials minted by workspace admins; they are out of scope
 *     for the project-membership gate and `ApiKeyGuard` already enforces
 *     project scope when the key is project-scoped.
 *   - The hostname resolves to no project (admin domain, unknown hostname).
 *
 * Registered via `APP_GUARD` so every route is gated by default. Adding a new
 * authenticated route automatically inherits the check; routes that need to
 * bypass it must opt out explicitly with `@PublicProjectAccess()`.
 */
@Injectable()
export class ProjectMembershipGuard implements CanActivate {
  private readonly logger = new Logger(ProjectMembershipGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
    private readonly projectResolver: ProjectResolverService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_PROJECT_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!(await this.featureFlags.isEnabled('REQUIRE_PROJECT_MEMBERSHIP'))) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string; apiKeyId?: string } }>();

    const user = req.user;
    if (!user?.id) return true;
    if (user.apiKeyId) return true;

    const project = await this.projectResolver.resolveProjectFromRequest(req);
    if (!project) return true;

    const role = await this.permissions.getUserProjectRole(user.id, project.id);
    if (!role) {
      this.logger.debug(
        `Blocked: user ${user.id} has no membership on project ${project.id} (host: ${req.headers.host})`,
      );
      throw new ForbiddenException('You are not a member of this site');
    }

    return true;
  }
}
