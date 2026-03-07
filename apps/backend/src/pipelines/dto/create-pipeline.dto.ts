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
} from 'class-validator';
import { Type } from 'class-transformer';
import { HttpMethod, ValidatorType } from '../../db/schema';

/**
 * Validator configuration DTO
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
    example: { roles: ['admin'] },
  })
  config: Record<string, unknown>;
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
