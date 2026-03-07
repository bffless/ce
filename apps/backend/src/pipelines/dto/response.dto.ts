import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HttpMethod, ValidatorConfig, SchemaField, HandlerType } from '../../db/schema';

export { SchemaField };

/**
 * Pipeline response DTO
 */
export class PipelineResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  pathPattern: string;

  @ApiProperty({ enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], isArray: true })
  httpMethods: HttpMethod[];

  @ApiProperty()
  validators: ValidatorConfig[];

  @ApiProperty()
  isEnabled: boolean;

  @ApiProperty()
  order: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Pipeline with steps response DTO
 */
export class PipelineWithStepsResponseDto extends PipelineResponseDto {
  @ApiProperty({ type: () => [PipelineStepResponseDto] })
  steps: PipelineStepResponseDto[];
}

/**
 * Pipeline step response DTO
 */
export class PipelineStepResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  pipelineId: string;

  @ApiPropertyOptional()
  name?: string | null;

  @ApiProperty({
    enum: [
      'form_handler',
      'data_create',
      'data_query',
      'data_update',
      'data_delete',
      'email_handler',
      'response_handler',
      'function_handler',
      'aggregate_handler',
    ],
  })
  handlerType: HandlerType;

  @ApiProperty()
  config: unknown;

  @ApiProperty()
  order: number;

  @ApiProperty()
  isEnabled: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Pipeline schema response DTO
 */
export class PipelineSchemaResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  fields: SchemaField[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Pipeline schema with record count
 */
export class PipelineSchemaWithCountDto extends PipelineSchemaResponseDto {
  @ApiProperty({ description: 'Number of records in this schema' })
  recordCount: number;
}

/**
 * Pipeline data record response DTO
 */
export class PipelineDataResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  schemaId: string;

  @ApiProperty()
  data: unknown;

  @ApiPropertyOptional()
  createdBy?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Paginated data response
 */
export class PaginatedDataResponseDto {
  @ApiProperty({ type: [PipelineDataResponseDto] })
  records: PipelineDataResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

/**
 * Pipeline test result DTO
 */
export class PipelineTestResultDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional()
  response?: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  };

  @ApiPropertyOptional()
  error?: {
    code: string;
    message: string;
    step?: string;
    details?: unknown;
  };

  @ApiPropertyOptional()
  stepOutputs?: Record<string, unknown>;

  @ApiProperty()
  durationMs: number;
}

/**
 * List responses
 */
export class PipelinesListResponseDto {
  @ApiProperty({ type: [PipelineResponseDto] })
  pipelines: PipelineResponseDto[];
}

export class SchemasListResponseDto {
  @ApiProperty({ type: [PipelineSchemaWithCountDto] })
  schemas: PipelineSchemaWithCountDto[];
}
