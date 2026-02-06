import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateRedirectDto {
  @ApiPropertyOptional({ enum: ['301', '302'], description: 'Redirect type' })
  @IsOptional()
  @IsEnum(['301', '302'])
  redirectType?: '301' | '302';

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Enable SSL' })
  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;
}
