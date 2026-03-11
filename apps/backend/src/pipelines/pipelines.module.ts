import { Module, forwardRef } from '@nestjs/common';
import { PipelineSchemasController } from './pipeline-schemas.controller';
import { PipelineDataController } from './pipeline-data.controller';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataService } from './pipeline-data.service';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import {
  PipelineExecutionService,
  StepHandlerRegistry,
  ValidatorRegistry,
  ExpressionEvaluator,
} from './execution';
import { PermissionsModule } from '../permissions/permissions.module';
import { SettingsModule } from '../settings/settings.module';
import { ProjectsModule } from '../projects/projects.module';
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
  ChatHandler,
} from './handlers';
// Services
import { FunctionRunnerService } from './function-runner.service';
// Validators
import { AuthRequiredValidator, RateLimitValidator } from './execution/validators';

@Module({
  imports: [PermissionsModule, SettingsModule, forwardRef(() => ProjectsModule)],
  controllers: [
    PipelineSchemasController,
    PipelineDataController,
  ],
  providers: [
    // Core services
    PipelineSchemasService,
    PipelineDataService,
    StateSchemaGeneratorService,
    ChatSchemaGeneratorService,
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
    ChatHandler,
    // Validators (auto-register on construction)
    AuthRequiredValidator,
    RateLimitValidator,
  ],
  exports: [
    PipelineExecutionService,
    PipelineSchemasService,
    PipelineDataService,
  ],
})
export class PipelinesModule {}
