import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserGroupsService } from './user-groups.service';
import {
  CreateGroupDto,
  UpdateGroupDto,
  AddMemberDto,
  GroupResponseDto,
  GroupListResponseDto,
  GroupDetailResponseDto,
  GroupMemberDto,
} from './user-groups.dto';

interface CurrentUserData {
  id: string;
  email: string;
  role: string;
}

@Controller('api/user-groups')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
@ApiTags('User Groups')
@ApiBearerAuth()
export class UserGroupsController {
  constructor(private readonly userGroupsService: UserGroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user group' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User group created successfully',
    type: GroupResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async createGroup(
    @Body() dto: CreateGroupDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<GroupResponseDto> {
    const group = await this.userGroupsService.createGroup(
      dto.name,
      dto.description ?? null,
      user.id,
    );

    return group;
  }

  @Get()
  @ApiOperation({ summary: 'List all groups user belongs to or created' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of user groups',
    type: GroupListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async listGroups(@CurrentUser() user: CurrentUserData): Promise<GroupListResponseDto> {
    const groups = await this.userGroupsService.listUserGroups(user.id);

    return { groups };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group details with members' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Group details with members',
    type: GroupDetailResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async getGroup(@Param('id') id: string): Promise<GroupDetailResponseDto> {
    const group = await this.userGroupsService.getGroup(id);

    return group;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update group name or description' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Group updated successfully',
    type: GroupResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only the group creator can update the group',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<GroupResponseDto> {
    const group = await this.userGroupsService.updateGroup(id, dto, user.id);

    return group;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user group' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Group deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only the group creator can delete the group',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async deleteGroup(@Param('id') id: string, @CurrentUser() user: CurrentUserData): Promise<void> {
    await this.userGroupsService.deleteGroup(id, user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to a group' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Member added successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group or user not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only the group creator can add members',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User is already a member of this group',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.userGroupsService.addMember(id, dto.userId, user.id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from a group' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID of the user to remove',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Member removed successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group or member not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only the group creator can remove members',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    await this.userGroupsService.removeMember(id, userId, user.id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get all members of a group' })
  @ApiParam({
    name: 'id',
    description: 'UUID of the user group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of group members',
    type: [GroupMemberDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Group not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - session required',
  })
  async getGroupMembers(@Param('id') id: string): Promise<GroupMemberDto[]> {
    const members = await this.userGroupsService.getGroupMembers(id);

    return members;
  }
}
