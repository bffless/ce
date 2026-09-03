import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/** RFC 7591 §2 — the subset CE accepts: public clients only. */
export class RegisterClientDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  redirect_uris: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  client_name?: string;

  @ApiPropertyOptional({ default: 'none' })
  @IsOptional()
  @IsIn(['none'])
  token_endpoint_auth_method?: 'none';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn(['authorization_code', 'refresh_token'], { each: true })
  grant_types?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn(['code'], { each: true })
  response_types?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  client_uri?: string;
}

export class ConsentDecisionDto {
  @ApiProperty({ description: 'The pending request (a signed token from /api/oauth/authorize)' })
  @IsString()
  request: string;

  @ApiProperty()
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ type: [String], description: 'A subset of the requested scopes to grant' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  resource_indicators_supported: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface PendingRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  iat: number;
  exp: number;
}
