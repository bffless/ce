import { Module, forwardRef } from '@nestjs/common';
import { PipelineSchemasController } from './pipeline-schemas.controller';
import { PipelineDataController } from './pipeline-data.controller';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataService } from './pipeline-data.service';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import { UploadSchemaGeneratorService } from './upload-schema-generator.service';
import {
  PipelineExecutionService,
  StepHandlerRegistry,
  ValidatorRegistry,
  ExpressionEvaluator,
} from './execution';
import { PermissionsModule } from '../permissions/permissions.module';
import { SettingsModule } from '../settings/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { CacheRulesModule } from '../cache-rules/cache-rules.module';
// Step handlers
import {
  FormHandler,
  ResponseHandler,
  DataCreateHandler,
  DataQueryHandler,
  DataUpdateHandler,
  DataDeleteHandler,
  EmailHandler,
  DbAggregateHandler,
  FunctionHandler,
  AIHandler,
  FileUploadHandler,
  FileServeHandler,
  ReplicateHandler,
  EmbedStoreHandler,
  VectorSearchHandler,
  ImageConvertHandler,
  HttpRequestHandler,
} from './handlers';
// Embeddings service
import { PipelineEmbeddingsService } from './pipeline-embeddings.service';
// Services
import { FunctionRunnerService } from './function-runner.service';
import { SkillsService } from './skills.service';
// Validators
import { AuthRequiredValidator, RateLimitValidator } from './execution/validators';
// AI Plugin system
import {
  AIToolPluginRegistry,
  AIToolPluginService,
  AIPluginsController,
  GoogleOAuthService,
  CalculatorPlugin,
  WebSearchPlugin,
  GoogleCalendarPlugin,
} from './ai-plugins';

@Module({
  imports: [PermissionsModule, SettingsModule, forwardRef(() => ProjectsModule), CacheRulesModule],
  controllers: [
    PipelineSchemasController,
    PipelineDataController,
    AIPluginsController,
  ],
  providers: [
    // Core services
    PipelineSchemasService,
    PipelineDataService,
    StateSchemaGeneratorService,
    ChatSchemaGeneratorService,
    UploadSchemaGeneratorService,
    // Execution engine
    PipelineExecutionService,
    StepHandlerRegistry,
    ValidatorRegistry,
    ExpressionEvaluator,
    // Embeddings service (pgvector operations)
    PipelineEmbeddingsService,
    // Function runner service
    FunctionRunnerService,
    // Skills service for AI agent skills
    SkillsService,
    // Step handlers (auto-register on construction)
    FormHandler,
    ResponseHandler,
    DataCreateHandler,
    DataQueryHandler,
    DataUpdateHandler,
    DataDeleteHandler,
    EmailHandler,
    DbAggregateHandler,
    FunctionHandler,
    AIHandler,
    FileUploadHandler,
    FileServeHandler,
    ReplicateHandler,
    EmbedStoreHandler,
    VectorSearchHandler,
    ImageConvertHandler,
    HttpRequestHandler,
    // Validators (auto-register on construction)
    AuthRequiredValidator,
    RateLimitValidator,
    // AI Plugin system
    AIToolPluginRegistry,
    AIToolPluginService,
    GoogleOAuthService,
    // Built-in plugins (self-register via constructor)
    // To add a new plugin: create the class in ai-plugins/plugins/, add it here
    CalculatorPlugin,
    WebSearchPlugin,
    GoogleCalendarPlugin,
  ],
  exports: [
    PipelineExecutionService,
    PipelineSchemasService,
    PipelineDataService,
    SkillsService,
    AIToolPluginService,
    UploadSchemaGeneratorService,
  ],
})
export class PipelinesModule {}
