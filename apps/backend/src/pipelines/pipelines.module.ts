import { Module, forwardRef } from '@nestjs/common';
import { PipelineSchemasController } from './pipeline-schemas.controller';
import { PipelineDataController } from './pipeline-data.controller';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataService } from './pipeline-data.service';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import { UploadSchemaGeneratorService } from './upload-schema-generator.service';
import { UploadRecordService } from './upload-record.service';
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
  FileDeleteHandler,
  ReplicateHandler,
  EmbedStoreHandler,
  VectorSearchHandler,
  ImageConvertHandler,
  HttpRequestHandler,
  StripeCheckoutHandler,
  StripeWebhookHandler,
  SignedUrlHandler,
  PresignedUploadHandler,
  RegisterUploadHandler,
  GitHubApiHandler,
  GoogleCalendarHandler,
  DelayHandler,
} from './handlers';
import { IntegrationsModule } from '../integrations/integrations.module';
// Embeddings service
import { PipelineEmbeddingsService } from './pipeline-embeddings.service';
// Execution logging
import { PipelineExecutionLogService } from './pipeline-execution-log.service';
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
  RagSearchPlugin,
  EmailContactPlugin,
} from './ai-plugins';

@Module({
  imports: [
    PermissionsModule,
    // forwardRef: AuthModule.forRoot now imports SettingsModule (story 0047 —
    // OidcProvidersService injection into AuthController), which creates a
    // module-evaluation cycle through DomainsModule → … → PipelinesModule that
    // resolves SettingsModule to undefined here at file-evaluation time.
    // forwardRef defers the binding until after all module files have loaded.
    forwardRef(() => SettingsModule),
    forwardRef(() => ProjectsModule),
    CacheRulesModule,
    forwardRef(() => IntegrationsModule),
  ],
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
    // Shared upload bookkeeping (used by file_upload + register_upload handlers)
    UploadRecordService,
    // Execution engine
    PipelineExecutionService,
    StepHandlerRegistry,
    ValidatorRegistry,
    ExpressionEvaluator,
    // Embeddings service (pgvector operations)
    PipelineEmbeddingsService,
    // Execution log persistence
    PipelineExecutionLogService,
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
    FileDeleteHandler,
    ReplicateHandler,
    EmbedStoreHandler,
    VectorSearchHandler,
    ImageConvertHandler,
    HttpRequestHandler,
    StripeCheckoutHandler,
    StripeWebhookHandler,
    SignedUrlHandler,
    PresignedUploadHandler,
    RegisterUploadHandler,
    GitHubApiHandler,
    GoogleCalendarHandler,
    DelayHandler,
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
    RagSearchPlugin,
    EmailContactPlugin,
  ],
  exports: [
    PipelineExecutionService,
    PipelineSchemasService,
    PipelineDataService,
    SkillsService,
    AIToolPluginService,
    UploadSchemaGeneratorService,
    PipelineExecutionLogService,
  ],
})
export class PipelinesModule {}
