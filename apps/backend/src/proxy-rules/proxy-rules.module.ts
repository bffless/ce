import { Module, MiddlewareConsumer, NestModule, RequestMethod, forwardRef } from '@nestjs/common';
import { ProxyRulesController } from './proxy-rules.controller';
import { ProxyRuleSetsController } from './proxy-rule-sets.controller';
import { ProxyRulesService } from './proxy-rules.service';
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyService } from './proxy.service';
import { ProxyMiddleware } from './proxy.middleware';
import { EmailFormHandlerService } from './email-form-handler.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { DomainsModule } from '../domains/domains.module';

@Module({
  imports: [PermissionsModule, forwardRef(() => DomainsModule)],
  controllers: [ProxyRulesController, ProxyRuleSetsController],
  providers: [ProxyRulesService, ProxyRuleSetsService, ProxyService, ProxyMiddleware, EmailFormHandlerService],
  exports: [ProxyRulesService, ProxyRuleSetsService, ProxyService],
})
export class ProxyRulesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ProxyMiddleware).forRoutes({
      path: 'public/*',
      method: RequestMethod.ALL,
    });
  }
}
