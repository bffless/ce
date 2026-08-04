import { Module, forwardRef } from '@nestjs/common';
import { PipelineSchemasController } from './pipeline-schemas.controller';
import { PipelineDataController } from './pipeline-data.controller';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataService } from './pipeline-data.service';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import { UploadSchemaGeneratorService } from './upload-schema-generator.service';
import { SchemaGeneratorRevisionsService } from './schema-generator-revisions.service';
import { UploadRecordService } from './upload-record.service';
import { UploadSchemaLintService } from './upload-schema-lint.service';
import {
  PipelineExecutionService,
  StepHandlerRegistry,
  ValidatorRegistry,
  ExpressionEvaluator,
  SystemPipelineTriggerService,
} from './execution';
import { PermissionsModule } from '../permissions/permissions.module';
import { SettingsModule } from '../settings/settings.module';
import { ProjectsModule } from '../projects/projects.module';
import { CacheRulesModule } from '../cache-rules/cache-rules.module';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';
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
  XmlFeedParseHandler,
  DataUpsertManyHandler,
  DelayHandler,
} from './handlers';
import { FeedParserService } from './feed-parser.service';
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
    // forwardRef: ProxyRulesModule already imports PipelinesModule (for the
    // execution service). The schema generators need the reverse edge —
    // ProxyRulesService + ProxyRuleSetRevisionsService — to capture a revision
    // for the rule sets they write.
    forwardRef(() => ProxyRulesModule),
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
    // Revision capture shared by the three generators above
    SchemaGeneratorRevisionsService,
    // Shared upload bookkeeping (used by file_upload + register_upload handlers)
    UploadRecordService,
    // Advisory upload-schema check for rule authoring paths (sync, MCP)
    UploadSchemaLintService,
    // Execution engine
    PipelineExecutionService,
    StepHandlerRegistry,
    ValidatorRegistry,
    ExpressionEvaluator,
    // Shared "system context" trigger (onboarding rules + scheduled pipelines)
    SystemPipelineTriggerService,
    // Embeddings service (pgvector operations)
    PipelineEmbeddingsService,
    // Execution log persistence
    PipelineExecutionLogService,
    // Function runner service
    FunctionRunnerService,
    // Skills service for AI agent skills
    SkillsService,
    // Feed parsing (pure) service used by the xml_feed_parse handler
    FeedParserService,
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
    XmlFeedParseHandler,
    DataUpsertManyHandler,
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
    SystemPipelineTriggerService,
    PipelineSchemasService,
    PipelineDataService,
    SkillsService,
    AIToolPluginService,
    UploadSchemaGeneratorService,
    UploadSchemaLintService,
    PipelineExecutionLogService,
  ],
})
export class PipelinesModule {}
