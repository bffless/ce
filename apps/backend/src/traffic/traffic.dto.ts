import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? parseInt(value, 10) : value;

/** Shared Request-log filters (history list + export). */
export class TrafficRequestFiltersDto {
  @ApiPropertyOptional({ description: 'Exact client IP' })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

  @ApiPropertyOptional({ description: 'Substring match on the request path' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @ApiPropertyOptional({ description: 'Exact response status code' })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(100)
  @Max(599)
  status?: number;

  @ApiPropertyOptional({ enum: ['unmatched', 'blocked'] })
  @IsOptional()
  @IsIn(['unmatched', 'blocked'])
  classification?: 'unmatched' | 'blocked';

  @ApiPropertyOptional({ description: 'ISO 8601 lower bound (inclusive) on the request time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 upper bound (inclusive) on the request time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ListTrafficRequestsQueryDto extends TrafficRequestFiltersDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 50;
}

export class ExportTrafficRequestsQueryDto extends TrafficRequestFiltersDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';

  @ApiPropertyOptional({ default: 10000, maximum: 50000 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50_000)
  limit?: number = 10_000;
}

export class ListTrafficIpRollupsQueryDto {
  @ApiPropertyOptional({ description: 'Substring match on the IP' })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

  @ApiPropertyOptional({
    enum: ['requestCount', 'lastSeenAt', 'firstSeenAt'],
    default: 'requestCount',
  })
  @IsOptional()
  @IsIn(['requestCount', 'lastSeenAt', 'firstSeenAt'])
  sortBy?: 'requestCount' | 'lastSeenAt' | 'firstSeenAt' = 'requestCount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 50;
}

export class ExportTrafficIpRollupsQueryDto {
  @ApiPropertyOptional({ description: 'Substring match on the IP' })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';

  @ApiPropertyOptional({ default: 10000, maximum: 50000 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50_000)
  limit?: number = 10_000;
}
