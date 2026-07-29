import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserGroupsService } from './user-groups.service';
import {
  GroupDirectoryResponseDto,
  MyGroupsResponseDto,
  SearchGroupDirectoryQueryDto,
} from './user-groups.dto';

interface CurrentUserData {
  id: string;
  email: string;
  role: string;
}

/**
 * Member-accessible group endpoints: directory search (for share-dialog
 * group pickers) and the current user's own memberships. Deliberately has
 * NO @Roles decorator — any authenticated session or API key can call
 * these, unlike UserGroupsController which is admin-only. Never returns
 * member lists or emails.
 */
@Controller('api/user-groups')
@UseGuards(ApiKeyGuard, RolesGuard)
@ApiTags('User Groups')
@ApiBearerAuth()
export class UserGroupsDirectoryController {
  constructor(private readonly userGroupsService: UserGroupsService) {}

  @Get('directory')
  @ApiOperation({
    summary: 'Search the group directory',
    description:
      'Group picker for share dialogs. Available to any authenticated user (session or ' +
      'API key) — NOT admin-only. Returns only id, name, and member count; never member ' +
      'lists or emails. A blank search lists all groups (capped).',
  })
  @ApiResponse({ status: 200, type: GroupDirectoryResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async searchDirectory(
    @Query() query: SearchGroupDirectoryQueryDto,
  ): Promise<GroupDirectoryResponseDto> {
    return this.userGroupsService.searchGroupDirectory(query.search, query.limit);
  }

  @Get('mine')
  @ApiOperation({
    summary: "List the current user's group memberships",
    description:
      'Strict memberships only (creating a group does not make you a member). Lets an app ' +
      'mirror server-side group access checks client-side.',
  })
  @ApiResponse({ status: 200, type: MyGroupsResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async myGroups(@CurrentUser() user: CurrentUserData): Promise<MyGroupsResponseDto> {
    return this.userGroupsService.getMyGroups(user.id);
  }
}
