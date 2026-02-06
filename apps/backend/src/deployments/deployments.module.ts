import { Module } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import { DeploymentsController, AliasesController } from './deployments.controller';
import { PublicController } from './public.controller';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { DomainsModule } from '../domains/domains.module';
import { CacheRulesModule } from '../cache-rules/cache-rules.module';
import { ShareLinksModule } from '../share-links/share-links.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [ProjectsModule, PermissionsModule, DomainsModule, CacheRulesModule, ShareLinksModule, PlatformModule],
  controllers: [DeploymentsController, AliasesController, PublicController],
  providers: [DeploymentsService],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
