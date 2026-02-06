import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsObject, IsNumber, Min, Max, IsIn, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @ApiProperty({ description: 'Project owner (e.g., GitHub username or org)' })
  @IsString()
  owner: string;

  @ApiProperty({ description: 'Project name (e.g., repository name)' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Optional display name' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({ description: 'Optional description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the project is public', default: false })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Behavior when unauthenticated user accesses private content',
    enum: ['not_found', 'redirect_login'],
    default: 'not_found',
  })
  @IsIn(['not_found', 'redirect_login'])
  @IsOptional()
  unauthorizedBehavior?: 'not_found' | 'redirect_login';

  @ApiPropertyOptional({
    description: 'Minimum role required to access private content',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
    default: 'authenticated',
  })
  @IsIn(['authenticated', 'viewer', 'contributor', 'admin', 'owner'])
  @IsOptional()
  requiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

  @ApiPropertyOptional({ description: 'Project settings (JSON object)' })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the project is public' })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Behavior when unauthenticated user accesses private content',
    enum: ['not_found', 'redirect_login'],
  })
  @IsIn(['not_found', 'redirect_login'])
  @IsOptional()
  unauthorizedBehavior?: 'not_found' | 'redirect_login';

  @ApiPropertyOptional({
    description: 'Minimum role required to access private content',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
  })
  @IsIn(['authenticated', 'viewer', 'contributor', 'admin', 'owner'])
  @IsOptional()
  requiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

  @ApiPropertyOptional({ description: 'Project settings (JSON object)' })
  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Default proxy rule set ID for this project' })
  @IsUUID()
  @IsOptional()
  defaultProxyRuleSetId?: string | null;
}

export class ProjectResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  owner: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty()
  isPublic: boolean;

  @ApiProperty({ enum: ['not_found', 'redirect_login'] })
  unauthorizedBehavior: 'not_found' | 'redirect_login';

  @ApiProperty({ enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'] })
  requiredRole: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

  @ApiProperty({ nullable: true })
  settings: Record<string, any> | null;

  @ApiProperty({ nullable: true, description: 'Default proxy rule set ID for this project' })
  defaultProxyRuleSetId: string | null;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class MyRepositoryDto {
  @ApiProperty({ description: 'Project UUID' })
  id: string;

  @ApiProperty({ description: 'Repository owner' })
  owner: string;

  @ApiProperty({ description: 'Repository name' })
  name: string;

  @ApiProperty({ description: 'Permission type', enum: ['owner', 'direct', 'group'] })
  permissionType: 'owner' | 'direct' | 'group';

  @ApiProperty({ description: 'User role', enum: ['owner', 'admin', 'contributor', 'viewer'] })
  role: 'owner' | 'admin' | 'contributor' | 'viewer';
}

export class GetMyRepositoriesResponseDto {
  @ApiProperty({ description: 'Total number of repositories' })
  total: number;

  @ApiProperty({ description: 'List of repositories', type: [MyRepositoryDto] })
  repositories: MyRepositoryDto[];
}

export class GetRepositoryFeedQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search query (searches owner, name, description)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['updatedAt', 'createdAt', 'name'],
    default: 'updatedAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: 'updatedAt' | 'createdAt' | 'name';

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';
}

export class RepositoryStatsDto {
  @ApiProperty({ description: 'Number of deployments' })
  deploymentCount: number;

  @ApiProperty({ description: 'Total storage in bytes' })
  storageBytes: number;

  @ApiProperty({ description: 'Total storage in MB' })
  storageMB: number;

  @ApiProperty({ description: 'Last deployment date', nullable: true })
  lastDeployedAt: string | null;
}

export class FeedRepositoryDto {
  @ApiProperty({ description: 'Project UUID' })
  id: string;

  @ApiProperty({ description: 'Repository owner' })
  owner: string;

  @ApiProperty({ description: 'Repository name' })
  name: string;

  @ApiProperty({ description: 'Display name', nullable: true })
  displayName: string | null;

  @ApiProperty({ description: 'Description', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Is public repository' })
  isPublic: boolean;

  @ApiProperty({ description: 'Permission type', enum: ['owner', 'direct', 'group', 'public'] })
  permissionType: 'owner' | 'direct' | 'group' | 'public';

  @ApiProperty({
    description: 'User role',
    enum: ['owner', 'admin', 'contributor', 'viewer'],
    nullable: true,
  })
  role: 'owner' | 'admin' | 'contributor' | 'viewer' | null;

  @ApiProperty({ description: 'Repository statistics' })
  stats: RepositoryStatsDto;

  @ApiProperty({ description: 'Created at' })
  createdAt: string;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: string;
}

export class GetRepositoryFeedResponseDto {
  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of repositories' })
  total: number;

  @ApiProperty({ description: 'List of repositories', type: [FeedRepositoryDto] })
  repositories: FeedRepositoryDto[];
}
