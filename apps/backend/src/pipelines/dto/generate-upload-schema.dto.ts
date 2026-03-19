import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsIn,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';

/**
 * DTO for generating an upload schema with associated pipelines.
 * Creates a schema for file upload metadata with POST (upload) and GET (serve) pipelines.
 */
export class GenerateUploadSchemaDto {
  @ApiProperty({
    description: 'Project ID this schema belongs to',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description:
      'Schema name (unique within project). Use lowercase letters, numbers, and underscores.',
    example: 'product_images',
  })
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
  name: string;

  @ApiProperty({
    description: 'Storage sub-directory name for uploaded files',
    example: 'images',
  })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_-]*$/, {
    message:
      'Sub-directory must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
  })
  subDir: string;

  @ApiPropertyOptional({
    description: 'Enable YYYY-MM-DD date folders in storage path',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dateBucket?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum file size in bytes',
    example: 10485760,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxFileSize?: number;

  @ApiPropertyOptional({
    description: 'Allowed MIME type patterns (e.g. ["image/*", "application/pdf"])',
    example: ['image/*'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedMimeTypes?: string[];

  @ApiPropertyOptional({
    description: 'Access control for the GET (serve) pipeline',
    enum: ['public', 'authenticated', 'role'],
    default: 'public',
  })
  @IsOptional()
  @IsIn(['public', 'authenticated', 'role'])
  accessControl?: 'public' | 'authenticated' | 'role';

  @ApiPropertyOptional({
    description: 'Required role when accessControl is "role"',
  })
  @IsOptional()
  @IsString()
  requiredRole?: string;

  @ApiPropertyOptional({
    description:
      'Existing rule set ID to add pipelines to. If not provided, a new rule set will be created.',
  })
  @IsOptional()
  @IsUUID()
  ruleSetId?: string;
}

/**
 * Response DTO for upload schema generation
 */
export class GenerateUploadSchemaResponseDto {
  @ApiProperty({
    description: 'The created schema',
  })
  schema: {
    id: string;
    name: string;
    projectId: string;
    fields: { name: string; type: string; required: boolean }[];
    createdAt: string;
    updatedAt: string;
  };

  @ApiProperty({
    description: 'The created pipelines',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        path: { type: 'string' },
        method: { type: 'string' },
      },
    },
  })
  pipelines: { id: string; path: string; method: string }[];
}
