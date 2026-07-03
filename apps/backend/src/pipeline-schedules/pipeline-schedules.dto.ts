import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO for creating a pipeline schedule.
 */
export class CreatePipelineScheduleDto {
  @ApiProperty({ description: 'User-friendly name', example: 'Refresh feeds every 15 min' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Proxy rule (with a pipeline) to run on cadence' })
  @IsUUID()
  targetProxyRuleId: string;

  @ApiProperty({ description: 'Cron expression (5 or 6 field)', example: '*/15 * * * *' })
  @IsString()
  @MaxLength(120)
  cronExpression: string;

  @ApiPropertyOptional({ description: 'IANA timezone', default: 'UTC', example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Whether the schedule is active', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * DTO for updating a pipeline schedule. All fields optional.
 */
export class UpdatePipelineScheduleDto {
  @ApiPropertyOptional({ description: 'User-friendly name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Cron expression (5 or 6 field)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cronExpression?: string;

  @ApiPropertyOptional({ description: 'IANA timezone' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Enable or disable the schedule' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Response shape for a pipeline schedule.
 */
export class PipelineScheduleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() projectId: string;
  @ApiProperty() name: string;
  @ApiProperty() targetProxyRuleId: string;
  @ApiProperty() cronExpression: string;
  @ApiProperty() timezone: string;
  @ApiProperty() enabled: boolean;
  @ApiPropertyOptional() lastRunAt?: Date;
  @ApiPropertyOptional() nextRunAt?: Date;
  @ApiPropertyOptional() executionStartedAt?: Date;
  @ApiPropertyOptional() lastError?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ListPipelineSchedulesResponseDto {
  @ApiProperty({ type: [PipelineScheduleResponseDto] })
  data: PipelineScheduleResponseDto[];
}
