import { Module, forwardRef } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';
import { AppsRegistryService } from './apps-registry.service';
import { AppBundleService } from './app-bundle.service';
import { AppPreflightService } from './app-preflight.service';
import { AppCertStepService } from './app-cert-step.service';
import { BootstrapDnsPreflightService } from '../setup/bootstrap-dns-preflight.service';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';
import { DomainsModule } from '../domains/domains.module';
import { SetupModule } from '../setup/setup.module';

@Module({
  // Task 9 adds more imports here as install execution lands (e.g. deployments).
  // DomainsModule: AppCertStepService needs DomainsService.getWildcardCertificateStatus().
  // SetupModule: AppCertStepService needs PrimarySslService.issueLetsEncrypt().
  imports: [forwardRef(() => ProxyRulesModule), DomainsModule, SetupModule],
  controllers: [AppCatalogController],
  providers: [
    AppCatalogService,
    AppsRegistryService,
    AppBundleService,
    AppPreflightService,
    AppCertStepService,
    // BootstrapDnsPreflightService is NOT exported by SetupModule (only
    // SetupService/PrimarySslService are), so even though SetupModule is now
    // imported below (for PrimarySslService), we still provide a second
    // instance directly here — same pattern SetupModule itself uses for
    // SslCertificateService. Safe: probeHost is stateless (only reads/writes
    // a per-call temp ACME challenge file), so the two instances share all
    // durable state through the filesystem, not in-memory state.
    BootstrapDnsPreflightService,
  ],
})
export class AppCatalogModule {}
