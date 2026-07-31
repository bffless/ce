import { Module, forwardRef } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';
import { AppsRegistryService } from './apps-registry.service';
import { AppBundleService } from './app-bundle.service';
import { AppPreflightService } from './app-preflight.service';
import { AppCertStepService } from './app-cert-step.service';
import { AppInstallJobsService } from './app-install-jobs.service';
import { AppInstallerService } from './app-installer.service';
import { BootstrapDnsPreflightService } from '../setup/bootstrap-dns-preflight.service';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { DomainsModule } from '../domains/domains.module';
import { ProjectsModule } from '../projects/projects.module';
import { PipelineSchedulesModule } from '../pipeline-schedules/pipeline-schedules.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { SetupModule } from '../setup/setup.module';

@Module({
  // The applier (Task 9) is where the cross-module edges land: it drives the
  // real services rather than reimplementing their behaviour, so an app
  // install is indistinguishable from a careful operator clicking through the
  // admin UI.
  //  - ProxyRulesModule:      ProxyRuleSetsService.syncRuleSet (forwardRef —
  //                           the module forwardRefs internally)
  //  - DeploymentsModule:     DeploymentsService (zip deploy, alias/deployment deletes)
  //  - DomainsModule:         DomainsService (app subdomain) + AppCertStepService's
  //                           getWildcardCertificateStatus()
  //  - ProjectsModule:        ProjectsService (findOrCreate/exists/delete)
  //  - PipelineSchedulesModule: PipelineSchedulesService (manifest schedules)
  //  - PipelinesModule:       PipelineSchemasService (created-schema cleanup)
  //  - SetupModule:           PrimarySslService for AppCertStepService
  imports: [
    forwardRef(() => ProxyRulesModule),
    forwardRef(() => DeploymentsModule),
    forwardRef(() => DomainsModule),
    forwardRef(() => ProjectsModule),
    PipelineSchedulesModule,
    forwardRef(() => PipelinesModule),
    SetupModule,
  ],
  controllers: [AppCatalogController],
  providers: [
    AppCatalogService,
    AppsRegistryService,
    AppBundleService,
    AppPreflightService,
    AppCertStepService,
    AppInstallJobsService,
    AppInstallerService,
    // BootstrapDnsPreflightService is NOT exported by SetupModule (only
    // SetupService/PrimarySslService are), so even though SetupModule is
    // imported above (for PrimarySslService), we still provide a second
    // instance directly here — same pattern SetupModule itself uses for
    // SslCertificateService. Safe: probeHost is stateless (only reads/writes
    // a per-call temp ACME challenge file), so the two instances share all
    // durable state through the filesystem, not in-memory state.
    BootstrapDnsPreflightService,
  ],
  exports: [AppInstallJobsService, AppInstallerService],
})
export class AppCatalogModule {}
