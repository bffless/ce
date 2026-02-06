import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsDateString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateShareLinkDto {
  @ApiPropertyOptional({
    description: 'Human-readable label for the share link',
    example: 'For recruiter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'Whether the share link is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Expiration date (ISO 8601). Null means never expires.',
    example: '2025-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @ValidateIf((o) => o.expiresAt !== null)
  @IsDateString()
  expiresAt?: string | null;
}
