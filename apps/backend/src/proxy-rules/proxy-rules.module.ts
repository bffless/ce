import { Module, MiddlewareConsumer, NestModule, RequestMethod, forwardRef } from '@nestjs/common';
import { ProxyRulesController, PipelineLogsController } from './proxy-rules.controller';
import { ProxyRuleSetsController } from './proxy-rule-sets.controller';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRuleSetRevisionsService } from './proxy-rule-set-revisions.service';
import { ProxyService } from './proxy.service';
import { ProxyMiddleware } from './proxy.middleware';
import { EmailFormHandlerService } from './email-form-handler.service';
import { RuleInvokerService } from './rule-invoker.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { DomainsModule } from '../domains/domains.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { ProjectsModule } from '../projects/projects.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';

@Module({
  imports: [
    PermissionsModule,
    forwardRef(() => DomainsModule),
    forwardRef(() => PipelinesModule),
    forwardRef(() => DeploymentsModule),
    forwardRef(() => ProjectsModule),
    UserGroupsModule,
  ],
  controllers: [ProxyRulesController, PipelineLogsController, ProxyRuleSetsController],
  providers: [
    ProxyRulesService,
    ProxyRuleSetsService,
    ProxyRuleSetRevisionsService,
    ProxyService,
    ProxyMiddleware,
    EmailFormHandlerService,
    RuleInvokerService,
  ],
  exports: [
    ProxyRulesService,
    ProxyRuleSetsService,
    ProxyRuleSetRevisionsService,
    ProxyService,
    RuleInvokerService,
  ],
})
export class ProxyRulesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ProxyMiddleware).forRoutes({
      path: 'public/*',
      method: RequestMethod.ALL,
    });
  }
}
