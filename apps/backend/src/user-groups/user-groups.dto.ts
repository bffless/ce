import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({
    description: 'Name of the user group',
    example: 'Frontend Team',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the user group',
    example: 'Team responsible for frontend development',
  })
  @IsString()
  @IsOptional()
  description?: string | null;
}

export class UpdateGroupDto {
  @ApiPropertyOptional({
    description: 'Updated name of the user group',
    example: 'Frontend Development Team',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated description of the user group',
    example: 'Team responsible for all frontend-related tasks',
  })
  @IsString()
  @IsOptional()
  description?: string | null;
}

export class AddMemberDto {
  @ApiProperty({
    description: 'UUID of the user to add as a member',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GroupResponseDto {
  @ApiProperty({
    description: 'UUID of the group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the group',
    example: 'Frontend Team',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the group',
    example: 'Team responsible for frontend development',
  })
  description: string | null;

  @ApiProperty({
    description: 'UUID of the user who created the group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  createdBy: string;

  @ApiProperty({
    description: 'Timestamp when the group was created',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the group was last updated',
    example: '2024-01-20T14:45:00Z',
  })
  updatedAt: Date;
}

export class UserDto {
  @ApiProperty({
    description: 'UUID of the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'user@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'Role of the user',
    example: 'user',
    enum: ['admin', 'user'],
  })
  role: string;
}

export class GroupMemberDto {
  @ApiProperty({
    description: 'UUID of the membership record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'UUID of the group',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  groupId: string;

  @ApiProperty({
    description: 'UUID of the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  userId: string;

  @ApiProperty({
    description: 'UUID of the user who added this member',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  addedBy: string | null;

  @ApiProperty({
    description: 'Timestamp when the member was added',
    example: '2024-01-15T10:30:00Z',
  })
  addedAt: Date;

  @ApiProperty({
    description: 'User details',
    type: UserDto,
  })
  user: UserDto;
}

export class GroupDetailResponseDto extends GroupResponseDto {
  @ApiProperty({
    description: 'List of group members with user details',
    type: [GroupMemberDto],
  })
  members: GroupMemberDto[];
}

export class GroupListResponseDto {
  @ApiProperty({
    description: 'List of user groups',
    type: [GroupResponseDto],
  })
  groups: GroupResponseDto[];
}
