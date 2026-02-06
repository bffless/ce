import { IsString, IsEmail, IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InvitationRole {
  ADMIN = 'admin',
  USER = 'user',
  MEMBER = 'member',
}

// ============================================================================
// Request DTOs
// ============================================================================

export class CreateInvitationDto {
  @ApiProperty({
    description: 'Email address of the user to invite',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Role to assign when invitation is accepted',
    enum: InvitationRole,
    default: InvitationRole.USER,
  })
  @IsOptional()
  @IsEnum(InvitationRole)
  role?: InvitationRole;

  @ApiPropertyOptional({
    description: 'Expiration time in hours (default: 168 = 7 days)',
    default: 168,
    minimum: 1,
    maximum: 720, // 30 days max
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}

export class ListInvitationsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by pending invitations only',
    default: false,
  })
  @IsOptional()
  pendingOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by email address',
  })
  @IsOptional()
  @IsString()
  email?: string;
}

// ============================================================================
// Response DTOs
// ============================================================================

export class InvitationResponseDto {
  @ApiProperty({ description: 'Invitation ID' })
  id: string;

  @ApiProperty({ description: 'Invited email address' })
  email: string;

  @ApiProperty({ description: 'Role to assign on acceptance' })
  role: string;

  @ApiProperty({ description: 'Invitation token (only shown to admin)' })
  token?: string;

  @ApiProperty({ description: 'Invite link URL' })
  inviteUrl?: string;

  @ApiProperty({ description: 'Who created the invitation' })
  invitedBy?: string;

  @ApiProperty({ description: 'Expiration timestamp' })
  expiresAt: Date;

  @ApiProperty({ description: 'Whether the invitation is expired' })
  isExpired: boolean;

  @ApiPropertyOptional({ description: 'When the invitation was accepted' })
  acceptedAt?: Date;

  @ApiPropertyOptional({ description: 'User ID who accepted' })
  acceptedUserId?: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;
}

export class CreateInvitationResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Created invitation' })
  invitation: InvitationResponseDto;
}

export class ListInvitationsResponseDto {
  @ApiProperty({
    description: 'List of invitations',
    type: [InvitationResponseDto],
  })
  invitations: InvitationResponseDto[];
}

export class DeleteInvitationResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'Deleted invitation ID' })
  invitationId: string;
}

// ============================================================================
// Public Invitation DTOs (for invite accept page)
// ============================================================================

export class ValidateInvitationResponseDto {
  @ApiProperty({ description: 'Whether the invitation is valid' })
  valid: boolean;

  @ApiPropertyOptional({ description: 'Email address for this invitation' })
  email?: string;

  @ApiPropertyOptional({ description: 'Role to be assigned' })
  role?: string;

  @ApiPropertyOptional({ description: 'Error message if invalid' })
  error?: string;
}

export class AcceptInvitationResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiProperty({ description: 'The user that was added' })
  user: {
    id: string;
    email: string;
    role: string;
  };
}
