import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';

export enum ProjectRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  CONTRIBUTOR = 'contributor',
  VIEWER = 'viewer',
}

export enum ProjectGroupRole {
  ADMIN = 'admin',
  CONTRIBUTOR = 'contributor',
  VIEWER = 'viewer',
}

export class GrantPermissionDto {
  @ApiProperty({
    description: 'User ID to grant permission to',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Role to grant',
    enum: ProjectRole,
    enumName: 'ProjectRole',
    example: ProjectRole.CONTRIBUTOR,
  })
  @IsEnum(ProjectRole)
  @IsNotEmpty()
  role: ProjectRole;
}

export class GrantGroupPermissionDto {
  @ApiProperty({
    description: 'Group ID to grant permission to',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsUUID()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({
    description: 'Role to grant (groups cannot have owner role)',
    enum: ProjectGroupRole,
    enumName: 'ProjectGroupRole',
    example: ProjectGroupRole.CONTRIBUTOR,
  })
  @IsEnum(ProjectGroupRole)
  @IsNotEmpty()
  role: ProjectGroupRole;
}

export class UserPermissionResponseDto {
  @ApiProperty({
    description: 'Permission ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id: string;

  @ApiProperty({
    description: 'Project ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  projectId: string;

  @ApiProperty({
    description: 'User ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  userId: string;

  @ApiProperty({
    description: 'Role granted',
    enum: ProjectRole,
    example: ProjectRole.CONTRIBUTOR,
  })
  role: string;

  @ApiProperty({
    description: 'User ID who granted this permission',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    nullable: true,
  })
  grantedBy: string | null;

  @ApiProperty({
    description: 'When the permission was granted',
    example: '2024-01-15T10:30:00Z',
  })
  grantedAt: Date;
}

export class GroupPermissionResponseDto {
  @ApiProperty({
    description: 'Permission ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id: string;

  @ApiProperty({
    description: 'Project ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  projectId: string;

  @ApiProperty({
    description: 'Group ID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  groupId: string;

  @ApiProperty({
    description: 'Role granted',
    enum: ProjectGroupRole,
    example: ProjectGroupRole.CONTRIBUTOR,
  })
  role: string;

  @ApiProperty({
    description: 'User ID who granted this permission',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    nullable: true,
  })
  grantedBy: string | null;

  @ApiProperty({
    description: 'When the permission was granted',
    example: '2024-01-15T10:30:00Z',
  })
  grantedAt: Date;
}

export class ProjectPermissionsResponseDto {
  @ApiProperty({
    description: 'User permissions for the project',
    type: [UserPermissionResponseDto],
  })
  userPermissions: UserPermissionResponseDto[];

  @ApiProperty({
    description: 'Group permissions for the project',
    type: [GroupPermissionResponseDto],
  })
  groupPermissions: GroupPermissionResponseDto[];
}
