import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { InternalSecretGuard } from './internal-secret.guard';
import { UsersService } from '../users/users.service';

/**
 * InternalController
 *
 * Internal API endpoints for Control Plane → CE communication.
 * Protected by InternalSecretGuard (X-Workspace-Secret header).
 *
 * These endpoints allow the Control Plane to fetch user data
 * without storing it locally.
 */
@ApiTags('Internal')
@Controller('api/internal')
@UseGuards(InternalSecretGuard)
@ApiHeader({
  name: 'X-Workspace-Secret',
  description: 'Per-workspace secret for Control Plane authentication',
  required: true,
})
export class InternalController {
  constructor(private usersService: UsersService) {}

  /**
   * Get user by ID
   * Called by Control Plane to fetch user details.
   */
  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID (internal)' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 401, description: 'Invalid internal secret' })
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  /**
   * Get organization by ID
   * Placeholder - organizations not yet implemented in CE.
   * Returns a mock response for now.
   */
  @Get('organizations/:id')
  @ApiOperation({ summary: 'Get organization by ID (internal)' })
  @ApiResponse({ status: 200, description: 'Organization found' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 401, description: 'Invalid internal secret' })
  async getOrganization(@Param('id') id: string) {
    // TODO: Implement when organizations are added to CE
    // For now, return a placeholder based on the org ID
    // In a real implementation, this would fetch from database

    // In multi-tenant mode, the org ID comes from ORGANIZATION_ID env var
    const orgId = process.env.ORGANIZATION_ID || process.env.TENANT_ID || 'public';

    if (id !== orgId && id !== 'public') {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return {
      id: orgId,
      name: orgId === 'public' ? 'Default Organization' : orgId,
      slug: orgId,
    };
  }
}
