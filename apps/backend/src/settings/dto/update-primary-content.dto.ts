import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, IsIn, Matches } from 'class-validator';

export class UpdatePrimaryContentDto {
  @ApiPropertyOptional({ description: 'Enable primary content routing' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Project ID to serve' })
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({ description: 'Deployment alias (e.g., production)' })
  @IsOptional()
  @IsString()
  alias?: string | null;

  @ApiPropertyOptional({ description: 'Path within deployment' })
  @IsOptional()
  @IsString()
  @Matches(/^(\/[a-zA-Z0-9/_-]*)?$/, {
    message: 'Path must start with / and contain only alphanumeric, /, _, -',
  })
  path?: string | null;

  @ApiPropertyOptional({
    description: 'Enable www subdomain support',
  })
  @IsOptional()
  @IsBoolean()
  wwwEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'www redirect behavior (only applies when wwwEnabled is true)',
    enum: ['redirect-to-www', 'redirect-to-root', 'serve-both'],
  })
  @IsOptional()
  @IsIn(['redirect-to-www', 'redirect-to-root', 'serve-both'])
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';

  @ApiPropertyOptional({
    description: 'Enable SPA mode (404s fallback to index.html)',
  })
  @IsOptional()
  @IsBoolean()
  isSpa?: boolean;
}
