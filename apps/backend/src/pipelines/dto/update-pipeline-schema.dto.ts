import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
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
    description: 'Field definitions',
    type: [SchemaFieldDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields?: SchemaFieldDto[];
}
