import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsEnum,
  MaxLength,
  Matches,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

// Enums
export enum AssetSortField {
  FILE_NAME = 'fileName',
  SIZE = 'size',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  REPOSITORY = 'repository',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// Request DTOs

/**
 * Metadata for uploading an asset
 * File is sent as multipart form data
 */
export class UploadAssetDto {
  @ApiPropertyOptional({
    description: 'Description of the asset',
    example: 'Main application bundle for v2.0.0',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Tags for categorizing the asset (comma-separated string or JSON array)',
    example: 'production,bundle,v2.0.0',
    type: String,
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description: 'GitHub repository (format: owner/repo)',
    example: 'owner/repo',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    message: 'Repository must be in format: owner/repo',
  })
  repository?: string;

  @ApiPropertyOptional({
    description: 'GitHub branch name',
    example: 'main',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;

  @ApiPropertyOptional({
    description: 'GitHub commit SHA',
    example: 'abc123def456789',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  commitSha?: string;

  @ApiPropertyOptional({
    description: 'GitHub Actions workflow name',
    example: 'CI/CD Pipeline',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  workflowName?: string;

  @ApiPropertyOptional({
    description: 'GitHub Actions workflow run ID',
    example: '1234567890',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  workflowRunId?: string;

  @ApiPropertyOptional({
    description: 'GitHub Actions workflow run number',
    example: 42,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  workflowRunNumber?: number;

  @ApiPropertyOptional({
    description: 'Deployment ID to group files together',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  deploymentId?: string;

  @ApiPropertyOptional({
    description: 'Make this asset publicly accessible',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Public path within deployment (e.g., "css/style.css")',
    example: 'index.html',
  })
  @IsOptional()
  @IsString()
  publicPath?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional({
    description: 'Description of the asset',
    example: 'Updated description for the asset',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Tags for categorizing the asset (comma-separated string or JSON array)',
    example: 'production,bundle',
    type: String,
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description: 'Make this asset publicly accessible',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Public path within deployment',
    example: 'assets/main.js',
  })
  @IsOptional()
  @IsString()
  publicPath?: string;
}

export class ListAssetsQueryDto {
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
    description: 'Search by filename',
    example: 'index.html',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by repository (format: owner/repo)',
    example: 'owner/repo',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    message: 'Repository must be in format: owner/repo',
  })
  repository?: string;

  @ApiPropertyOptional({
    description: 'Filter by branch name',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description: 'Filter by commit SHA',
    example: 'abc123def456',
  })
  @IsOptional()
  @IsString()
  commitSha?: string;

  @ApiPropertyOptional({
    description: 'Filter by workflow name',
    example: 'CI/CD Pipeline',
  })
  @IsOptional()
  @IsString()
  workflowName?: string;

  @ApiPropertyOptional({
    description: 'Filter by deployment ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  deploymentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by tags (comma-separated)',
    example: 'production,bundle',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO 8601)',
    example: '2025-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO 8601)',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by MIME type',
    example: 'image/png',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: AssetSortField,
    default: AssetSortField.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(AssetSortField)
  sortBy?: AssetSortField = AssetSortField.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}

export class BatchDeleteDto {
  @ApiProperty({
    description: 'Array of asset IDs to delete',
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ids: string[];
}

// Response DTOs

export class AssetResponseDto {
  @ApiProperty({
    description: 'Asset ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'bundle.js',
  })
  fileName: string;

  @ApiPropertyOptional({
    description: 'Original file path',
    example: 'dist/bundle.js',
    nullable: true,
  })
  originalPath: string | null;

  @ApiProperty({
    description: 'Storage key in backend',
    example: 'owner/repo/abc123/bundle.js',
  })
  storageKey: string;

  @ApiProperty({
    description: 'MIME type',
    example: 'application/javascript',
  })
  mimeType: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 125000,
  })
  size: number;

  @ApiPropertyOptional({
    description: 'GitHub repository',
    example: 'owner/repo',
    nullable: true,
  })
  repository: string | null;

  @ApiPropertyOptional({
    description: 'Git branch',
    example: 'main',
    nullable: true,
  })
  branch: string | null;

  @ApiPropertyOptional({
    description: 'Git commit SHA',
    example: 'abc123def456789',
    nullable: true,
  })
  commitSha: string | null;

  @ApiPropertyOptional({
    description: 'Workflow name',
    example: 'CI/CD Pipeline',
    nullable: true,
  })
  workflowName: string | null;

  @ApiPropertyOptional({
    description: 'Workflow run ID',
    example: '1234567890',
    nullable: true,
  })
  workflowRunId: string | null;

  @ApiPropertyOptional({
    description: 'Workflow run number',
    example: 42,
    nullable: true,
  })
  workflowRunNumber: number | null;

  @ApiPropertyOptional({
    description: 'User ID who uploaded',
    example: '550e8400-e29b-41d4-a716-446655440001',
    nullable: true,
  })
  uploadedBy: string | null;

  @ApiPropertyOptional({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
    nullable: true,
  })
  organizationId: string | null;

  @ApiPropertyOptional({
    description: 'Asset tags',
    example: ['production', 'bundle'],
    type: [String],
    nullable: true,
  })
  tags: string[] | null;

  @ApiPropertyOptional({
    description: 'Asset description',
    example: 'Main application bundle',
    nullable: true,
  })
  description: string | null;

  @ApiPropertyOptional({
    description: 'Deployment ID',
    example: '550e8400-e29b-41d4-a716-446655440003',
    nullable: true,
  })
  deploymentId: string | null;

  @ApiPropertyOptional({
    description: 'Whether asset is publicly accessible (DEPRECATED - use project visibility)',
    example: false,
    nullable: true,
    deprecated: true,
  })
  isPublic: boolean | null;

  @ApiPropertyOptional({
    description: 'Public path within deployment',
    example: 'assets/main.js',
    nullable: true,
  })
  publicPath: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-01-01T00:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-01-01T00:00:00.000Z',
  })
  updatedAt: string;
}

export class UploadAssetResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Asset uploaded successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The uploaded asset details',
    type: AssetResponseDto,
  })
  data: AssetResponseDto;
}

export class FailedUploadDto {
  @ApiProperty({
    description: 'The filename that failed to upload',
    example: 'runtime~main.8d5cb3a1.js',
  })
  file: string;

  @ApiProperty({
    description: 'The error message explaining why the upload failed',
    example: 'Invalid storage key: contains unsafe characters',
  })
  error: string;
}

export class BatchUploadResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: '5 assets uploaded successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The uploaded assets',
    type: [AssetResponseDto],
  })
  data: AssetResponseDto[];

  @ApiProperty({
    description: 'Number of successfully uploaded assets',
    example: 5,
  })
  uploadedCount: number;

  @ApiPropertyOptional({
    description: 'Files that failed to upload with error details',
    type: [FailedUploadDto],
  })
  failed?: FailedUploadDto[];
}

export class GetAssetResponseDto {
  @ApiProperty({
    description: 'The asset details',
    type: AssetResponseDto,
  })
  data: AssetResponseDto;
}

export class UpdateAssetResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Asset updated successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The updated asset details',
    type: AssetResponseDto,
  })
  data: AssetResponseDto;
}

export class DeleteAssetResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Asset deleted successfully',
  })
  message: string;
}

export class BatchDeleteResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: '5 assets deleted successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Number of assets deleted',
    example: 5,
  })
  deletedCount: number;
}

export class GetAssetUrlResponseDto {
  @ApiProperty({
    description: 'URL to access or download the asset',
    example: 'https://storage.example.com/assets/file.png?token=xyz',
  })
  url: string;

  @ApiPropertyOptional({
    description: 'URL expiration time (for presigned URLs)',
    example: '2025-01-01T01:00:00.000Z',
  })
  expiresAt?: string;
}

export class PaginationMetaDto {
  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of items', example: 100 })
  total: number;

  @ApiProperty({ description: 'Total number of pages', example: 10 })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page', example: false })
  hasPreviousPage: boolean;
}

export class ListAssetsResponseDto {
  @ApiProperty({
    description: 'List of assets',
    type: [AssetResponseDto],
  })
  data: AssetResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;
}
