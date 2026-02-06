import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, IsIn, Min, Length } from 'class-validator';

export class CreateTrafficRuleDto {
  @ApiProperty({ description: 'Alias to force when the condition matches' })
  @IsString()
  @Length(1, 255)
  alias: string;

  @ApiProperty({
    description: 'Condition type',
    enum: ['query_param', 'cookie'],
  })
  @IsString()
  @IsIn(['query_param', 'cookie'])
  conditionType: 'query_param' | 'cookie';

  @ApiProperty({ description: 'Parameter or cookie name to match', example: 'token' })
  @IsString()
  @Length(1, 255)
  conditionKey: string;

  @ApiProperty({ description: 'Value to match', example: 'Ta-2ClB9' })
  @IsString()
  @Length(1, 500)
  conditionValue: string;

  @ApiPropertyOptional({
    description: 'Priority (lower = evaluated first)',
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: 'Display label', example: 'Share link for recruiter' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  label?: string;
}

export class UpdateTrafficRuleDto {
  @ApiPropertyOptional({ description: 'Alias to force when the condition matches' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  alias?: string;

  @ApiPropertyOptional({
    description: 'Condition type',
    enum: ['query_param', 'cookie'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['query_param', 'cookie'])
  conditionType?: 'query_param' | 'cookie';

  @ApiPropertyOptional({ description: 'Parameter or cookie name to match' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  conditionKey?: string;

  @ApiPropertyOptional({ description: 'Value to match' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  conditionValue?: string;

  @ApiPropertyOptional({ description: 'Priority (lower = evaluated first)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: 'Whether this rule is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Display label' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  label?: string;
}

export class TrafficRuleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  domainId: string;

  @ApiProperty()
  alias: string;

  @ApiProperty()
  conditionType: string;

  @ApiProperty()
  conditionKey: string;

  @ApiProperty()
  conditionValue: string;

  @ApiProperty()
  priority: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true })
  label: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
