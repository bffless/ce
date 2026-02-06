import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

export class UpdateDomainDto {
  @ApiPropertyOptional({ description: 'Deployment alias' })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({ description: 'Path within deployment' })
  @IsOptional()
  @IsString()
  @Matches(/^\/[a-zA-Z0-9/_-]*$/)
  path?: string;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Visibility override: true = force public, false = force private, null = inherit from alias/project',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Unauthorized behavior override: null = inherit from alias/project',
    enum: ['not_found', 'redirect_login'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['not_found', 'redirect_login'])
  unauthorizedBehavior?: 'not_found' | 'redirect_login' | null;

  @ApiPropertyOptional({
    description:
      'Required role override: null = inherit from alias/project',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['authenticated', 'viewer', 'contributor', 'admin', 'owner'])
  requiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner' | null;

  @ApiPropertyOptional({
    description:
      'Enable SPA mode: when true, 404s fallback to index.html for client-side routing',
  })
  @IsOptional()
  @IsBoolean()
  isSpa?: boolean;

  @ApiPropertyOptional({
    description:
      'WWW behavior: how to handle www/apex redirects. Applies to primary domains and custom domains.',
    enum: ['redirect-to-www', 'redirect-to-root', 'serve-both'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['redirect-to-www', 'redirect-to-root', 'serve-both'])
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both' | null;

  @ApiPropertyOptional({
    description:
      'Target domain for redirect type (e.g., "new-brand.com"). Only used when domainType is "redirect".',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, {
    message: 'Invalid redirect target domain format',
  })
  redirectTarget?: string;
}
