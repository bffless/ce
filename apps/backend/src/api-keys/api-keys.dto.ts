import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsEnum,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// Enums
export enum ApiKeySortField {
  NAME = 'name',
  CREATED_AT = 'createdAt',
  LAST_USED_AT = 'lastUsedAt',
  EXPIRES_AT = 'expiresAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// Request DTOs
export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Name for the API key',
    example: 'GitHub Actions - Production',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Repository this key can access (format: owner/repo)',
    example: 'owner/repo',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    message: 'Repository must be in format: owner/repo',
  })
  repository?: string;

  @ApiPropertyOptional({
    description:
      '[DEPRECATED] List of repositories this key can access (format: owner/repo). Use "repository" instead.',
    example: ['owner/repo1', 'owner/repo2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    each: true,
    message: 'Each repository must be in format: owner/repo',
  })
  allowedRepositories?: string[];

  @ApiPropertyOptional({
    description: 'Expiration date for the API key (ISO 8601 format)',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Create a global API key that can access all projects the user has permissions on. Only admins can create global keys.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;
}

export class UpdateApiKeyDto {
  @ApiPropertyOptional({
    description: 'Name for the API key',
    example: 'GitHub Actions - Staging',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description:
      'List of repositories this key can access (format: owner/repo). If empty, allows all repositories.',
    example: ['owner/repo1', 'owner/repo2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    each: true,
    message: 'Each repository must be in format: owner/repo',
  })
  allowedRepositories?: string[];

  @ApiPropertyOptional({
    description:
      'Expiration date for the API key (ISO 8601 format). Set to null to remove expiration.',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class ListApiKeysQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Search by API key name',
    example: 'production',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: ApiKeySortField,
    default: ApiKeySortField.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(ApiKeySortField)
  sortBy?: ApiKeySortField = ApiKeySortField.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}

// Response DTOs
export class ApiKeyResponseDto {
  @ApiProperty({
    description: 'API key ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the API key',
    example: 'GitHub Actions - Production',
  })
  name: string;

  @ApiProperty({
    description: 'User ID who owns this API key',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  userId: string;

  @ApiPropertyOptional({
    description: 'Project ID this key is scoped to',
    example: '550e8400-e29b-41d4-a716-446655440002',
    nullable: true,
  })
  projectId: string | null;

  @ApiPropertyOptional({
    description: '[DEPRECATED] List of repositories this key can access. Use projectId instead.',
    example: ['owner/repo1', 'owner/repo2'],
    type: [String],
    nullable: true,
  })
  allowedRepositories: string[] | null;

  @ApiPropertyOptional({
    description: 'Expiration date of the API key',
    example: '2025-12-31T23:59:59.000Z',
    nullable: true,
  })
  expiresAt: string | null;

  @ApiPropertyOptional({
    description: 'Last time the API key was used',
    example: '2025-01-15T10:30:00.000Z',
    nullable: true,
  })
  lastUsedAt: string | null;

  @ApiProperty({
    description: 'Whether the API key has expired',
    example: false,
  })
  isExpired: boolean;

  @ApiProperty({
    description: 'Whether this is a global key (not project-scoped)',
    example: false,
  })
  isGlobal: boolean;

  @ApiPropertyOptional({
    description: 'Project details if scoped to a project',
    example: { id: '550e8400-e29b-41d4-a716-446655440002', owner: 'acme', name: 'website' },
    nullable: true,
  })
  project?: { id: string; owner: string; name: string } | null;

  @ApiProperty({
    description: 'Creation date of the API key',
    example: '2025-01-01T00:00:00.000Z',
  })
  createdAt: string;
}

export class CreateApiKeyResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'API key created successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The created API key details',
    type: ApiKeyResponseDto,
  })
  data: ApiKeyResponseDto;

  @ApiProperty({
    description:
      'The raw API key (shown only once!). Store this securely - it cannot be retrieved again.',
    example: 'wsa_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  })
  key: string;
}

export class GetApiKeyResponseDto {
  @ApiProperty({
    description: 'The API key details',
    type: ApiKeyResponseDto,
  })
  data: ApiKeyResponseDto;
}

export class UpdateApiKeyResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'API key updated successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The updated API key details',
    type: ApiKeyResponseDto,
  })
  data: ApiKeyResponseDto;
}

export class DeleteApiKeyResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'API key revoked successfully',
  })
  message: string;
}

export class PaginationMetaDto {
  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of items', example: 25 })
  total: number;

  @ApiProperty({ description: 'Total number of pages', example: 3 })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page', example: false })
  hasPreviousPage: boolean;
}

export class ListApiKeysResponseDto {
  @ApiProperty({
    description: 'List of API keys',
    type: [ApiKeyResponseDto],
  })
  data: ApiKeyResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;
}
