import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ProxyRuleResponseDto } from './proxy-rule-response.dto';

export class CreateProxyRuleSetDto {
  @ApiProperty({
    description: 'Human-readable name for the rule set',
    example: 'api-backend',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Optional description explaining what this rule set does',
    example: 'Proxy rules for backend API endpoints',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional environment tag for organizing rule sets',
    example: 'production',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  environment?: string;
}

export class UpdateProxyRuleSetDto {
  @ApiPropertyOptional({
    description: 'Human-readable name for the rule set',
    example: 'api-backend',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Optional description explaining what this rule set does',
    example: 'Proxy rules for backend API endpoints',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional environment tag for organizing rule sets',
    example: 'production',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  environment?: string;
}

export class ProxyRuleSetResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string;

  @ApiProperty({ description: 'Project ID this rule set belongs to' })
  projectId: string;

  @ApiProperty({ description: 'Human-readable name for the rule set' })
  name: string;

  @ApiPropertyOptional({ description: 'Optional description' })
  description?: string | null;

  @ApiPropertyOptional({ description: 'Environment tag' })
  environment?: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export class ProxyRuleSetWithRulesResponseDto extends ProxyRuleSetResponseDto {
  @ApiProperty({ type: [ProxyRuleResponseDto], description: 'Rules in this set' })
  rules: ProxyRuleResponseDto[];
}

export class ProxyRuleSetsListResponseDto {
  @ApiProperty({ type: [ProxyRuleSetResponseDto] })
  ruleSets: ProxyRuleSetResponseDto[];
}
