import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Request } from 'express';
import { getUser } from 'supertokens-node';
import { InvitationsService } from './invitations.service.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator.js';
import { SetupService } from '../setup/setup.service.js';
import {
  CreateInvitationDto,
  ListInvitationsQueryDto,
  CreateInvitationResponseDto,
  ListInvitationsResponseDto,
  DeleteInvitationResponseDto,
  ValidateInvitationResponseDto,
  AcceptInvitationResponseDto,
  InvitationResponseDto,
} from './invitations.dto.js';

@ApiTags('Invitations')
@Controller('api')
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly setupService: SetupService,
  ) {}

  /**
   * Helper to get base URL from request
   */
  private getBaseUrl(req: Request): string {
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host || 'localhost';

    // Force https for non-localhost domains (production behind SSL-terminating proxy)
    // Only allow http for local development
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    let protocol: string;
    if (isLocalhost) {
      const forwardedProto = req.headers['x-forwarded-proto'];
      protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || 'http';
    } else {
      protocol = 'https';
    }

    return `${protocol}://${host}`;
  }

  // ============================================================================
  // Admin Endpoints (require authentication and admin role)
  // ============================================================================

  @Post('admin/invitations')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create invitation',
    description: 'Create a new invitation for a user. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation created successfully',
    type: CreateInvitationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Registration is disabled' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 409, description: 'User already exists or pending invitation exists' })
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ): Promise<CreateInvitationResponseDto> {
    // Check if registration feature flag is enabled (circuit breaker)
    if (!(await this.setupService.isRegistrationFeatureEnabled())) {
      throw new BadRequestException(
        'User registration is currently disabled. Invitations cannot be sent.',
      );
    }

    const invitation = await this.invitationsService.create(dto, user.id, this.getBaseUrl(req));

    return {
      message: 'Invitation created successfully',
      invitation,
    };
  }

  @Get('admin/invitations')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List invitations',
    description: 'Get a list of all invitations. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitations retrieved successfully',
    type: ListInvitationsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  async findAll(@Query() query: ListInvitationsQueryDto): Promise<ListInvitationsResponseDto> {
    const invitations = await this.invitationsService.findAll(query);
    return { invitations };
  }

  @Get('admin/invitations/:id')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get invitation by ID',
    description: 'Get invitation details by ID. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Invitation retrieved successfully',
    type: InvitationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<InvitationResponseDto> {
    return this.invitationsService.findById(id);
  }

  @Post('admin/invitations/:id/resend')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend invitation',
    description: 'Generate a new token and extend expiration. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Invitation resent successfully',
    type: CreateInvitationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Registration is disabled or cannot resend accepted invitation' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<CreateInvitationResponseDto> {
    // Check if registration feature flag is enabled (circuit breaker)
    if (!(await this.setupService.isRegistrationFeatureEnabled())) {
      throw new BadRequestException(
        'User registration is currently disabled. Invitations cannot be resent.',
      );
    }

    const invitation = await this.invitationsService.resend(id, 168, this.getBaseUrl(req));
    return {
      message: 'Invitation resent successfully',
      invitation,
    };
  }

  @Delete('admin/invitations/:id')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete invitation',
    description: 'Delete an invitation. Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Invitation deleted successfully',
    type: DeleteInvitationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Access denied - Admin only' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<DeleteInvitationResponseDto> {
    await this.invitationsService.delete(id);
    return {
      message: 'Invitation deleted successfully',
      invitationId: id,
    };
  }

  // ============================================================================
  // Public Endpoints (for invitation acceptance flow)
  // ============================================================================

  @Get('invitations/:token')
  @ApiOperation({
    summary: 'Validate invitation token',
    description:
      'Check if an invitation token is valid. Public endpoint used by the invite accept page.',
  })
  @ApiParam({ name: 'token', description: 'Invitation token', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Validation result',
    type: ValidateInvitationResponseDto,
  })
  async validateToken(@Param('token') token: string): Promise<ValidateInvitationResponseDto> {
    return this.invitationsService.validateToken(token);
  }

  @Post('invitations/:token/accept')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept invitation',
    description:
      'Accept an invitation and join the workspace. Requires authentication. The authenticated user must match the invited email.',
  })
  @ApiParam({ name: 'token', description: 'Invitation token', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted successfully',
    type: AcceptInvitationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Registration is disabled, invalid invitation, or email mismatch' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  @ApiResponse({ status: 409, description: 'Already a member of this workspace' })
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AcceptInvitationResponseDto> {
    // Check if registration feature flag is enabled (circuit breaker)
    if (!(await this.setupService.isRegistrationFeatureEnabled())) {
      throw new BadRequestException(
        'User registration is currently disabled. Invitations cannot be accepted.',
      );
    }

    // Get email from SuperTokens since user may not be in workspace's users table yet
    let email = user.email;
    if (!email) {
      const stUser = await getUser(user.id);
      if (stUser && stUser.emails && stUser.emails.length > 0) {
        email = stUser.emails[0];
      }
    }

    if (!email) {
      throw new BadRequestException('Unable to determine user email from session');
    }

    const newUser = await this.invitationsService.accept(token, user.id, email);

    return {
      message: 'Invitation accepted successfully. You are now a member of this workspace.',
      user: newUser,
    };
  }
}
