import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export enum AIProviderEnum {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
}

export class AIConfigDto {
  @ApiProperty({
    description: 'API key for the AI provider',
    example: 'sk-xxx...',
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiPropertyOptional({
    description: 'Default model to use (free text, can be any model ID)',
    example: 'gpt-5.4',
  })
  @IsString()
  @IsOptional()
  defaultModel?: string;
}

export class AddAIProviderDto {
  @ApiProperty({
    description: 'AI provider type',
    enum: AIProviderEnum,
    example: 'openai',
  })
  @IsEnum(AIProviderEnum)
  @IsNotEmpty()
  provider: AIProviderEnum;

  @ApiProperty({
    description: 'Provider-specific configuration',
    type: AIConfigDto,
  })
  @IsObject()
  @IsNotEmpty()
  config: AIConfigDto;

  @ApiPropertyOptional({
    description: 'Set as default provider',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

// Legacy DTO for backwards compatibility
export class UpdateAISettingsDto extends AddAIProviderDto {}

export class UpdateAIProviderDto {
  @ApiPropertyOptional({
    description: 'Update provider configuration',
    type: AIConfigDto,
  })
  @IsObject()
  @IsOptional()
  config?: Partial<AIConfigDto>;

  @ApiPropertyOptional({
    description: 'Set as default provider',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class SetDefaultProviderDto {
  @ApiProperty({
    description: 'Provider to set as default',
    enum: AIProviderEnum,
    example: 'openai',
  })
  @IsEnum(AIProviderEnum)
  @IsNotEmpty()
  provider: AIProviderEnum;
}

export class TestAIProviderDto {
  @ApiPropertyOptional({
    description: 'Provider to test (defaults to default provider)',
    enum: AIProviderEnum,
  })
  @IsEnum(AIProviderEnum)
  @IsOptional()
  provider?: AIProviderEnum;
}

export class ConfiguredProviderDto {
  @ApiProperty({ description: 'Provider ID', example: 'openai' })
  provider: string;

  @ApiProperty({ description: 'Provider display name', example: 'OpenAI' })
  providerName: string;

  @ApiProperty({ description: 'Masked API key', example: 'sk-x...xxxx' })
  apiKey: string;

  @ApiPropertyOptional({ description: 'Default model', example: 'gpt-5.4' })
  defaultModel?: string;

  @ApiProperty({ description: 'Is this the default provider', example: true })
  isDefault: boolean;

  @ApiProperty({
    description: 'Suggested models for this provider',
    type: [Object],
  })
  suggestedModels: {
    id: string;
    name: string;
    tier: 'economy' | 'balanced' | 'premium';
    description: string;
  }[];
}

export class AIStatusResponseDto {
  @ApiProperty({ description: 'Whether any AI provider is configured', example: true })
  hasAIConfigured: boolean;

  @ApiProperty({
    description: 'Configured AI providers',
    type: [ConfiguredProviderDto],
  })
  providers: ConfiguredProviderDto[];

  @ApiPropertyOptional({ description: 'Default provider ID', example: 'openai' })
  defaultProvider?: string;
}

export class TestAIResponseDto {
  @ApiProperty({ description: 'Whether the test was successful', example: true })
  success: boolean;

  @ApiProperty({ description: 'Test result message', example: 'Connection successful' })
  message: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Connection latency in ms', example: 150 })
  latencyMs?: number;

  @ApiPropertyOptional({ description: 'Model used for test', example: 'gpt-5.4' })
  model?: string;
}

export class ModelInfoDto {
  @ApiProperty({ description: 'Model ID', example: 'gpt-5.4' })
  id: string;

  @ApiProperty({ description: 'Model display name', example: 'GPT-5.4' })
  name: string;

  @ApiProperty({
    description: 'Model tier: economy (fast/cheap), balanced, premium (most capable)',
    enum: ['economy', 'balanced', 'premium'],
    example: 'premium',
  })
  tier: 'economy' | 'balanced' | 'premium';

  @ApiProperty({ description: 'Model description', example: 'Most capable, complex reasoning' })
  description: string;
}

export class AIProviderInfoDto {
  @ApiProperty({ description: 'Provider ID', example: 'openai' })
  provider: string;

  @ApiProperty({ description: 'Provider display name', example: 'OpenAI' })
  displayName: string;

  @ApiProperty({ description: 'Provider description', example: 'GPT-5.4, GPT-5.3, and GPT-4o models' })
  description: string;

  @ApiProperty({
    description: 'Suggested models with tier information',
    type: [ModelInfoDto],
  })
  models: ModelInfoDto[];
}

export class AIProvidersResponseDto {
  @ApiProperty({
    description: 'Available AI providers',
    type: [AIProviderInfoDto],
  })
  providers: AIProviderInfoDto[];
}
