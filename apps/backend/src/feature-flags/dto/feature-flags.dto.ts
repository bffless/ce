import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class UpdateFeatureFlagDto {
  @ApiProperty({ description: 'Flag key', example: 'ENABLE_CUSTOM_DOMAINS' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({
    description: 'Flag value (will be parsed according to flag type)',
    example: 'true',
  })
  @IsNotEmpty()
  value: string | number | boolean | object;

  @ApiPropertyOptional({
    description: 'Whether this override is enabled',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class DeleteFeatureFlagDto {
  @ApiProperty({ description: 'Flag key to delete', example: 'ENABLE_CUSTOM_DOMAINS' })
  @IsString()
  @IsNotEmpty()
  key: string;
}

export class FeatureFlagResponseDto {
  @ApiProperty({ description: 'Flag key' })
  key: string;

  @ApiProperty({ description: 'Resolved value' })
  value: boolean | string | number | object;

  @ApiProperty({ description: 'Value type', enum: ['boolean', 'string', 'number', 'json'] })
  type: string;

  @ApiProperty({
    description: 'Source of the value',
    enum: ['default', 'env', 'file', 'database'],
  })
  source: 'default' | 'env' | 'file' | 'database';

  @ApiProperty({ description: 'Flag description' })
  description: string;

  @ApiProperty({ description: 'Flag category' })
  category: string;
}

export class AllFlagsResponseDto {
  @ApiProperty({ type: [FeatureFlagResponseDto] })
  flags: FeatureFlagResponseDto[];
}

export class FeatureFlagSourcesDto {
  @ApiPropertyOptional({ description: 'Value from environment variable' })
  env?: boolean | string | number | object;

  @ApiPropertyOptional({ description: 'Value from config file' })
  file?: boolean | string | number | object;

  @ApiPropertyOptional({ description: 'Value from database' })
  database?: boolean | string | number | object;

  @ApiProperty({ description: 'Default value' })
  default: boolean | string | number | object;

  @ApiProperty({ description: 'Final resolved value' })
  resolved: boolean | string | number | object;

  @ApiProperty({ description: 'Which source provided the resolved value' })
  source: 'default' | 'env' | 'file' | 'database';
}

export class BatchUpdateFlagsDto {
  @ApiProperty({
    description: 'Array of flags to update',
    type: [UpdateFeatureFlagDto],
  })
  flags: UpdateFeatureFlagDto[];
}
