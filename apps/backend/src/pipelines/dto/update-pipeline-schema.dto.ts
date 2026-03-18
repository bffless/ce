import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchemaFieldDto } from './create-pipeline-schema.dto';

export class UpdatePipelineSchemaDto {
  @ApiPropertyOptional({
    description: 'Schema name (unique within project)',
    example: 'contacts',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Schema version number. Bump when fields change to track which records were created under which schema definition.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description: 'Field definitions',
    type: [SchemaFieldDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields?: SchemaFieldDto[];
}
