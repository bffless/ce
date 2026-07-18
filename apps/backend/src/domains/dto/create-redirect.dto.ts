import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsBoolean, Matches } from 'class-validator';
import { INVALID_DOMAIN_MESSAGE, SOURCE_DOMAIN_PATTERN } from './domain-patterns';

export class CreateRedirectDto {
  @ApiProperty({
    description:
      'Source domain that will redirect. May use a leading wildcard label (e.g., *.example.com).',
  })
  @IsString()
  @Matches(SOURCE_DOMAIN_PATTERN, {
    message: INVALID_DOMAIN_MESSAGE,
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
