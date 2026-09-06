import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SCOPE_PATTERN } from '../pipelines/types';

export const APP_TOKEN_DEFAULT_TTL_DAYS = 90;
export const APP_TOKEN_MAX_TTL_DAYS = 365;
export const APP_TOKEN_LIST_DEFAULT_LIMIT = 50;
export const APP_TOKEN_LIST_MAX_LIMIT = 200;

export class CreateAppTokenDto {
  @ApiProperty({
    description: 'A name for the token',
    example: 'Claude — workflow',
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'The project the token is bound to (owner/repo)',
    example: 'bffless/workflow',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    message: 'project must be in the form owner/repo',
  })
  project: string;

  @ApiProperty({
    description:
      'Scopes the token is delegated (the app’s own vocabulary, namespace:verb). The `auth:` namespace is CE’s: `auth:session` lets the token be exchanged for a session via POST /api/auth/session/from-app-token.',
    example: ['workflow:read', 'workflow:run', 'auth:session'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(SCOPE_PATTERN, { each: true, message: 'each scope must be namespace:verb' })
  scopes: string[];

  @ApiPropertyOptional({
    description: `Expiry (ISO-8601). Defaults to ${APP_TOKEN_DEFAULT_TTL_DAYS} days; at most ${APP_TOKEN_MAX_TTL_DAYS} days ahead.`,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** Query for `GET /api/app-tokens`. Every parameter is optional: a bare GET lists the first page of active tokens. */
export class ListAppTokensQueryDto {
  @ApiPropertyOptional({
    description:
      'Also list revoked and expired tokens. Off by default: only tokens that can still authenticate are returned.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({
    description: 'Page size.',
    default: APP_TOKEN_LIST_DEFAULT_LIMIT,
    minimum: 1,
    maximum: APP_TOKEN_LIST_MAX_LIMIT,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(APP_TOKEN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'The `nextCursor` of the previous page (the id of its last token). Pages are newest-first.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export interface AppTokenView {
  id: string;
  name: string;
  tokenPrefix: string;
  project: { id: string; owner: string; name: string };
  scopes: string[];
  kind: string;
  clientId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateAppTokenResponse {
  data: AppTokenView;
  /** The raw token — returned once, never stored. */
  token: string;
}

export interface ListAppTokensResponse {
  data: AppTokenView[];
  /** Pass as `?cursor=` to fetch the next page; `null` on the last page. */
  nextCursor: string | null;
}
