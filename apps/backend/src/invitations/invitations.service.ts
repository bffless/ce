import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, gt, SQL } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '../db/client.js';
import { workspaceInvitations, WorkspaceInvitation, users } from '../db/schema/index.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailService } from '../email/email.service.js';
import {
  CreateInvitationDto,
  ListInvitationsQueryDto,
  InvitationResponseDto,
  InvitationRole,
} from './invitations.dto.js';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Generate a secure random token for invitation links
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Calculate expiration date from hours
   */
  private calculateExpiration(hours: number): Date {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);
    return expiresAt;
  }

  /**
   * Check if an invitation is expired
   */
  private isExpired(invitation: WorkspaceInvitation): boolean {
    return new Date() > invitation.expiresAt;
  }

  /**
   * Convert invitation entity to response DTO
   */
  private toResponse(
    invitation: WorkspaceInvitation,
    options: { includeToken?: boolean; baseUrl?: string } = {},
  ): InvitationResponseDto {
    const response: InvitationResponseDto = {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invitedBy || undefined,
      expiresAt: invitation.expiresAt,
      isExpired: this.isExpired(invitation),
      acceptedAt: invitation.acceptedAt || undefined,
      acceptedUserId: invitation.acceptedUserId || undefined,
      createdAt: invitation.createdAt,
    };

    if (options.includeToken) {
      response.token = invitation.token;
      if (options.baseUrl) {
        response.inviteUrl = `${options.baseUrl}/invite/${invitation.token}`;
      }
    }

    return response;
  }

  /**
   * Create a new invitation
   */
  async create(
    dto: CreateInvitationDto,
    invitedBy: string,
    baseUrl?: string,
  ): Promise<InvitationResponseDto> {
    // Check if user already exists in this workspace
    const existingUser = await this.authService.getUserByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException(
        `User with email ${dto.email} is already a member of this workspace`,
      );
    }

    // Check for existing pending invitation
    const [existingInvitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.email, dto.email),
          isNull(workspaceInvitations.acceptedAt),
          gt(workspaceInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (existingInvitation) {
      throw new ConflictException(
        `A pending invitation already exists for ${dto.email}. Delete it first or wait for it to expire.`,
      );
    }

    const token = this.generateToken();
    const expiresAt = this.calculateExpiration(dto.expiresInHours || 168); // Default 7 days

    const [invitation] = await db
      .insert(workspaceInvitations)
      .values({
        email: dto.email,
        role: dto.role || InvitationRole.USER,
        token,
        invitedBy,
        expiresAt,
      })
      .returning();

    const response = this.toResponse(invitation, { includeToken: true, baseUrl });

    // Send invitation email if email provider is configured
    if (response.inviteUrl) {
      await this.sendInvitationEmailSafe(dto.email, response.inviteUrl, invitation.role);
    }

    return response;
  }

  /**
   * List invitations
   */
  async findAll(query: ListInvitationsQueryDto): Promise<InvitationResponseDto[]> {
    const conditions: SQL<unknown>[] = [];

    if (query.pendingOnly) {
      conditions.push(isNull(workspaceInvitations.acceptedAt));
      conditions.push(gt(workspaceInvitations.expiresAt, new Date()));
    }

    if (query.email) {
      conditions.push(eq(workspaceInvitations.email, query.email));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const invitations = await db.select().from(workspaceInvitations).where(whereClause);

    return invitations.map((inv) => this.toResponse(inv, { includeToken: true }));
  }

  /**
   * Get invitation by ID (admin only)
   */
  async findById(id: string): Promise<InvitationResponseDto> {
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${id} not found`);
    }

    return this.toResponse(invitation, { includeToken: true });
  }

  /**
   * Validate an invitation token (public endpoint)
   * Returns basic info without sensitive data
   */
  async validateToken(
    token: string,
  ): Promise<{ valid: boolean; email?: string; role?: string; error?: string }> {
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1);

    if (!invitation) {
      return { valid: false, error: 'Invitation not found' };
    }

    if (invitation.acceptedAt) {
      return { valid: false, error: 'Invitation has already been accepted' };
    }

    if (this.isExpired(invitation)) {
      return { valid: false, error: 'Invitation has expired' };
    }

    return {
      valid: true,
      email: invitation.email,
      role: invitation.role,
    };
  }

  /**
   * Accept an invitation
   * Called after user has authenticated via SuperTokens
   */
  async accept(
    token: string,
    userId: string,
    userEmail: string,
  ): Promise<{ id: string; email: string; role: string }> {
    // Find the invitation
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (this.isExpired(invitation)) {
      throw new BadRequestException('Invitation has expired');
    }

    // Verify email matches (case-insensitive)
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new BadRequestException(
        `This invitation was sent to ${invitation.email}. Please sign in with that email address.`,
      );
    }

    // Check if user already exists in workspace
    const existingUser = await this.authService.getUserById(userId);
    if (existingUser) {
      throw new ConflictException('You are already a member of this workspace');
    }

    // Create the user in the workspace with the invited role
    const newUser = await this.authService.createUser(
      invitation.email,
      invitation.role as 'admin' | 'user',
      userId,
    );

    // Mark invitation as accepted
    await db
      .update(workspaceInvitations)
      .set({
        acceptedAt: new Date(),
        acceptedUserId: newUser.id,
      })
      .where(eq(workspaceInvitations.id, invitation.id));

    return {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    };
  }

  /**
   * Delete an invitation (admin only)
   */
  async delete(id: string): Promise<void> {
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${id} not found`);
    }

    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, id));
  }

  /**
   * Resend an invitation (generates new token, extends expiration)
   */
  async resend(
    id: string,
    expiresInHours: number = 168,
    baseUrl?: string,
  ): Promise<InvitationResponseDto> {
    const [invitation] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, id))
      .limit(1);

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${id} not found`);
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Cannot resend an accepted invitation');
    }

    // Generate new token and extend expiration
    const newToken = this.generateToken();
    const newExpiresAt = this.calculateExpiration(expiresInHours);

    const [updated] = await db
      .update(workspaceInvitations)
      .set({
        token: newToken,
        expiresAt: newExpiresAt,
      })
      .where(eq(workspaceInvitations.id, id))
      .returning();

    const response = this.toResponse(updated, { includeToken: true, baseUrl });

    // Send invitation email if email provider is configured
    if (response.inviteUrl) {
      await this.sendInvitationEmailSafe(updated.email, response.inviteUrl, updated.role);
    }

    return response;
  }

  /**
   * Helper to send invitation email without throwing if email is not configured
   */
  private async sendInvitationEmailSafe(
    email: string,
    inviteUrl: string,
    role: string,
  ): Promise<void> {
    if (!this.emailService.isConfigured()) {
      this.logger.debug('Email provider not configured, skipping invitation email');
      return;
    }

    try {
      const result = await this.emailService.sendInvitationEmail(email, inviteUrl, {
        role,
      });

      if (result.success) {
        this.logger.log(`Invitation email sent to ${email}`);
      } else {
        this.logger.warn(`Failed to send invitation email to ${email}: ${result.error}`);
      }
    } catch (error) {
      this.logger.error(`Error sending invitation email to ${email}:`, error);
      // Don't throw - email sending should not block invitation creation
    }
  }
}
