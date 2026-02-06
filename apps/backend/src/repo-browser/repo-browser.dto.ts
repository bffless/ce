import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, Max, IsEnum, Matches, IsBoolean, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

// Response DTOs for GET /api/repo/:owner/:repo/:commitSha/files

export class FileInfoDto {
  @ApiProperty({ description: 'File path within deployment', example: 'index.html' })
  path: string;

  @ApiProperty({ description: 'File name', example: 'index.html' })
  fileName: string;

  @ApiProperty({ description: 'File size in bytes', example: 1234 })
  size: number;

  @ApiProperty({ description: 'MIME type', example: 'text/html' })
  mimeType: string;

  @ApiProperty({ description: 'Whether file is publicly accessible', example: true })
  isPublic: boolean;

  @ApiProperty({ description: 'File creation timestamp', example: '2024-01-15T10:30:00Z' })
  createdAt: string;
}

export class GetFileTreeResponseDto {
  @ApiProperty({ description: 'Full commit SHA' })
  commitSha: string;

  @ApiProperty({ description: 'Repository in format owner/repo', example: 'owner/repo' })
  repository: string;

  @ApiPropertyOptional({ description: 'Branch name if available', example: 'main' })
  branch?: string;

  @ApiProperty({
    description: 'List of files in the deployment, ordered alphabetically by path',
    type: [FileInfoDto],
  })
  files: FileInfoDto[];
}

// Response DTOs for GET /api/repo/:owner/:repo/refs

export class AliasRefDto {
  @ApiProperty({ description: 'Alias name', example: 'production' })
  name: string;

  @ApiProperty({ description: 'Commit SHA this alias points to' })
  commitSha: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string;

  @ApiProperty({ description: 'Whether this is an auto-generated preview alias' })
  isAutoPreview: boolean;
}

export class BranchRefDto {
  @ApiProperty({ description: 'Branch name', example: 'main' })
  name: string;

  @ApiProperty({ description: 'Latest commit SHA on this branch' })
  latestCommit: string;

  @ApiProperty({ description: 'Latest deployment timestamp for this branch' })
  latestDeployedAt: string;

  @ApiProperty({ description: 'Number of files in latest deployment' })
  fileCount: number;
}

export class CommitRefDto {
  @ApiProperty({ description: 'Full commit SHA' })
  sha: string;

  @ApiProperty({ description: 'Short commit SHA (first 7 characters)' })
  shortSha: string;

  @ApiPropertyOptional({ description: 'Branch name if available' })
  branch?: string;

  @ApiPropertyOptional({ description: 'Description if available' })
  description?: string;

  @ApiProperty({ description: 'Deployment timestamp' })
  deployedAt: string;
}

// Pagination info DTO for cursor-based pagination
export class PaginationInfoDto {
  @ApiProperty({ description: 'Whether there are more items to load' })
  hasMore: boolean;

  @ApiPropertyOptional({ description: 'Cursor for next page (commit SHA)' })
  nextCursor?: string;

  @ApiProperty({ description: 'Total number of commits' })
  total: number;
}

// Query params for refs endpoint pagination
export class RepositoryRefsQueryDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (commit SHA to start after)',
    example: 'abc123def456...',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of commits to return per page',
    default: 50,
    minimum: 10,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(10)
  @Max(100)
  limit?: number = 50;
}

export class GetRepositoryRefsResponseDto {
  @ApiProperty({
    description: 'List of aliases for this repository',
    type: [AliasRefDto],
  })
  aliases: AliasRefDto[];

  @ApiProperty({
    description: 'List of branches with their latest commits',
    type: [BranchRefDto],
  })
  branches: BranchRefDto[];

  @ApiProperty({
    description: 'Recent deployed commits (paginated)',
    type: [CommitRefDto],
  })
  recentCommits: CommitRefDto[];

  @ApiProperty({
    description: 'Pagination information for commits',
    type: PaginationInfoDto,
  })
  pagination: PaginationInfoDto;
}

// DTOs for GET /api/repo/:owner/:repo/deployments (Phase 2I)

export class DeploymentItemDto {
  @ApiProperty({ description: 'Deployment ID' })
  id: string;

  @ApiProperty({ description: 'Full commit SHA' })
  commitSha: string;

  @ApiProperty({ description: 'Short commit SHA (first 7 characters)' })
  shortSha: string;

  @ApiPropertyOptional({ description: 'Branch name if available' })
  branch?: string;

  @ApiPropertyOptional({ description: 'Description if available' })
  description?: string;

  @ApiProperty({ description: 'Deployment timestamp' })
  deployedAt: string;

  @ApiProperty({ description: 'Number of files in deployment' })
  fileCount: number;

  @ApiProperty({ description: 'Total size in bytes' })
  totalSize: number;

  @ApiProperty({ description: 'Whether deployment is public' })
  isPublic: boolean;
}

export enum DeploymentSortBy {
  DATE = 'date',
  BRANCH = 'branch',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class GetDeploymentsQueryDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by branch', example: 'main' })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: DeploymentSortBy,
    default: 'date',
  })
  @IsOptional()
  @IsEnum(DeploymentSortBy)
  sortBy?: DeploymentSortBy = DeploymentSortBy.DATE;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}

export class GetDeploymentsResponseDto {
  @ApiProperty({ description: 'Repository in format owner/repo', example: 'owner/repo' })
  repository: string;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of deployments' })
  total: number;

  @ApiProperty({
    description: 'List of deployments',
    type: [DeploymentItemDto],
  })
  deployments: DeploymentItemDto[];
}

// DTOs for GET /api/repo/:owner/:repo/stats (Phase 2I)

export class GetRepositoryStatsResponseDto {
  @ApiProperty({ description: 'Repository in format owner/repo', example: 'owner/repo' })
  repository: string;

  @ApiProperty({ description: 'Total number of deployments' })
  totalDeployments: number;

  @ApiProperty({ description: 'Total storage used in bytes' })
  totalStorageBytes: number;

  @ApiProperty({ description: 'Total storage used in MB' })
  totalStorageMB: number;

  @ApiPropertyOptional({ description: 'Last deployment timestamp' })
  lastDeployedAt?: string;

  @ApiProperty({ description: 'Number of distinct branches' })
  branchCount: number;

  @ApiProperty({ description: 'Number of aliases' })
  aliasCount: number;

  @ApiProperty({ description: 'Whether any deployment is public' })
  isPublic: boolean;
}

// DTOs for alias management under /api/repo/:owner/:repo/aliases (Phase 2J)

export class GetAliasesQueryDto {
  @ApiPropertyOptional({
    description: 'Include auto-generated preview aliases (default: false)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeAutoPreview?: boolean = false;
}

export class AliasDetailDto {
  @ApiProperty({ description: 'Alias ID' })
  id: string;

  @ApiProperty({ description: 'Alias name', example: 'production' })
  name: string;

  @ApiProperty({ description: 'Full commit SHA this alias points to' })
  commitSha: string;

  @ApiProperty({ description: 'Short commit SHA (first 7 characters)' })
  shortSha: string;

  @ApiPropertyOptional({ description: 'Branch name if available' })
  branch?: string;

  @ApiProperty({ description: 'Deployment ID' })
  deploymentId: string;

  @ApiProperty({ description: 'Alias creation timestamp' })
  createdAt: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string;

  @ApiPropertyOptional({ description: 'Whether this is an auto-generated preview alias' })
  isAutoPreview?: boolean;

  @ApiPropertyOptional({ description: 'Base path for this alias (for auto-preview aliases)' })
  basePath?: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID assigned to this alias',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
  })
  proxyRuleSetId?: string | null;
}

export class GetAliasesResponseDto {
  @ApiProperty({ description: 'Repository in format owner/repo', example: 'owner/repo' })
  repository: string;

  @ApiProperty({
    description: 'List of aliases for this repository',
    type: [AliasDetailDto],
  })
  aliases: AliasDetailDto[];
}

export class CreateAliasRequestDto {
  @ApiProperty({ description: 'Alias name (e.g., "production", "staging")', example: 'production' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Alias name must contain only letters, numbers, underscores, and hyphens',
  })
  name: string;

  @ApiProperty({ description: 'Commit SHA to point to', example: 'abc123def456' })
  @IsString()
  @Matches(/^[a-f0-9]{7,40}$/i, { message: 'Invalid commit SHA format' })
  commitSha: string;

  @ApiPropertyOptional({
    description: 'Proxy rule set ID to apply to this alias',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  proxyRuleSetId?: string;
}

export class UpdateAliasRequestDto {
  @ApiPropertyOptional({ description: 'New commit SHA to point to', example: 'xyz789abc456' })
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

export class AliasCreatedResponseDto {
  @ApiProperty({ description: 'Alias ID' })
  id: string;

  @ApiProperty({ description: 'Repository in format owner/repo' })
  repository: string;

  @ApiProperty({ description: 'Alias name' })
  name: string;

  @ApiProperty({ description: 'Commit SHA' })
  commitSha: string;

  @ApiProperty({ description: 'Deployment ID' })
  deploymentId: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string;
}

// Response DTOs for GET /api/repo/:owner/:repo/:commitSha/details

export class CommitInfoDto {
  @ApiProperty({ description: 'Full commit SHA' })
  sha: string;

  @ApiProperty({ description: 'Short commit SHA (first 7 characters)' })
  shortSha: string;

  @ApiPropertyOptional({ description: 'Commit message if available' })
  message?: string;

  @ApiPropertyOptional({ description: 'Commit author email if available' })
  author?: string;

  @ApiPropertyOptional({ description: 'Commit author name if available' })
  authorName?: string;

  @ApiPropertyOptional({ description: 'Commit timestamp if available' })
  committedAt?: string;

  @ApiProperty({ description: 'Branch name' })
  branch: string;
}

export class DeploymentInfoDto {
  @ApiProperty({ description: 'Deployment ID' })
  id: string;

  @ApiProperty({ description: 'Number of files in deployment' })
  fileCount: number;

  @ApiProperty({ description: 'Total size of all files in bytes' })
  totalSize: number;

  @ApiProperty({ description: 'Deployment timestamp' })
  deployedAt: string;

  @ApiPropertyOptional({ description: 'Deployment description if available' })
  description?: string;

  @ApiPropertyOptional({ description: 'Workflow name if available' })
  workflowName?: string;
}

export class CommitAliasDto {
  @ApiProperty({ description: 'Alias name' })
  name: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string;

  @ApiPropertyOptional({ description: 'Whether this is an auto-generated preview alias' })
  isAutoPreview?: boolean;

  @ApiPropertyOptional({ description: 'Base path for this alias (for auto-preview aliases)' })
  basePath?: string;

  @ApiPropertyOptional({ description: 'Proxy rule set ID assigned to this alias' })
  proxyRuleSetId?: string | null;

  @ApiPropertyOptional({ description: 'Proxy rule set name assigned to this alias' })
  proxyRuleSetName?: string | null;
}

export class GetCommitDetailsResponseDto {
  @ApiProperty({ description: 'Commit information', type: CommitInfoDto })
  commit: CommitInfoDto;

  @ApiProperty({
    description: 'All deployments for this commit',
    type: [DeploymentInfoDto],
  })
  deployments: DeploymentInfoDto[];

  @ApiProperty({
    description: 'Aliases pointing to this commit',
    type: [CommitAliasDto],
  })
  aliases: CommitAliasDto[];

  @ApiPropertyOptional({ description: 'Path to README file if exists' })
  readmePath?: string;
}

