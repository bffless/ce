import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class RedisConfigDto {
  @ApiProperty({ example: 'localhost', description: 'Redis host' })
  @IsString()
  host: string;

  @ApiProperty({ example: 6379, description: 'Redis port' })
  @IsNumber()
  port: number;

  @ApiPropertyOptional({ description: 'Redis password (optional for local Docker)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ default: 0, description: 'Redis database number' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(15)
  db?: number;

  @ApiPropertyOptional({ description: 'Key prefix for workspace isolation (managed Redis)' })
  @IsOptional()
  @IsString()
  keyPrefix?: string;
}

export class CacheConfigDto {
  @ApiProperty({ description: 'Enable caching', default: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    enum: ['memory', 'redis'],
    default: 'memory',
    description: 'Cache backend type',
  })
  @IsEnum(['memory', 'redis'])
  type: 'memory' | 'redis';

  @ApiPropertyOptional({
    enum: ['local', 'external', 'managed'],
    default: 'local',
    description: 'Redis source: local Docker, external provider, or platform-managed',
  })
  @IsOptional()
  @IsEnum(['local', 'external', 'managed'])
  redisSource?: 'local' | 'external' | 'managed';

  @ApiPropertyOptional({
    description: 'Default TTL in seconds',
    default: 86400,
    minimum: 60,
    maximum: 86400,
  })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(86400)
  defaultTtl?: number;

  @ApiPropertyOptional({
    description: 'Max cache size in MB (memory cache only)',
    default: 100,
    minimum: 10,
    maximum: 1000,
  })
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(1000)
  maxSizeMb?: number;

  @ApiPropertyOptional({
    description: 'Max file size to cache in MB (files larger than this are not cached)',
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxFileSizeMb?: number;

  @ApiPropertyOptional({ description: 'Redis connection configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RedisConfigDto)
  redis?: RedisConfigDto;
}

// Response DTO for cache config (masks sensitive data)
export class CacheConfigResponseDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  type: 'memory' | 'redis';

  @ApiPropertyOptional()
  redisSource?: 'local' | 'external' | 'managed';

  @ApiPropertyOptional()
  defaultTtl?: number;

  @ApiPropertyOptional()
  maxSizeMb?: number;

  @ApiPropertyOptional()
  maxFileSizeMb?: number;

  @ApiPropertyOptional({ description: 'Redis host (password masked)' })
  redisHost?: string;

  @ApiPropertyOptional()
  redisPort?: number;

  @ApiProperty()
  isConfigured: boolean;
}

// Test connection request
export class TestRedisConnectionDto {
  @ApiProperty()
  @IsString()
  host: string;

  @ApiProperty()
  @IsNumber()
  port: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  db?: number;

  @ApiPropertyOptional({
    description: 'Use the REDIS_PASSWORD from server environment (for local Docker Redis)',
  })
  @IsOptional()
  @IsBoolean()
  useLocalPassword?: boolean;

  @ApiPropertyOptional({
    description: 'Use the MANAGED_REDIS_* env vars from server environment (for platform-managed Redis)',
  })
  @IsOptional()
  @IsBoolean()
  useManagedConfig?: boolean;
}

// Test connection response
export class TestRedisConnectionResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional()
  latencyMs?: number;

  @ApiPropertyOptional()
  error?: string;
}

// Redis defaults response
export class RedisDefaultsResponseDto {
  @ApiProperty()
  host: string;

  @ApiProperty()
  port: number;

  @ApiProperty()
  isDocker: boolean;
}

// Cache stats response
export class CacheStatsResponseDto {
  @ApiProperty()
  hits: number;

  @ApiProperty()
  misses: number;

  @ApiProperty()
  hitRate: number;

  @ApiProperty()
  size: number;

  @ApiProperty()
  maxSize: number;

  @ApiProperty()
  itemCount: number;

  @ApiProperty()
  formattedSize: string;
}

// Clear cache response
export class ClearCacheResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  clearedItems: number;
}
