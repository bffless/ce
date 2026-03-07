import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsIn } from 'class-validator';

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

  @ApiProperty({
    description: 'Input data to use for testing',
    example: { email: 'test@example.com', name: 'Test User' },
  })
  @IsObject()
  input: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Headers to include in the test request',
    example: { 'Content-Type': 'application/json' },
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}
