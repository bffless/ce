import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HeaderConfigDto } from './create-proxy-rule.dto';

export class ProxyRuleResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string;

  @ApiProperty({ description: 'Rule set ID this rule belongs to' })
  ruleSetId: string;

  @ApiProperty({ description: 'Path pattern to match', example: '/api/*' })
  pathPattern: string;

  @ApiProperty({ description: 'Target URL to forward requests to' })
  targetUrl: string;

  @ApiProperty({ description: 'Remove matched prefix from path' })
  stripPrefix: boolean;

  @ApiProperty({ description: 'Rule evaluation order' })
  order: number;

  @ApiProperty({ description: 'Request timeout in milliseconds' })
  timeout: number;

  @ApiProperty({ description: 'Preserve original Host header' })
  preserveHost: boolean;

  @ApiProperty({ description: 'Forward cookies to the target' })
  forwardCookies: boolean;

  @ApiPropertyOptional({ description: 'Header configuration', type: HeaderConfigDto })
  headerConfig?: HeaderConfigDto | null;

  @ApiProperty({ description: 'Whether this rule is active' })
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Optional description' })
  description?: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export class ProxyRulesListResponseDto {
  @ApiProperty({ type: [ProxyRuleResponseDto] })
  rules: ProxyRuleResponseDto[];
}
