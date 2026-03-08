import { Module } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelineStepsController } from './pipeline-steps.controller';
import { PipelineSchemasController } from './pipeline-schemas.controller';
import { PipelineDataController } from './pipeline-data.controller';
import { PipelinesService } from './pipelines.service';
import { PipelineStepsService } from './pipeline-steps.service';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataService } from './pipeline-data.service';
import {
  PipelineExecutionService,
  StepHandlerRegistry,
  ValidatorRegistry,
  ExpressionEvaluator,
} from './execution';
import { PermissionsModule } from '../permissions/permissions.module';
// Step handlers
import {
  FormHandler,
  ResponseHandler,
  DataCreateHandler,
  DataQueryHandler,
  DataUpdateHandler,
  DataDeleteHandler,
  EmailHandler,
  AggregateHandler,
  FunctionHandler,
} from './handlers';
// Services
import { FunctionRunnerService } from './function-runner.service';

@Module({
  imports: [PermissionsModule],
  controllers: [
    PipelinesController,
    PipelineStepsController,
    PipelineSchemasController,
    PipelineDataController,
  ],
  providers: [
    // Core services
    PipelinesService,
    PipelineStepsService,
    PipelineSchemasService,
    PipelineDataService,
    // Execution engine
    PipelineExecutionService,
    StepHandlerRegistry,
    ValidatorRegistry,
    ExpressionEvaluator,
    // Function runner service
    FunctionRunnerService,
    // Step handlers (auto-register on construction)
    FormHandler,
    ResponseHandler,
    DataCreateHandler,
    DataQueryHandler,
    DataUpdateHandler,
    DataDeleteHandler,
    EmailHandler,
    AggregateHandler,
    FunctionHandler,
  ],
  exports: [
    PipelinesService,
    PipelineExecutionService,
    PipelineSchemasService,
    PipelineDataService,
  ],
})
export class PipelinesModule {}
