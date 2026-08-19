import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentUserData } from '../auth';
import { PublicProjectAccess } from '../auth/decorators/public-project-access.decorator';
import { MyProjectMembership, PermissionsService } from '../permissions/permissions.service';

/**
 * Cross-project endpoints for the signed-in user. Lives at `/api/me/*` and
 * is the backend for the central "My Sites" account hub at
 * `admin.sites.bffless.app/account` (Phase D of the project-membership-gated
 * auth story).
 *
 * Routes here are inherently cross-project — a user's full membership list
 * spans every project they belong to — so they bypass the global
 * `ProjectMembershipGuard` via `@PublicProjectAccess()`. Authentication is
 * still required (`SessionAuthGuard`); the bypass is for project-membership
 * scoping, not auth.
 */
@ApiTags('Me')
@Controller('api/me')
@UseGuards(SessionAuthGuard)
@PublicProjectAccess()
@ApiBearerAuth()
export class MeController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('projects')
  @ApiOperation({
    summary: 'List the authenticated user’s project memberships',
    description:
      'Returns one entry per project the user is a member of, with display name, primary URL, role, joined-at, and owner email. Used by the "My Sites" admin hub.',
  })
  @ApiResponse({ status: 200, description: 'Memberships listed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listMyProjects(@CurrentUser() user: CurrentUserData): Promise<MyProjectMembership[]> {
    return this.permissions.listUserProjectMemberships(user.id);
  }

  @Delete('projects/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Leave a project the user is a member of',
    description:
      'Self-serve removal of the caller’s own membership on the given project. Owners cannot leave a project they own — they must transfer ownership first. Returns 404 if the user is not a member of the project.',
  })
  @ApiResponse({ status: 204, description: 'Membership revoked' })
  @ApiResponse({ status: 400, description: 'Cannot leave a project you own' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not a member of this project' })
  async leaveProject(
    @CurrentUser() user: CurrentUserData,
    @Param('projectId') projectId: string,
  ): Promise<void> {
    try {
      await this.permissions.revokeSystemPermission(projectId, user.id);
    } catch (err) {
      // Reframe the generic owner-block as a user-actionable 400, leaving the
      // 404 (no membership) path untouched.
      if (err instanceof ForbiddenException) {
        throw new BadRequestException('You cannot leave a site you own. Transfer ownership first.');
      }
      if (err instanceof NotFoundException) {
        throw new NotFoundException('You are not a member of this site');
      }
      throw err;
    }
  }
}
