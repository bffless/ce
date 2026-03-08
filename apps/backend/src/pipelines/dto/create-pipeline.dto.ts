import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  IsArray,
  Min,
  MaxLength,
  Matches,
  ValidateNested,
  IsIn,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  HttpMethod,
  ValidatorType,
  ValidatorConfig,
  AuthRequiredConfig,
  RateLimitConfig,
} from '../../db/schema';

/**
 * Auth Required validator configuration DTO
 */
export class AuthRequiredConfigDto implements AuthRequiredConfig {
  @ApiPropertyOptional({
    description: 'Roles that are allowed to access this pipeline (any match grants access)',
    example: ['admin', 'editor'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional({
    description: 'Whether to allow API key authentication',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allowApiKey?: boolean;
}

/**
 * Rate Limit validator configuration DTO
 */
export class RateLimitConfigDto implements RateLimitConfig {
  @ApiProperty({
    description: 'Maximum number of requests allowed in the window',
    example: 100,
  })
  @IsNumber()
  limit: number;

  @ApiProperty({
    description: 'Time window in seconds',
    example: 60,
  })
  @IsNumber()
  windowSeconds: number;

  @ApiPropertyOptional({
    description: 'Key to use for rate limiting',
    enum: ['ip', 'user', 'ip+user'],
    example: 'ip',
  })
  @IsOptional()
  @IsIn(['ip', 'user', 'ip+user'])
  keyBy?: 'ip' | 'user' | 'ip+user';
}

/**
 * Validator configuration DTO (discriminated union)
 * Runtime validation uses class-transformer to pick the right config type
 */
export class ValidatorConfigDto {
  @ApiProperty({
    description: 'Type of validator',
    enum: ['auth_required', 'rate_limit'],
    example: 'auth_required',
  })
  @IsIn(['auth_required', 'rate_limit'])
  type: ValidatorType;

  @ApiProperty({
    description: 'Validator-specific configuration',
    oneOf: [
      { $ref: '#/components/schemas/AuthRequiredConfigDto' },
      { $ref: '#/components/schemas/RateLimitConfigDto' },
    ],
    example: { roles: ['admin'] },
  })
  config: AuthRequiredConfig | RateLimitConfig;
}

/**
 * Convert ValidatorConfigDto to ValidatorConfig (discriminated union)
 * This ensures type safety when passing to the database
 */
export function toValidatorConfig(dto: ValidatorConfigDto): ValidatorConfig {
  if (dto.type === 'auth_required') {
    return {
      type: 'auth_required',
      config: dto.config as AuthRequiredConfig,
    };
  }
  return {
    type: 'rate_limit',
    config: dto.config as RateLimitConfig,
  };
}

export class CreatePipelineDto {
  @ApiProperty({
    description: 'Project ID this pipeline belongs to',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'Pipeline name',
    example: 'Contact Form Handler',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Pipeline description',
    example: 'Handles contact form submissions and sends email notifications',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Path pattern to match requests (e.g., "/api/contact", "/api/users/:id")',
    example: '/api/contact',
  })
  @IsString()
  @MaxLength(255)
  @Matches(/^\/[a-zA-Z0-9\-_\/:*]*$/, {
    message: 'Path pattern must start with / and contain valid URL characters',
  })
  pathPattern: string;

  @ApiPropertyOptional({
    description: 'HTTP methods this pipeline responds to',
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    isArray: true,
    default: ['POST'],
    example: ['POST'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { each: true })
  httpMethods?: HttpMethod[];

  @ApiPropertyOptional({
    description: 'Validators to run before pipeline execution',
    type: [ValidatorConfigDto],
    default: [],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatorConfigDto)
  validators?: ValidatorConfigDto[];

  @ApiPropertyOptional({
    description: 'Whether this pipeline is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Priority order (lower = higher priority)',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
