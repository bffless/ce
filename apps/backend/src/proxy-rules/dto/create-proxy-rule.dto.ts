import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  Max,
  Matches,
  ValidateNested,
  IsObject,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Custom validator for target URLs.
 * - Allows HTTPS for any external URL
 * - Allows HTTP for internal K8s service URLs (*.svc, *.svc.cluster.local)
 * - Allows HTTP for localhost/127.0.0.1 (same-pod sidecar communication)
 */
@ValidatorConstraint({ name: 'isValidTargetUrl', async: false })
export class IsValidTargetUrl implements ValidatorConstraintInterface {
  validate(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Allow HTTPS for any URL
      if (parsed.protocol === 'https:') {
        return true;
      }

      // Allow HTTP only for internal/trusted URLs
      if (parsed.protocol === 'http:') {
        const hostname = parsed.hostname;
        // Match *.svc or *.svc.cluster.local patterns (K8s internal services)
        if (hostname.endsWith('.svc') || hostname.endsWith('.svc.cluster.local')) {
          return true;
        }
        // Allow localhost/127.0.0.1 for same-pod sidecar communication
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be HTTPS, or HTTP for internal services (*.svc, localhost)`;
  }
}

export class HeaderConfigDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Headers to forward from the original request',
    example: ['accept', 'content-type', 'authorization'],
  })
  @IsOptional()
  @IsString({ each: true })
  forward?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Headers to remove before forwarding',
    example: ['cookie', 'host'],
  })
  @IsOptional()
  @IsString({ each: true })
  strip?: string[];

  @ApiPropertyOptional({
    description: 'Headers to add to the proxied request (values will be encrypted)',
    example: { 'X-API-Key': 'sk_live_xxx', Authorization: 'Bearer token' },
  })
  @IsOptional()
  @IsObject()
  add?: Record<string, string>;
}

/**
 * Auth transformation configuration for nginx-level proxying.
 * When set, the proxy rule is rendered as an nginx location block
 * with cookie-to-bearer token transformation.
 */
export class AuthTransformConfigDto {
  @ApiProperty({
    description: 'Type of auth transformation',
    enum: ['cookie-to-bearer'],
    example: 'cookie-to-bearer',
  })
  @IsString()
  @Matches(/^cookie-to-bearer$/, { message: 'type must be "cookie-to-bearer"' })
  type: 'cookie-to-bearer';

  @ApiProperty({
    description: 'Name of the cookie to extract',
    example: 'sAccessToken',
  })
  @IsString()
  cookieName: string;
}

export class CreateProxyRuleDto {
  @ApiProperty({
    description: 'Rule set ID that this rule belongs to',
  })
  @IsUUID()
  ruleSetId: string;

  @ApiProperty({
    description:
      'Path pattern to match. Supports exact (/graphql), prefix (/api/*), and suffix (*.json)',
    example: '/api/*',
  })
  @IsString()
  @Matches(/^(\/[a-zA-Z0-9\-_\/\*\.]*|\*[a-zA-Z0-9\-_\/\.]*)$/, {
    message: 'Path pattern must start with / or * and contain valid URL characters',
  })
  pathPattern: string;

  @ApiProperty({
    description:
      'Target URL to forward requests to. Must be HTTPS, or HTTP for internal K8s services.',
    example: 'https://api.example.com',
  })
  @Validate(IsValidTargetUrl)
  targetUrl: string;

  @ApiPropertyOptional({
    description: 'Remove matched prefix from path before forwarding',
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  stripPrefix?: boolean;

  @ApiPropertyOptional({
    description: 'Rule evaluation order (lower = first)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({
    description: 'Request timeout in milliseconds (1000-60000)',
    default: 30000,
    example: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeout?: number;

  @ApiPropertyOptional({
    description: 'Preserve original Host header instead of using target host',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  preserveHost?: boolean;

  @ApiPropertyOptional({
    description:
      'Forward cookies to the target (enable for session-based auth proxying to trusted backends)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forwardCookies?: boolean;

  @ApiPropertyOptional({
    description: 'Header configuration (forward, strip, add)',
    type: HeaderConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderConfigDto)
  headerConfig?: HeaderConfigDto;

  @ApiPropertyOptional({
    description:
      'Auth transformation for nginx-level proxying. Extracts cookie and adds as Bearer token.',
    type: AuthTransformConfigDto,
    example: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuthTransformConfigDto)
  authTransform?: AuthTransformConfigDto;

  @ApiPropertyOptional({
    description: 'Optional description for documentation',
    example: 'Main backend API',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether this rule is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/**
 * DTO for creating a rule within a rule set via the URL path.
 * The ruleSetId is provided via the URL parameter, not the body.
 */
export class CreateProxyRuleInSetDto extends OmitType(CreateProxyRuleDto, ['ruleSetId'] as const) {}
