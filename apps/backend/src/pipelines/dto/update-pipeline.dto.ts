import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsArray,
  Min,
  MaxLength,
  Matches,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HttpMethod } from '../../db/schema';
import { ValidatorConfigDto } from './create-pipeline.dto';

export class UpdatePipelineDto {
  @ApiPropertyOptional({
    description: 'Pipeline name',
    example: 'Contact Form Handler',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Pipeline description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Path pattern to match requests',
    example: '/api/contact',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^\/[a-zA-Z0-9\-_\/:*]*$/, {
    message: 'Path pattern must start with / and contain valid URL characters',
  })
  pathPattern?: string;

  @ApiPropertyOptional({
    description: 'HTTP methods this pipeline responds to',
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { each: true })
  httpMethods?: HttpMethod[];

  @ApiPropertyOptional({
    description: 'Validators to run before pipeline execution',
    type: [ValidatorConfigDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatorConfigDto)
  validators?: ValidatorConfigDto[];

  @ApiPropertyOptional({
    description: 'Whether this pipeline is active',
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Priority order (lower = higher priority)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
