import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsObject,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { HandlerType } from '../../db/schema';

export class UpdatePipelineStepDto {
  @ApiPropertyOptional({
    description: 'Step name for referencing output in expressions',
    example: 'createRecord',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Type of handler to execute',
    enum: [
      'form_handler',
      'data_create',
      'data_query',
      'data_update',
      'data_delete',
      'email_handler',
      'response_handler',
      'function_handler',
      'aggregate_handler',
    ],
  })
  @IsOptional()
  @IsIn([
    'form_handler',
    'data_create',
    'data_query',
    'data_update',
    'data_delete',
    'email_handler',
    'response_handler',
    'function_handler',
    'aggregate_handler',
  ])
  handlerType?: HandlerType;

  @ApiPropertyOptional({
    description: 'Handler-specific configuration',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Execution order within the pipeline',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({
    description: 'Whether this step is active',
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
