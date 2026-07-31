import { Module, forwardRef } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';
import { AppsRegistryService } from './apps-registry.service';
import { AppBundleService } from './app-bundle.service';
import { AppPreflightService } from './app-preflight.service';
import { BootstrapDnsPreflightService } from '../setup/bootstrap-dns-preflight.service';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';

@Module({
  // Task 9 adds more imports here as install execution lands (e.g. deployments/domains).
  imports: [forwardRef(() => ProxyRulesModule)],
  controllers: [AppCatalogController],
  providers: [
    AppCatalogService,
    AppsRegistryService,
    AppBundleService,
    AppPreflightService,
    // BootstrapDnsPreflightService has a zero-dependency constructor and is
    // NOT exported by SetupModule, so — the same pattern SetupModule itself
    // uses for SslCertificateService — we provide a second instance directly
    // here rather than importing SetupModule (heavy transitive deps this
    // module doesn't otherwise need). Safe: probeHost is stateless (only
    // reads/writes a per-call temp ACME challenge file).
    BootstrapDnsPreflightService,
  ],
})
export class AppCatalogModule {}
