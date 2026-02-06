import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  ListUsersQueryDto,
  CreateUserDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  UserResponseDto,
  PaginatedUsersResponseDto,
  CreateUserResponseDto,
  UpdateUserResponseDto,
  DeleteUserResponseDto,
} from './users.dto';

@ApiTags('Users')
@Controller('api/users')
@UseGuards(SessionAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({
    summary: 'List all users',
    description: 'Get a paginated list of all users. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: PaginatedUsersResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  async findAll(@Query() query: ListUsersQueryDto): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findAll(query);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Get the profile of the currently authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getCurrentUser(@CurrentUser() user: CurrentUserData): Promise<UserResponseDto> {
    return this.usersService.findById(user.id);
  }

  @Get('by-email/:email')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get user by email',
    description: 'Look up a user by their email address. Admin only. Useful for Console UI validation.',
  })
  @ApiParam({ name: 'email', description: 'User email address', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findByEmail(@Param('email') email: string): Promise<UserResponseDto> {
    return this.usersService.findByEmailOrFail(email);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create user directly',
    description:
      'Create a user in this workspace directly (bypasses invitation flow). ' +
      'The user must have an existing SuperTokens account. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: CreateUserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'User has no SuperTokens account' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 409, description: 'User already exists in this workspace' })
  async create(@Body() dto: CreateUserDto): Promise<CreateUserResponseDto> {
    const user = await this.usersService.create(dto);

    return {
      message: 'User created successfully',
      user,
    };
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Get user details by ID. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findById(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update user',
    description:
      'Update user information. Admin can update any user. Regular users can only update themselves.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UpdateUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<UpdateUserResponseDto> {
    // Check if user can modify this user
    if (!this.usersService.canModifyUser(user.id, user.role || 'user', id)) {
      throw new ForbiddenException('You do not have permission to update this user');
    }

    const updatedUser = await this.usersService.update(id, dto);

    return {
      message: 'User updated successfully',
      user: updatedUser,
    };
  }

  @Put(':id/role')
  @Roles('admin')
  @ApiOperation({
    summary: 'Update user role',
    description: 'Update the role of a user. Admin only. Cannot change your own role.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User role updated successfully',
    type: UpdateUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only or self-modification' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() currentUser: CurrentUserData,
  ): Promise<UpdateUserResponseDto> {
    // Prevent admins from changing their own role (could lock themselves out)
    if (id === currentUser.id) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const updatedUser = await this.usersService.updateRole(id, dto);

    return {
      message: 'User role updated successfully',
      user: updatedUser,
    };
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete user',
    description: 'Delete a user by ID. Admin only. Cannot delete the last admin.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully',
    type: DeleteUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 400, description: 'Cannot delete the last admin user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<DeleteUserResponseDto> {
    await this.usersService.delete(id);

    return {
      message: 'User deleted successfully',
      userId: id,
    };
  }

  @Post(':id/disable')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable user account',
    description: 'Disable a user account. Admin only. Cannot disable the last active admin.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User disabled successfully',
    type: UpdateUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 400, description: 'Cannot disable the last active admin user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async disableUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: CurrentUserData,
  ): Promise<UpdateUserResponseDto> {
    const updatedUser = await this.usersService.setDisabled(id, true, currentUser.id);

    return {
      message: 'User account disabled successfully',
      user: updatedUser,
    };
  }

  @Post(':id/enable')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enable user account',
    description: 'Enable a disabled user account. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User enabled successfully',
    type: UpdateUserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async enableUser(@Param('id', ParseUUIDPipe) id: string): Promise<UpdateUserResponseDto> {
    const updatedUser = await this.usersService.setDisabled(id, false);

    return {
      message: 'User account enabled successfully',
      user: updatedUser,
    };
  }
}
