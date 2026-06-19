import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateProxyRuleSetDto } from './proxy-rule-set.dto';
import { CreateProxyRuleInSetDto } from './create-proxy-rule.dto';

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
}
