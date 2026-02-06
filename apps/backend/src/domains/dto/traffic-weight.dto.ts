import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TrafficWeightItemDto {
  @ApiProperty({ description: 'Alias name' })
  @IsString()
  alias: string;

  @ApiProperty({ description: 'Weight percentage (0-100)' })
  @IsInt()
  @Min(0)
  @Max(100)
  weight: number;
}

export class SetTrafficWeightsDto {
  @ApiProperty({ type: [TrafficWeightItemDto], description: 'Traffic weights (must sum to 100)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrafficWeightItemDto)
  weights: TrafficWeightItemDto[];

  @ApiPropertyOptional({ description: 'Enable sticky sessions', default: true })
  @IsOptional()
  @IsBoolean()
  stickySessionsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Sticky session duration in seconds. 0 = no expiration.', default: 86400 })
  @IsOptional()
  @IsInt()
  @Min(0) // 0 = no expiration
  @Max(2592000) // Maximum 30 days
  stickySessionDuration?: number;
}

export class TrafficWeightResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  domainId: string;

  @ApiProperty()
  alias: string;

  @ApiProperty()
  weight: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TrafficConfigResponseDto {
  @ApiProperty({ type: [TrafficWeightResponseDto] })
  weights: TrafficWeightResponseDto[];

  @ApiProperty()
  stickySessionsEnabled: boolean;

  @ApiProperty()
  stickySessionDuration: number;
}
