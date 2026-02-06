import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  IsOptional,
  IsDateString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateShareLinkDto {
  @ApiPropertyOptional({ description: 'Project ID to scope this share link to' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Domain mapping ID to scope this share link to',
  })
  @IsOptional()
  @IsUUID()
  domainMappingId?: string;

  @ApiPropertyOptional({
    description: 'Human-readable label for the share link',
    example: 'For recruiter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({
    description: 'Expiration date (ISO 8601). Null means never expires.',
    example: '2025-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @ValidateIf((o) => o.expiresAt !== null)
  @IsDateString()
  expiresAt?: string | null;
}
