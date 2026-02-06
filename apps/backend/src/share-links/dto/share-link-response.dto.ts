import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShareLinkResponseDto {
  @ApiProperty({ description: 'Share link ID' })
  id: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  projectId: string | null;

  @ApiPropertyOptional({ description: 'Domain mapping ID' })
  domainMappingId: string | null;

  @ApiProperty({ description: 'Share token' })
  token: string;

  @ApiPropertyOptional({ description: 'Human-readable label' })
  label: string | null;

  @ApiProperty({ description: 'Whether the share link is active' })
  isActive: boolean;

  @ApiPropertyOptional({ description: 'Expiration date' })
  expiresAt: string | null;

  @ApiPropertyOptional({ description: 'Last used date' })
  lastUsedAt: string | null;

  @ApiProperty({ description: 'Number of times the link has been used' })
  useCount: number;

  @ApiProperty({ description: 'User ID who created the link' })
  createdBy: string;

  @ApiProperty({ description: 'Created date' })
  createdAt: string;

  @ApiProperty({ description: 'Updated date' })
  updatedAt: string;
}
