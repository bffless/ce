import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateProxyRuleSetDto } from './proxy-rule-set.dto';
import { CreateProxyRuleInSetDto } from './create-proxy-rule.dto';
import { SchemaFieldDto } from '../../pipelines/dto/create-pipeline-schema.dto';

/**
 * Resolution for one schema dependency bundled in the export. The pipeline rules
 * still carry the original (source) schema id; the import remaps them to the
 * resolved target schema id (an existing one, or a freshly created one).
 */
export class ImportSchemaResolutionDto {
  @ApiProperty({ description: 'Original schema id as referenced in the exported rules' })
  @IsUUID()
  sourceId: string;

  @ApiProperty({ description: 'Schema name from the export' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ type: [SchemaFieldDto], description: 'Schema field definitions from the export' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields: SchemaFieldDto[];

  @ApiProperty({
    description: 'Reuse an existing schema in the target project, or create a fresh one',
    enum: ['reuse', 'create'],
  })
  @IsIn(['reuse', 'create'])
  action: 'reuse' | 'create';

  @ApiPropertyOptional({ description: 'Target schema id to map to (required when action=reuse)' })
  @IsOptional()
  @IsUUID()
  targetSchemaId?: string;
}

/**
 * DTO for importing a rule set from an exported JSON definition.
 *
 * Mirrors the envelope produced by the admin UI's "Export" action. The
 * top-level metadata fields (`version`, `exportedAt`, `kind`) are accepted but
 * ignored — they exist so a raw export file can be POSTed without stripping.
 */
export class ImportProxyRuleSetDto {
  @ApiPropertyOptional({ description: 'Export format version', example: 1 })
  @IsOptional()
  @IsInt()
  version?: number;

  @ApiPropertyOptional({ description: 'ISO timestamp the export was created' })
  @IsOptional()
  @IsString()
  exportedAt?: string;

  @ApiPropertyOptional({ description: 'Export kind discriminator' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiProperty({ type: CreateProxyRuleSetDto, description: 'Rule set metadata' })
  @ValidateNested()
  @Type(() => CreateProxyRuleSetDto)
  ruleSet: CreateProxyRuleSetDto;

  @ApiProperty({ type: [CreateProxyRuleInSetDto], description: 'Rules to import into the set' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProxyRuleInSetDto)
  rules: CreateProxyRuleInSetDto[];

  @ApiPropertyOptional({
    type: [ImportSchemaResolutionDto],
    description:
      'Schema dependencies bundled in the export, with how to resolve each in the target project',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportSchemaResolutionDto)
  schemas?: ImportSchemaResolutionDto[];
}
