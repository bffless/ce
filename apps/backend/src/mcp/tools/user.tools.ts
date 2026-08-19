import { Injectable, ForbiddenException } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { UserRole, UserSortField, ListUsersQueryDto } from '../../users/users.dto';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';

@Injectable()
export class UserTools {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'list_users',
    description: 'List all users with pagination and search. Requires admin role.',
    parameters: z.object({
      page: z.number().optional().describe('Page number (default 1)'),
      limit: z.number().optional().describe('Items per page (default 20)'),
      search: z.string().optional().describe('Search by email'),
      role: z.enum(['admin', 'user', 'member']).optional().describe('Filter by role'),
      sortBy: z.enum(['createdAt', 'updatedAt', 'email']).optional().describe('Sort field'),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  })
  async listUsers(
    args: {
      page?: number;
      limit?: number;
      search?: string;
      role?: 'admin' | 'user' | 'member';
      sortBy?: 'createdAt' | 'updatedAt' | 'email';
      sortOrder?: 'asc' | 'desc';
    },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    const result = await this.usersService.findAll(args as ListUsersQueryDto);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'get_user',
    description: 'Get user details by ID. Requires admin role.',
    parameters: z.object({
      id: z.string().describe('User ID'),
    }),
  })
  async getUser({ id }: { id: string }, _context: Context, request: Request) {
    const user = await getUserContext(request, this.authService);
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    const result = await this.usersService.findById(id);
    return JSON.stringify(result);
  }

  @Tool({
    name: 'update_user_role',
    description: "Update a user's role. Requires admin role.",
    parameters: z.object({
      id: z.string().describe('User ID'),
      role: z.enum(['admin', 'user']).describe('New role'),
    }),
  })
  async updateUserRole(
    args: { id: string; role: 'admin' | 'user' },
    _context: Context,
    request: Request,
  ) {
    const user = await getUserContext(request, this.authService);
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    const result = await this.usersService.updateRole(args.id, { role: args.role as UserRole });
    return JSON.stringify(result);
  }
}
