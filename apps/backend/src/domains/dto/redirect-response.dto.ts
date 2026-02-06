import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RedirectResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sourceDomain: string;

  @ApiProperty()
  targetDomainId: string;

  @ApiProperty({ enum: ['301', '302'] })
  redirectType: '301' | '302';

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  sslEnabled: boolean;

  @ApiPropertyOptional()
  nginxConfigPath?: string | null;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  // Computed/joined fields
  @ApiPropertyOptional()
  targetDomain?: string;
}
