import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsArray,
  MaxLength,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchemaFieldType, SchemaKind } from '../../db/schema';

/**
 * Schema field definition DTO
 */
export class SchemaFieldDto {
  @ApiProperty({
    description: 'Field name',
    example: 'email',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Field type',
    enum: ['string', 'number', 'boolean', 'email', 'text', 'datetime', 'json'],
    example: 'email',
  })
  @IsIn(['string', 'number', 'boolean', 'email', 'text', 'datetime', 'json'])
  type: SchemaFieldType;

  @ApiPropertyOptional({
    description: 'Whether this field is required',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    description: 'Default value for this field',
  })
  @IsOptional()
  default?: unknown;
}

export class CreatePipelineSchemaDto {
  @ApiProperty({
    description: 'Project ID this schema belongs to',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'Schema name (unique within project)',
    example: 'contacts',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Field definitions',
    type: [SchemaFieldDto],
    example: [
      { name: 'email', type: 'email', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'message', type: 'text', required: false },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields: SchemaFieldDto[];

  @ApiPropertyOptional({
    description:
      'What this schema is for. Declares primary intent — an upload schema may still ' +
      'hold rows that are not files. Omit for a plain data schema; it cannot be inferred ' +
      'later without guessing from field names.',
    enum: ['upload', 'chat', 'state'],
  })
  @IsOptional()
  @IsIn(['upload', 'chat', 'state'])
  kind?: SchemaKind;
}
