import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  Matches,
  IsArray,
  ArrayMaxSize,
  IsUUID,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Enums
export enum DeploymentSortField {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  REPOSITORY = 'repository',
  COMMIT_SHA = 'commitSha',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// Request DTOs

export class CreateDeploymentDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'Files to upload (up to 50 files, 100MB each)',
  })
  files?: Express.Multer.File[];

  @ApiPropertyOptional({
    description: 'File paths corresponding to each uploaded file (preserves directory structure)',
    example: ['src/index.html', 'assets/logo.png'],
  })
  @IsOptional()
  @IsString()
  filePaths?: string;

  @ApiProperty({ description: 'GitHub repository (e.g., "owner/repo")' })
  @IsString()
  repository: string;

  @ApiProperty({ description: 'Git commit SHA' })
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha: string;

  @ApiPropertyOptional({ description: 'Git branch name' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Alias name (e.g., "main", "production", "staging")' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Alias must contain only letters, numbers, underscores, and hyphens',
  })
  alias?: string;

  @ApiPropertyOptional({ description: 'Make deployment publicly accessible', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Deployment description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Git commit timestamp (ISO 8601 format)',
    example: '2025-01-15T10:30:00Z',
    type: String,
  })
  @IsOptional()
  @IsString()
  committedAt?: string;

  @ApiPropertyOptional({
    description: 'Tags for this deployment (comma-separated or JSON array)',
    example: 'v1.0.0,release',
    type: String,
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description:
      'Base path within the upload. When provided, auto-creates a deterministic preview alias pointing to this path.',
    example: '/apps/dashboard',
  })
  @IsOptional()
  @IsString()
  basePath?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set name to apply to auto-preview aliases. Takes precedence over proxyRuleSetId. If neither specified, uses project default.',
    example: 'api-backend',
  })
  @IsOptional()
  @IsString()
  proxyRuleSetName?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID to apply to auto-preview aliases. Use proxyRuleSetName for a more human-friendly option.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  proxyRuleSetId?: string;
}

export class CreateDeploymentZipDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Zip file containing deployment files (max 500MB)',
  })
  file?: Express.Multer.File;

  @ApiProperty({ description: 'GitHub repository (e.g., "owner/repo")' })
  @IsString()
  repository: string;

  @ApiProperty({ description: 'Git commit SHA' })
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha: string;

  @ApiPropertyOptional({ description: 'Git branch name' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Alias name (e.g., "main", "production", "staging")' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Alias must contain only letters, numbers, underscores, and hyphens',
  })
  alias?: string;

  @ApiPropertyOptional({ description: 'Make deployment publicly accessible', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Deployment description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of files to extract from zip (default: 1000)',
    default: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  @Transform(({ value }) => parseInt(value, 10))
  maxFiles?: number = 1000;

  @ApiPropertyOptional({
    description: 'Maximum total size in bytes (default: 500MB)',
    default: 500 * 1024 * 1024,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  maxTotalSize?: number = 500 * 1024 * 1024;

  @ApiPropertyOptional({
    description: 'Git commit timestamp (ISO 8601 format)',
    example: '2025-01-15T10:30:00Z',
    type: String,
  })
  @IsOptional()
  @IsString()
  committedAt?: string;

  @ApiPropertyOptional({
    description: 'Tags for this deployment (comma-separated or JSON array)',
    example: 'v1.0.0,release',
    type: String,
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description:
      'Base path within the upload. When provided, auto-creates a deterministic preview alias pointing to this path.',
    example: '/apps/dashboard',
  })
  @IsOptional()
  @IsString()
  basePath?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set name to apply to auto-preview aliases. Takes precedence over proxyRuleSetId. If neither specified, uses project default.',
    example: 'api-backend',
  })
  @IsOptional()
  @IsString()
  proxyRuleSetName?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID to apply to auto-preview aliases. Use proxyRuleSetName for a more human-friendly option.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  proxyRuleSetId?: string;
}

export class UpdateDeploymentDto {
  @ApiPropertyOptional({ description: 'Make deployment publicly accessible' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Deployment description' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ListDeploymentsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by repository' })
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional({ description: 'Filter by branch' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Filter by commit SHA' })
  @IsOptional()
  @IsString()
  commitSha?: string;

  @ApiPropertyOptional({ description: 'Filter by public status' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Sort by field', enum: DeploymentSortField })
  @IsOptional()
  @IsEnum(DeploymentSortField)
  sortBy?: DeploymentSortField = DeploymentSortField.CREATED_AT;

  @ApiPropertyOptional({ description: 'Sort order', enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}

// Alias DTOs

export class CreateAliasDto {
  @ApiProperty({ description: 'Alias name (e.g., "main", "production", "staging")' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Alias must contain only letters, numbers, underscores, and hyphens',
  })
  alias: string;

  @ApiProperty({ description: 'Commit SHA to point to' })
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha: string;
}

export class UpdateAliasDto {
  @ApiPropertyOptional({ description: 'New commit SHA to point to' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID to apply to this alias (null to clear)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  proxyRuleSetId?: string | null;
}

export class ListAliasesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by repository' })
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional({ description: 'Include auto-preview aliases', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeAutoPreview?: boolean;
}

// Response DTOs

export class DeploymentFileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  publicPath: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;
}

export class AliasResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  repository: string;

  @ApiProperty()
  alias: string;

  @ApiProperty()
  commitSha: string;

  @ApiProperty()
  deploymentId: string;

  @ApiPropertyOptional({ description: 'Whether this is an auto-generated preview alias' })
  isAutoPreview?: boolean;

  @ApiPropertyOptional({ description: 'Base path for this alias (for auto-preview aliases)' })
  basePath?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class DeploymentResponseDto {
  @ApiProperty()
  deploymentId: string;

  @ApiProperty()
  repository: string;

  @ApiProperty()
  commitSha: string;

  @ApiPropertyOptional()
  branch?: string;

  @ApiProperty()
  isPublic: boolean;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  fileCount: number;

  @ApiProperty()
  totalSize: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Public URLs for this deployment' })
  urls: {
    sha: string;
    branch?: string;
    default?: string;
  };

  @ApiPropertyOptional({
    type: [String],
    description: 'Active aliases pointing to this deployment',
  })
  aliases?: string[];
}

export class DeploymentDetailResponseDto extends DeploymentResponseDto {
  @ApiProperty({ type: [DeploymentFileDto], description: 'Files in this deployment' })
  files: DeploymentFileDto[];
}

export class CreateDeploymentResponseDto {
  @ApiProperty()
  deploymentId: string;

  @ApiProperty()
  commitSha: string;

  @ApiProperty()
  fileCount: number;

  @ApiProperty()
  totalSize: number;

  @ApiProperty({ description: 'Public URLs for this deployment' })
  urls: {
    sha: string;
    branch?: string;
    default?: string;
    preview?: string;
  };

  @ApiProperty({ type: [String], description: 'Auto-created aliases' })
  aliases: string[];

  @ApiPropertyOptional({
    description: 'Files that failed to upload with error details',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The filename that failed' },
        error: { type: 'string', description: 'The error message' },
      },
    },
  })
  failed?: { file: string; error: string }[];
}

export class PaginationMetaDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;

  @ApiProperty()
  hasPreviousPage: boolean;
}

export class ListDeploymentsResponseDto {
  @ApiProperty({ type: [DeploymentResponseDto] })
  data: DeploymentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class ListAliasesResponseDto {
  @ApiProperty({ type: [AliasResponseDto] })
  data: AliasResponseDto[];
}

// Delete Commit DTOs

export class DeleteCommitResponseDto {
  @ApiProperty({
    example: 'Commit deleted successfully',
    description: 'Success message',
  })
  message: string;

  @ApiProperty({
    example: 4,
    description: 'Number of deployments deleted',
  })
  deletedDeployments: number;

  @ApiProperty({
    example: 835,
    description: 'Number of files deleted',
  })
  deletedFiles: number;

  @ApiProperty({
    example: 28540928,
    description: 'Total bytes freed',
  })
  freedBytes: number;
}

export class DeleteCommitErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Cannot delete commit with active aliases' })
  message: string;

  @ApiProperty({
    example: ['production', 'staging'],
    description: 'List of aliases blocking deletion',
  })
  aliases: string[];
}

// Phase B5: Alias Visibility DTOs

export class UpdateAliasVisibilityDto {
  @ApiPropertyOptional({
    description:
      'Visibility override: true = force public, false = force private, null = inherit from project',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Unauthorized behavior override: null = inherit from project',
    enum: ['not_found', 'redirect_login'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['not_found', 'redirect_login'])
  unauthorizedBehavior?: 'not_found' | 'redirect_login' | null;

  @ApiPropertyOptional({
    description:
      'Required role override: null = inherit from project',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['authenticated', 'viewer', 'contributor', 'admin', 'owner'])
  requiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner' | null;
}

export class AliasVisibilityResponseDto {
  @ApiProperty()
  projectId: string;

  @ApiProperty()
  alias: string;

  @ApiProperty({ description: 'The resolved visibility (public or private)' })
  effectiveVisibility: 'public' | 'private';

  @ApiProperty({
    description: 'Where the visibility setting comes from',
    enum: ['alias', 'project'],
  })
  source: 'alias' | 'project';

  @ApiPropertyOptional({
    description: 'Alias-level visibility override (null = inherit from project)',
    nullable: true,
  })
  aliasOverride?: boolean | null;

  @ApiProperty({ description: 'Project-level visibility' })
  projectVisibility: boolean;

  @ApiPropertyOptional({
    description: 'Effective unauthorized behavior',
    enum: ['not_found', 'redirect_login'],
  })
  effectiveUnauthorizedBehavior?: 'not_found' | 'redirect_login';

  @ApiPropertyOptional({
    description: 'Effective required role',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
  })
  effectiveRequiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';
}

// Phase: Pre-signed URL Artifact Uploads

/**
 * File info for batch upload request
 */
export class BatchUploadFileDto {
  @ApiProperty({ description: 'Relative path within the deployment', example: 'index.html' })
  @IsString()
  path: string;

  @ApiProperty({ description: 'File size in bytes', example: 1024 })
  @IsInt()
  @Min(0)
  size: number;

  @ApiProperty({
    description: 'MIME type of the file',
    example: 'text/html',
  })
  @IsString()
  contentType: string;
}

/**
 * Request DTO for prepare-batch-upload endpoint
 */
export class PrepareBatchUploadDto {
  @ApiProperty({ description: 'GitHub repository (e.g., "owner/repo")' })
  @IsString()
  repository: string;

  @ApiProperty({ description: 'Git commit SHA' })
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha: string;

  @ApiPropertyOptional({ description: 'Git branch name' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ description: 'Alias name (e.g., "main", "production", "staging")' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Alias must contain only letters, numbers, underscores, and hyphens',
  })
  alias?: string;

  @ApiPropertyOptional({
    description:
      'Base path within the upload. When provided, auto-creates a deterministic preview alias pointing to this path.',
    example: '/apps/dashboard',
  })
  @IsOptional()
  @IsString()
  basePath?: string;

  @ApiPropertyOptional({ description: 'Deployment description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Tags for this deployment (comma-separated or JSON array)',
    example: 'v1.0.0,release',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set name to apply to auto-preview aliases',
    example: 'api-backend',
  })
  @IsOptional()
  @IsString()
  proxyRuleSetName?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID to apply to auto-preview aliases',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  proxyRuleSetId?: string;

  @ApiProperty({
    description: 'Array of files to upload',
    type: [BatchUploadFileDto],
  })
  @IsArray()
  @ArrayMaxSize(10000)
  files: BatchUploadFileDto[];
}

/**
 * Presigned URL info for a single file
 */
export class PresignedUrlInfoDto {
  @ApiProperty({ description: 'Relative path within the deployment' })
  path: string;

  @ApiProperty({ description: 'Presigned URL for PUT upload' })
  presignedUrl: string;

  @ApiProperty({ description: 'Storage key where the file will be stored' })
  storageKey: string;
}

/**
 * Response DTO for prepare-batch-upload endpoint
 */
export class PrepareBatchUploadResponseDto {
  @ApiProperty({
    description: 'Whether presigned URLs are supported by the storage backend',
  })
  presignedUrlsSupported: boolean;

  @ApiPropertyOptional({
    description: 'Upload token to use when finalizing the upload',
  })
  uploadToken?: string;

  @ApiPropertyOptional({
    description: 'When the presigned URLs expire (ISO 8601 timestamp)',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Presigned URLs for each file (only present if presignedUrlsSupported is true)',
    type: [PresignedUrlInfoDto],
  })
  files?: PresignedUrlInfoDto[];
}

/**
 * Request DTO for finalize-upload endpoint
 */
export class FinalizeUploadDto {
  @ApiProperty({ description: 'Upload token from prepare-batch-upload response' })
  @IsString()
  uploadToken: string;
}

/**
 * Response DTO for finalize-upload endpoint (reuses CreateDeploymentResponseDto)
 */
export class FinalizeUploadResponseDto extends CreateDeploymentResponseDto {}
