import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DomainResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  projectId: string;

  @ApiPropertyOptional()
  alias?: string;

  @ApiPropertyOptional()
  path?: string;

  @ApiProperty()
  domain: string;

  @ApiProperty()
  domainType: 'subdomain' | 'custom' | 'redirect';

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({
    description:
      'WWW behavior: how to handle www/apex redirects for custom domains',
    enum: ['redirect-to-www', 'redirect-to-root', 'serve-both'],
    nullable: true,
  })
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both' | null;

  @ApiPropertyOptional({
    description:
      'Target domain for redirect type (e.g., "new-brand.com")',
  })
  redirectTarget?: string;

  @ApiPropertyOptional({
    description:
      'Visibility override: true = force public, false = force private, null = inherit from alias/project',
    nullable: true,
  })
  isPublic?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Unauthorized behavior override: null = inherit from alias/project',
    enum: ['not_found', 'redirect_login'],
    nullable: true,
  })
  unauthorizedBehavior?: 'not_found' | 'redirect_login' | null;

  @ApiPropertyOptional({
    description:
      'Required role override: null = inherit from alias/project',
    enum: ['authenticated', 'viewer', 'contributor', 'admin', 'owner'],
    nullable: true,
  })
  requiredRole?: 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner' | null;

  @ApiPropertyOptional({
    description:
      'Primary domain flag - serves content on the base domain (e.g., example.com, www.example.com)',
  })
  isPrimary?: boolean;

  @ApiProperty({
    description:
      'SPA mode: when true, 404s fallback to index.html for client-side routing',
  })
  isSpa: boolean;

  @ApiProperty()
  sslEnabled: boolean;

  @ApiPropertyOptional()
  sslExpiresAt?: Date;

  @ApiProperty()
  dnsVerified: boolean;

  @ApiPropertyOptional()
  dnsVerifiedAt?: Date;

  @ApiPropertyOptional()
  nginxConfigPath?: string;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Phase B5: Domain visibility info response
 */
export class DomainVisibilityResponseDto {
  @ApiProperty()
  domainId: string;

  @ApiProperty({ description: 'The resolved visibility (public or private)' })
  effectiveVisibility: 'public' | 'private';

  @ApiProperty({
    description: 'Where the visibility setting comes from',
    enum: ['domain', 'alias', 'project'],
  })
  source: 'domain' | 'alias' | 'project';

  @ApiPropertyOptional({
    description: 'Domain-level override (null = inherit)',
    nullable: true,
  })
  domainOverride?: boolean | null;

  @ApiPropertyOptional({
    description: 'Alias-level visibility (null = inherit from project)',
    nullable: true,
  })
  aliasVisibility?: boolean | null;

  @ApiProperty({ description: 'Project-level visibility' })
  projectVisibility: boolean;
}
