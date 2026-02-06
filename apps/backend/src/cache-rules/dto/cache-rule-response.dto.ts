import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CacheRuleResponseDto {
  @ApiProperty({ description: 'Cache rule ID' })
  id: string;

  @ApiProperty({ description: 'Project ID this rule belongs to' })
  projectId: string;

  @ApiProperty({ description: 'Glob pattern to match request paths' })
  pathPattern: string;

  @ApiProperty({ description: 'Browser cache max-age in seconds' })
  browserMaxAge: number;

  @ApiPropertyOptional({ description: 'CDN/proxy cache max-age in seconds (s-maxage directive)' })
  cdnMaxAge: number | null;

  @ApiPropertyOptional({ description: 'Stale-while-revalidate duration in seconds' })
  staleWhileRevalidate: number | null;

  @ApiProperty({ description: 'Whether content is immutable' })
  immutable: boolean;

  @ApiPropertyOptional({ description: 'Cache directive: public, private, or null (inherit)' })
  cacheability: 'public' | 'private' | null;

  @ApiProperty({ description: 'Rule priority (lower = higher priority)' })
  priority: number;

  @ApiProperty({ description: 'Whether this rule is enabled' })
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Human-readable name for the rule' })
  name: string | null;

  @ApiPropertyOptional({ description: 'Description of the rule' })
  description: string | null;

  @ApiProperty({ description: 'Rule creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Rule last updated timestamp' })
  updatedAt: Date;
}
