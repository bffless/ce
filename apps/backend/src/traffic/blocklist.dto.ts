import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  BLOCKLIST_MATCH_TYPES,
  BLOCKLIST_VALUE_MAX_LENGTH,
  BlocklistMatchType,
} from './blocklist-compiler';

/** Guard against a pathological payload; real lists are tens of patterns. */
const MAX_ENTRIES_PER_LIST = 1_000;

export class BlocklistPatternEntryDto {
  @ApiProperty({ enum: BLOCKLIST_MATCH_TYPES, default: 'prefix' })
  @IsIn(BLOCKLIST_MATCH_TYPES)
  matchType: BlocklistMatchType = 'prefix';

  @ApiProperty({ description: 'The literal path fragment to match (strict charset, escaped by the compiler)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BLOCKLIST_VALUE_MAX_LENGTH)
  value!: string;
}

export class CreateBlocklistDto {
  @ApiProperty({ description: 'Unique name for the Blocklist' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Apply to all domains (default attachment). Defaults to true.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [BlocklistPatternEntryDto], description: 'Block patterns' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES_PER_LIST)
  @ValidateNested({ each: true })
  @Type(() => BlocklistPatternEntryDto)
  entries?: BlocklistPatternEntryDto[];

  @ApiPropertyOptional({
    type: [BlocklistPatternEntryDto],
    description: 'Allowlist exceptions that always win over any block pattern',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES_PER_LIST)
  @ValidateNested({ each: true })
  @Type(() => BlocklistPatternEntryDto)
  allowlist?: BlocklistPatternEntryDto[];
}

export class UpdateBlocklistDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @ApiPropertyOptional({ description: 'Apply to all domains (default attachment)' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [BlocklistPatternEntryDto], description: 'Replaces all block patterns when present' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES_PER_LIST)
  @ValidateNested({ each: true })
  @Type(() => BlocklistPatternEntryDto)
  entries?: BlocklistPatternEntryDto[];

  @ApiPropertyOptional({ type: [BlocklistPatternEntryDto], description: 'Replaces the allowlist when present' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES_PER_LIST)
  @ValidateNested({ each: true })
  @Type(() => BlocklistPatternEntryDto)
  allowlist?: BlocklistPatternEntryDto[];
}

export class UpdateBlocklistSettingsDto {
  @ApiProperty({ description: 'Master toggle: false disables ALL blocking instantly' })
  @IsBoolean()
  enabled!: boolean;
}

/** Inline "add to blocklist" from the Traffic views (#393): one block pattern. */
export class AppendBlocklistEntryDto extends BlocklistPatternEntryDto {}

/** Replace-all attachment of Blocklists to a domain mapping (#393). */
export class SyncDomainBlocklistsDto {
  @ApiProperty({ type: [String], description: 'Blocklist ids attached to the domain (replaces the set)' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  blocklistIds!: string[];
}
