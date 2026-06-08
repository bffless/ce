import { Module, forwardRef } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { ProjectsModule } from '../projects/projects.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { DomainsModule } from '../domains/domains.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';
import { CacheRulesModule } from '../cache-rules/cache-rules.module';
import { ResponseHeaderRulesModule } from '../response-header-rules/response-header-rules.module';
import { ProjectTools } from './tools/project.tools';
import { DeploymentTools } from './tools/deployment.tools';
import { DomainTools } from './tools/domain.tools';
import { PipelineTools } from './tools/pipeline.tools';
import { SettingsTools } from './tools/settings.tools';
import { UserTools } from './tools/user.tools';
import { ApiKeyTools } from './tools/api-key.tools';
import { ProxyRulesTools } from './tools/proxy-rules.tools';
import { CacheRulesTools } from './tools/cache-rules.tools';
import { ResponseHeaderRulesTools } from './tools/response-header-rules.tools';
import { StorageTools } from './tools/storage.tools';

const ALL_TOOLS = [
  ProjectTools,
  DeploymentTools,
  DomainTools,
  PipelineTools,
  SettingsTools,
  UserTools,
  ApiKeyTools,
  ProxyRulesTools,
  CacheRulesTools,
  ResponseHeaderRulesTools,
  StorageTools,
];

@Module({
  imports: [
    ProjectsModule,
    DeploymentsModule,
    DomainsModule,
    PipelinesModule,
    // forwardRef: same cycle as PipelinesModule and IntegrationsModule —
    // AuthModule.forRoot now imports SettingsModule (story 0047), which
    // pulls SettingsModule into the module-evaluation cycle that reaches
    // back to McpToolsModule. forwardRef defers the binding.
    forwardRef(() => SettingsModule),
    UsersModule,
    ApiKeysModule,
    ProxyRulesModule,
    CacheRulesModule,
    ResponseHeaderRulesModule,
    McpModule.forFeature(ALL_TOOLS, 'bffless-ce'),
  ],
  providers: ALL_TOOLS,
})
export class McpToolsModule {}
