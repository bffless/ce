import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateDomainDto {
  @ApiPropertyOptional({
    description:
      'Project ID. Required for subdomain and custom domains. Not required for redirect domains.',
  })
  @ValidateIf((o) => o.domainType !== 'redirect')
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Deployment alias (e.g., production, staging)',
  })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({
    description: 'Path within deployment (e.g., /apps/frontend/coverage)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\/[a-zA-Z0-9/_-]*$/, {
    message: 'Path must start with / and contain only alphanumeric, /, _, -',
  })
  path?: string;

  @ApiProperty({
    description: 'Domain name (e.g., coverage.localhost, docs.example.com)',
  })
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, {
    message: 'Invalid domain format',
  })
  domain: string;

  @ApiProperty({
    enum: ['subdomain', 'custom', 'redirect'],
    description:
      'Type of domain: subdomain (e.g., docs.example.com), custom (external domain), or redirect (redirects all traffic to another domain)',
  })
  @IsEnum(['subdomain', 'custom', 'redirect'])
  domainType: 'subdomain' | 'custom' | 'redirect';

  @ApiPropertyOptional({
    description:
      'Target domain for redirect type (e.g., "new-brand.com"). Required when domainType is "redirect".',
  })
  @ValidateIf((o) => o.domainType === 'redirect')
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, {
    message: 'Invalid redirect target domain format',
  })
  redirectTarget?: string;

  @ApiPropertyOptional({ description: 'Enable SSL', default: false })
  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Visibility override. For custom domains, this is forced to true since authentication cookies do not work cross-domain.',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

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
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSpa?: boolean;

  @ApiPropertyOptional({
    description:
      'Mark as primary domain mapping. Only one domain can be primary per workspace. Primary domains serve content on the root domain (PRIMARY_DOMAIN).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({
    description:
      'WWW behavior for primary domains: how to handle www subdomain',
    enum: ['redirect-to-www', 'redirect-to-root', 'serve-both'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['redirect-to-www', 'redirect-to-root', 'serve-both'])
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both' | null;
}
