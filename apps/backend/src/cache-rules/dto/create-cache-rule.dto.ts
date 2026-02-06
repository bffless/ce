import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsInt, IsOptional, Min, Max, IsIn, MaxLength } from 'class-validator';

export class CreateCacheRuleDto {
  @ApiProperty({
    description:
      'Glob pattern to match request paths. Examples: "*.js", "*.css", "images/**", "index.html"',
    example: '*.js',
  })
  @IsString()
  @MaxLength(500)
  pathPattern: string;

  @ApiPropertyOptional({
    description: 'Browser cache max-age in seconds (0 = no-cache, always revalidate)',
    default: 300,
    example: 86400,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31536000) // 1 year max
  browserMaxAge?: number;

  @ApiPropertyOptional({
    description:
      'CDN/proxy cache max-age in seconds (s-maxage directive). Null = use browserMaxAge.',
    example: 604800,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31536000)
  cdnMaxAge?: number | null;

  @ApiPropertyOptional({
    description:
      'Stale-while-revalidate duration in seconds. CDN serves stale content while fetching fresh in background.',
    example: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400) // 1 day max
  staleWhileRevalidate?: number | null;

  @ApiPropertyOptional({
    description:
      'Whether content is immutable (no revalidation needed). Use for content-hashed files like main.abc123.js',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  immutable?: boolean;

  @ApiPropertyOptional({
    description:
      'Cache directive: "public" (CDNs can cache) or "private" (browser only). Null = inherit from project visibility.',
    enum: ['public', 'private', null],
    example: 'public',
  })
  @IsOptional()
  @IsIn(['public', 'private', null])
  cacheability?: 'public' | 'private' | null;

  @ApiPropertyOptional({
    description: 'Rule priority. Lower = higher priority (evaluated first).',
    default: 100,
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    description: 'Whether this rule is enabled',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Human-readable name for the rule',
    example: 'Hashed JavaScript bundles',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Description explaining the rule purpose',
    example: 'Cache content-hashed JS files for 1 year since they are immutable',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
