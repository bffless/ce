import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsBoolean, Matches, Length } from 'class-validator';

export class CreatePathRedirectDto {
  @ApiProperty({
    description: 'Source path to match (supports wildcards like /old-blog/*)',
    example: '/old-page',
  })
  @IsString()
  @Length(1, 500)
  @Matches(/^\//, { message: 'Source path must start with /' })
  sourcePath: string;

  @ApiProperty({
    description: 'Target path to redirect to (/new-page or /blog/$1 for wildcard replacement)',
    example: '/new-page',
  })
  @IsString()
  @Length(1, 500)
  @Matches(/^\//, { message: 'Target path must start with /' })
  targetPath: string;

  @ApiPropertyOptional({
    enum: ['301', '302'],
    description: 'Redirect type (301=permanent, 302=temporary)',
    default: '301',
  })
  @IsOptional()
  @IsEnum(['301', '302'])
  redirectType?: '301' | '302';

  @ApiPropertyOptional({
    description: 'Whether this redirect is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Priority for matching (lower = higher priority)',
    default: '100',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Priority must be a number string' })
  priority?: string;
}
