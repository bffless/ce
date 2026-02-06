import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  IsOptional,
  IsIn,
  Min,
  Max,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Path mode for partial commit deletion
 * - 'exclude': Delete files matching pathPatterns, keep everything else
 * - 'include': Keep files matching pathPatterns, delete everything else
 */
export type PathMode = 'include' | 'exclude';

/**
 * DTO for creating a new retention rule
 */
export class CreateRetentionRuleDto {
  @ApiProperty({ description: 'User-friendly name for the rule', example: 'Clean up feature branches' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Glob pattern for branches to match',
    example: 'feature/*',
  })
  @IsString()
  @MaxLength(255)
  branchPattern: string;

  @ApiPropertyOptional({
    description: 'Branches to explicitly exclude from matching',
    example: ['main', 'develop', 'release/*'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeBranches?: string[];

  @ApiProperty({ description: 'Delete commits older than this many days', example: 14 })
  @IsInt()
  @Min(1)
  @Max(3650) // Max 10 years
  retentionDays: number;

  @ApiPropertyOptional({
    description: 'Never delete commits with active aliases',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  keepWithAlias?: boolean;

  @ApiPropertyOptional({
    description: 'Keep at least N most recent commits per branch',
    default: 0,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  keepMinimum?: number;

  @ApiPropertyOptional({ description: 'Enable this rule', default: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'File path patterns for partial deletion (glob syntax)',
    example: ['coverage/**', '*.map', 'test-results/**'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pathPatterns?: string[];

  @ApiPropertyOptional({
    description: 'How to apply pathPatterns: "exclude" deletes matching files, "include" keeps only matching files',
    enum: ['include', 'exclude'],
    example: 'exclude',
  })
  @IsOptional()
  @IsIn(['include', 'exclude'])
  pathMode?: PathMode;
}

/**
 * DTO for updating a retention rule
 */
export class UpdateRetentionRuleDto {
  @ApiPropertyOptional({ description: 'User-friendly name for the rule' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Glob pattern for branches to match' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  branchPattern?: string;

  @ApiPropertyOptional({
    description: 'Branches to explicitly exclude from matching',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeBranches?: string[];

  @ApiPropertyOptional({ description: 'Delete commits older than this many days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;

  @ApiPropertyOptional({ description: 'Never delete commits with active aliases' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  keepWithAlias?: boolean;

  @ApiPropertyOptional({ description: 'Keep at least N most recent commits per branch' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  keepMinimum?: number;

  @ApiPropertyOptional({ description: 'Enable this rule' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'File path patterns for partial deletion (glob syntax)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pathPatterns?: string[];

  @ApiPropertyOptional({
    description: 'How to apply pathPatterns: "exclude" deletes matching files, "include" keeps only matching files',
    enum: ['include', 'exclude'],
  })
  @IsOptional()
  @IsIn(['include', 'exclude'])
  pathMode?: PathMode;
}

/**
 * Last run summary stored in database
 */
export class LastRunSummary {
  @ApiProperty({ description: 'Number of full commits deleted' })
  deletedCommits: number;

  @ApiProperty({ description: 'Number of commits with partial file deletion' })
  partialCommits: number;

  @ApiProperty({ description: 'Total number of assets/files deleted' })
  deletedAssets: number;

  @ApiProperty({ description: 'Bytes freed in last run' })
  freedBytes: number;

  @ApiPropertyOptional({ description: 'Errors encountered during last run', type: [String] })
  errors?: string[];
}

/**
 * Response DTO for a retention rule
 */
export class RetentionRuleResponseDto {
  @ApiProperty({ description: 'Rule ID' })
  id: string;

  @ApiProperty({ description: 'Project ID this rule belongs to' })
  projectId: string;

  @ApiProperty({ description: 'User-friendly name for the rule' })
  name: string;

  @ApiProperty({ description: 'Glob pattern for branches to match' })
  branchPattern: string;

  @ApiProperty({ description: 'Branches explicitly excluded', type: [String] })
  excludeBranches: string[];

  @ApiProperty({ description: 'Days to retain commits before deletion' })
  retentionDays: number;

  @ApiProperty({ description: 'Whether to keep commits with active aliases' })
  keepWithAlias: boolean;

  @ApiProperty({ description: 'Minimum commits to keep per branch' })
  keepMinimum: number;

  @ApiProperty({ description: 'Whether the rule is enabled' })
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'File path patterns for partial deletion',
    type: [String],
  })
  pathPatterns?: string[];

  @ApiPropertyOptional({
    description: 'How pathPatterns are applied',
    enum: ['include', 'exclude'],
  })
  pathMode?: PathMode;

  @ApiPropertyOptional({ description: 'Last execution time' })
  lastRunAt?: Date;

  @ApiPropertyOptional({ description: 'Next scheduled execution time' })
  nextRunAt?: Date;

  @ApiPropertyOptional({ description: 'When a manual execution started (null if not running)' })
  executionStartedAt?: Date;

  @ApiPropertyOptional({ description: 'Summary of last execution', type: LastRunSummary })
  lastRunSummary?: LastRunSummary;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

/**
 * Response for list of retention rules
 */
export class ListRetentionRulesResponseDto {
  @ApiProperty({ type: [RetentionRuleResponseDto] })
  data: RetentionRuleResponseDto[];
}

/**
 * Commit info for preview
 */
export class PreviewCommitDto {
  @ApiProperty({ description: 'Commit SHA' })
  sha: string;

  @ApiProperty({ description: 'Branch name' })
  branch: string;

  @ApiProperty({ description: 'Age in days' })
  ageDays: number;

  @ApiProperty({ description: 'Number of assets/files to be deleted' })
  assetCount: number;

  @ApiProperty({ description: 'Total size of assets to be deleted in bytes' })
  sizeBytes: number;

  @ApiProperty({ description: 'When the commit was uploaded' })
  createdAt: Date;

  @ApiProperty({ description: 'Whether this is a partial deletion (some files kept)' })
  isPartial: boolean;

  @ApiPropertyOptional({ description: 'Total assets in commit (for partial deletion context)' })
  totalAssetCount?: number;

  @ApiPropertyOptional({ description: 'Total size of commit (for partial deletion context)' })
  totalSizeBytes?: number;
}

/**
 * Preview what would be deleted by a rule
 */
export class PreviewDeletionResponseDto {
  @ApiProperty({ description: 'Commits eligible for deletion', type: [PreviewCommitDto] })
  commits: PreviewCommitDto[];

  @ApiProperty({ description: 'Total number of assets that would be deleted' })
  totalAssets: number;

  @ApiProperty({ description: 'Total bytes that would be freed' })
  totalBytes: number;
}

/**
 * Result of starting a retention rule execution (async)
 */
export class ExecuteRuleResponseDto {
  @ApiProperty({ description: 'Whether the execution was started' })
  started: boolean;

  @ApiProperty({ description: 'Message about the execution status' })
  message: string;
}

/**
 * Retention log entry response
 */
export class RetentionLogResponseDto {
  @ApiProperty({ description: 'Log entry ID' })
  id: string;

  @ApiProperty({ description: 'Project ID' })
  projectId: string;

  @ApiPropertyOptional({ description: 'Rule ID that triggered deletion (null if rule was deleted)' })
  ruleId?: string;

  @ApiProperty({ description: 'Deleted commit SHA' })
  commitSha: string;

  @ApiPropertyOptional({ description: 'Branch name' })
  branch?: string;

  @ApiProperty({ description: 'Number of assets deleted' })
  assetCount: number;

  @ApiProperty({ description: 'Bytes freed' })
  freedBytes: number;

  @ApiProperty({ description: 'Whether this was a partial deletion (some files kept)' })
  isPartial: boolean;

  @ApiProperty({ description: 'When the deletion occurred' })
  deletedAt: Date;
}

/**
 * Response for list of retention logs
 */
export class ListRetentionLogsResponseDto {
  @ApiProperty({ type: [RetentionLogResponseDto] })
  data: RetentionLogResponseDto[];

  @ApiProperty({ description: 'Total count for pagination' })
  total: number;
}

/**
 * Query params for listing retention logs
 */
export class ListRetentionLogsQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by rule ID' })
  @IsOptional()
  @IsUUID()
  ruleId?: string;
}

/**
 * Storage overview statistics
 */
export class StorageOverviewDto {
  @ApiProperty({ description: 'Total storage used in bytes' })
  totalBytes: number;

  @ApiProperty({ description: 'Total number of commits' })
  commitCount: number;

  @ApiProperty({ description: 'Total number of branches with deployments' })
  branchCount: number;

  @ApiPropertyOptional({ description: 'Date of oldest commit' })
  oldestCommitAt?: Date;

  @ApiPropertyOptional({ description: 'Branch with oldest commit' })
  oldestCommitBranch?: string;
}
