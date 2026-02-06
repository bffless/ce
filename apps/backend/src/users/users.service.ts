import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, like, and, asc, desc, count, SQL } from 'drizzle-orm';
import { listUsersByAccountInfo } from 'supertokens-node';
import { db } from '../db/client';
import { users, User } from '../db/schema';
import {
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  CreateUserDto,
  UserSortField,
  SortOrder,
  PaginatedUsersResponseDto,
  UserResponseDto,
} from './users.dto';

@Injectable()
export class UsersService {
  private readonly superTokensTenantId: string;

  constructor(private configService: ConfigService) {
    // Match tenant ID logic from supertokens.config.ts
    const isMultiTenant = this.configService.get<string>('SUPERTOKENS_MULTI_TENANT') === 'true';
    this.superTokensTenantId = isMultiTenant
      ? this.configService.get<string>('ORGANIZATION_ID') ||
        this.configService.get<string>('TENANT_ID') ||
        'public'
      : 'public';
  }
  /**
   * Get all users with pagination, filtering, and sorting
   */
  async findAll(query: ListUsersQueryDto): Promise<PaginatedUsersResponseDto> {
    const {
      page = 1,
      limit = 10,
      search,
      role,
      sortBy = UserSortField.CREATED_AT,
      sortOrder = SortOrder.DESC,
    } = query;

    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions: SQL<unknown>[] = [];

    if (search) {
      conditions.push(like(users.email, `%${search}%`));
    }

    if (role) {
      conditions.push(eq(users.role, role));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Build sort
    const sortColumn = this.getSortColumn(sortBy);
    const orderByClause = sortOrder === SortOrder.ASC ? asc(sortColumn) : desc(sortColumn);

    // Get total count
    const [countResult] = await db.select({ count: count() }).from(users).where(whereClause);

    const total = countResult?.count || 0;

    // Get paginated data
    const data = await db
      .select()
      .from(users)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map(this.toUserResponse),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get user by ID
   */
  async findById(id: string): Promise<UserResponseDto> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.toUserResponse(user);
  }

  /**
   * Get user by email (internal use, returns null if not found)
   */
  async findByEmail(email: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }

  /**
   * Get user by email (endpoint use, throws 404 if not found)
   */
  async findByEmailOrFail(email: string): Promise<UserResponseDto> {
    const user = await this.findByEmail(email);

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    return this.toUserResponse(user);
  }

  /**
   * Create a new user directly (admin only, bypasses invitation flow)
   * Requires the user to have a SuperTokens account.
   */
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    // Check if user already exists in workspace
    const existingUser = await this.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException(`User with email ${dto.email} already exists in this workspace`);
    }

    // Determine SuperTokens user ID
    let superTokensUserId = dto.superTokensId;

    if (!superTokensUserId) {
      // Look up user in SuperTokens by email
      try {
        const stUsers = await listUsersByAccountInfo(this.superTokensTenantId, {
          email: dto.email,
        });

        if (stUsers.length === 0) {
          throw new BadRequestException(
            `No SuperTokens account found for ${dto.email}. The user must sign up (create an account) before they can be added to this workspace.`,
          );
        }

        // Use the first matching user's ID
        superTokensUserId = stUsers[0].id;
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException(
          `Failed to look up SuperTokens account for ${dto.email}. Please try again or provide the superTokensId directly.`,
        );
      }
    }

    // Create the user in the workspace database
    const [newUser] = await db
      .insert(users)
      .values({
        id: superTokensUserId,
        email: dto.email,
        role: dto.role || 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return this.toUserResponse(newUser);
  }

  /**
   * Update user information
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    // Check if user exists
    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // If email is being updated, check for conflicts
    if (dto.email && dto.email !== existingUser.email) {
      const emailExists = await this.findByEmail(dto.email);
      if (emailExists) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: Partial<User> = {
      updatedAt: new Date(),
    };

    if (dto.email) {
      updateData.email = dto.email;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    return this.toUserResponse(updatedUser);
  }

  /**
   * Update user role (admin only)
   */
  async updateRole(id: string, dto: UpdateUserRoleDto): Promise<UserResponseDto> {
    // Check if user exists
    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        role: dto.role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    return this.toUserResponse(updatedUser);
  }

  /**
   * Enable or disable a user account
   */
  async setDisabled(
    id: string,
    disabled: boolean,
    disabledByUserId?: string,
  ): Promise<UserResponseDto> {
    // Check if user exists
    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Prevent disabling the last admin
    if (disabled && existingUser.role === 'admin') {
      const [adminCount] = await db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));

      if (adminCount?.count === 1) {
        throw new BadRequestException('Cannot disable the last active admin user');
      }
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        disabled,
        disabledAt: disabled ? new Date() : null,
        disabledBy: disabled ? disabledByUserId : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    return this.toUserResponse(updatedUser);
  }

  /**
   * Delete user by ID
   */
  async delete(id: string): Promise<void> {
    // Check if user exists
    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Check if this is the last admin
    if (existingUser.role === 'admin') {
      const [adminCount] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'admin'));

      if (adminCount?.count === 1) {
        throw new BadRequestException('Cannot delete the last admin user');
      }
    }

    await db.delete(users).where(eq(users.id, id));
  }

  /**
   * Check if user can be modified by the requester
   */
  canModifyUser(requesterId: string, requesterRole: string, targetUserId: string): boolean {
    // Admins can modify anyone
    if (requesterRole === 'admin') {
      return true;
    }
    // Users can only modify themselves
    return requesterId === targetUserId;
  }

  /**
   * Get the sort column based on the sort field
   */
  private getSortColumn(sortBy: UserSortField) {
    switch (sortBy) {
      case UserSortField.EMAIL:
        return users.email;
      case UserSortField.UPDATED_AT:
        return users.updatedAt;
      case UserSortField.CREATED_AT:
      default:
        return users.createdAt;
    }
  }

  /**
   * Convert User entity to UserResponseDto
   */
  private toUserResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      disabled: user.disabled,
      disabledAt: user.disabledAt,
      disabledBy: user.disabledBy,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
