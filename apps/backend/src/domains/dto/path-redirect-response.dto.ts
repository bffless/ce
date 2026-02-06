import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PathRedirectResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string;

  @ApiProperty({ description: 'Domain mapping ID this redirect belongs to' })
  domainMappingId: string;

  @ApiProperty({ description: 'Source path that triggers the redirect' })
  sourcePath: string;

  @ApiProperty({ description: 'Target path to redirect to' })
  targetPath: string;

  @ApiProperty({ enum: ['301', '302'], description: 'Redirect type' })
  redirectType: '301' | '302';

  @ApiProperty({ description: 'Whether this redirect is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Priority for matching (lower = higher priority)' })
  priority: string;

  @ApiPropertyOptional({ description: 'User who created this redirect' })
  createdBy: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Domain this redirect is associated with' })
  domain?: string;
}
