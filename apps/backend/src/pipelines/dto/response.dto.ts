import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchemaField, SchemaKind } from '../../db/schema';
import { HttpMethod, ValidatorConfig, HandlerType } from '../types';

export { SchemaField, SchemaKind };

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
      'db_aggregate',
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

  @ApiProperty({ description: 'Schema version number, bumped when fields change' })
  version: number;

  @ApiProperty()
  fields: SchemaField[];

  @ApiProperty({
    nullable: true,
    enum: ['upload', 'chat', 'state'],
    description:
      'What this schema is for, as declared at creation. Null for schemas created before ' +
      'the field existed or authored by hand — consumers must treat null as unknown rather ' +
      'than as "plain data". Declares primary intent: an upload schema may still hold rows ' +
      'that are not files.',
  })
  kind: SchemaKind | null;

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

  @ApiPropertyOptional({ description: 'Deployment alias active when this record was created' })
  alias?: string | null;

  @ApiProperty({ description: 'Schema version at the time this record was created' })
  version: number;

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
 * Validator debug information
 */
export class ValidatorDebugInfoDto {
  @ApiProperty({ description: 'Validator type' })
  type: string;

  @ApiProperty({ description: 'Whether validation passed' })
  passed: boolean;

  @ApiProperty({ description: 'Execution duration in milliseconds' })
  durationMs: number;

  @ApiPropertyOptional({ description: 'Error information if validation failed' })
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Step debug information
 */
export class StepDebugInfoDto {
  @ApiProperty({ description: 'Step ID' })
  stepId: string;

  @ApiPropertyOptional({ description: 'Step name' })
  stepName?: string;

  @ApiProperty({ description: 'Handler type' })
  handlerType: string;

  @ApiProperty({ description: 'Start time (ISO 8601)' })
  startTime: string;

  @ApiProperty({ description: 'End time (ISO 8601)' })
  endTime: string;

  @ApiProperty({ description: 'Execution duration in milliseconds' })
  durationMs: number;

  @ApiProperty({ description: 'Execution status', enum: ['success', 'failed', 'skipped'] })
  status: 'success' | 'failed' | 'skipped';

  @ApiPropertyOptional({
    description: 'Input snapshot before execution (omitted when debug capture is disabled)',
  })
  input?: {
    requestBody: Record<string, unknown>;
    previousStepOutputs: Record<string, unknown>;
  };

  @ApiPropertyOptional({ description: 'Step output' })
  output?: unknown;

  @ApiPropertyOptional({ description: 'Error information if step failed' })
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  @ApiPropertyOptional({ description: 'Condition expression if any' })
  condition?: string;

  @ApiPropertyOptional({ description: 'Result of condition evaluation' })
  conditionResult?: boolean;
}

/**
 * Pipeline debug information
 */
export class PipelineDebugInfoDto {
  @ApiProperty({ type: [ValidatorDebugInfoDto], description: 'Validator execution results' })
  validators: ValidatorDebugInfoDto[];

  @ApiProperty({ type: [StepDebugInfoDto], description: 'Step execution results' })
  steps: StepDebugInfoDto[];

  @ApiProperty({ description: 'Total execution duration in milliseconds' })
  totalDurationMs: number;

  @ApiProperty({ description: 'Execution start time (ISO 8601)' })
  startTime: string;

  @ApiProperty({ description: 'Execution end time (ISO 8601)' })
  endTime: string;
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

  @ApiPropertyOptional({ type: PipelineDebugInfoDto, description: 'Debug information with step-by-step details' })
  debug?: PipelineDebugInfoDto;
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
