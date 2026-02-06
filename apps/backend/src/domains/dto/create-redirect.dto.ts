import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

export class CreateRedirectDto {
  @ApiProperty({ description: 'Source domain that will redirect' })
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, {
    message: 'Invalid domain format',
  })
  sourceDomain: string;

  @ApiProperty({
    enum: ['301', '302'],
    description: 'Redirect type (301=permanent, 302=temporary)',
  })
  @IsEnum(['301', '302'])
  redirectType: '301' | '302';

  @ApiPropertyOptional({ description: 'Enable SSL for redirect source', default: false })
  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;
}
