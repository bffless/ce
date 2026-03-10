import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Mock user configuration for testing pipelines
 */
export class MockUserDto {
  @ApiProperty({
    description: 'User ID to simulate',
    example: 'mock-user-123',
  })
  @IsString()
  id: string;

  @ApiPropertyOptional({
    description: 'User email to simulate',
    example: 'test@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'User role to simulate',
    example: 'admin',
  })
  @IsOptional()
  @IsString()
  role?: string;
}

export class TestPipelineDto {
  @ApiPropertyOptional({
    description: 'HTTP method to simulate',
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    default: 'POST',
  })
  @IsOptional()
  @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method?: string;

  @ApiPropertyOptional({
    description: 'Path to simulate (relative to pipeline path)',
    default: '/',
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({
    description: 'Request body data (for POST/PUT/PATCH)',
    example: { email: 'test@example.com', name: 'Test User' },
  })
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Query parameters',
    example: { page: '1', limit: '10' },
  })
  @IsOptional()
  @IsObject()
  query?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Headers to include in the test request',
    example: { 'Content-Type': 'application/json' },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Mock user to simulate for the test (overrides authenticated user)',
    type: MockUserDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MockUserDto)
  mockUser?: MockUserDto;

  @ApiPropertyOptional({
    description: 'Whether to simulate authentication (use current user or mock user)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  simulateAuth?: boolean;

  @ApiPropertyOptional({
    description: 'Dry run mode - validates without executing side effects (not yet implemented)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * Pipeline step configuration for inline testing
 */
export class PipelineStepConfigDto {
  @ApiProperty({ description: 'Step ID' })
  @IsString()
  id: string;

  @ApiPropertyOptional({ description: 'Step name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Handler type' })
  @IsString()
  handlerType: string;

  @ApiProperty({ description: 'Handler configuration' })
  @IsObject()
  config: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether step is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/**
 * DTO for testing a pipeline configuration directly (without saving first)
 * Used by proxy rules to test embedded pipeline configs
 */
export class TestPipelineConfigDto extends TestPipelineDto {
  @ApiProperty({
    description: 'Project ID for schema/data access',
  })
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'Pipeline steps to execute',
    type: [PipelineStepConfigDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PipelineStepConfigDto)
  steps: PipelineStepConfigDto[];

  @ApiPropertyOptional({
    description: 'Pipeline name (for debug output)',
  })
  @IsOptional()
  @IsString()
  pipelineName?: string;
}
