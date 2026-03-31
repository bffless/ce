import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsIn,
  IsArray,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateResponseHeaderRuleDto {
  @ApiProperty({
    description: 'Glob pattern to match request paths. Examples: "embed/**", "*.html", "widget/*"',
    example: 'embed/**',
  })
  @IsString()
  @MaxLength(500)
  pathPattern: string;

  @ApiPropertyOptional({
    description:
      'Frame embedding policy. "sameorigin" = same-origin only, "allow" = allow specific origins, "deny" = block all framing',
    enum: ['sameorigin', 'allow', 'deny'],
    default: 'sameorigin',
  })
  @IsOptional()
  @IsIn(['sameorigin', 'allow', 'deny'])
  framePolicy?: 'sameorigin' | 'allow' | 'deny';

  @ApiPropertyOptional({
    description:
      'Origins allowed to iframe content when framePolicy is "allow". Each entry should be a full origin like "https://example.com"',
    example: ['https://www.example.com', 'https://example.com'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    description:
      'Custom response headers to set. Key-value pairs. Set value to null to remove a default header.',
    example: { 'X-Custom-Header': 'value' },
  })
  @IsOptional()
  @IsObject()
  customHeaders?: Record<string, string | null>;

  @ApiPropertyOptional({
    description: 'Rule priority. Lower = higher priority (evaluated first).',
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    description: 'Whether this rule is enabled',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Human-readable name for the rule',
    example: 'Allow chat widget embedding',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Description explaining the rule purpose',
    example: 'Allow Wix site to embed the chat widget iframe',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
