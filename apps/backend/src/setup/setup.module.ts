import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { BootstrapSetupController } from './bootstrap-setup.controller';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { BootstrapDnsPreflightService } from './bootstrap-dns-preflight.service';
import { SslCertificateService } from '../domains/ssl-certificate.service';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { DomainsModule } from '../domains/domains.module';
import { PrimarySslController } from './primary-ssl/primary-ssl.controller';
import { PrimarySslService } from './primary-ssl/primary-ssl.service';
import { PrimarySslSnapshotService } from './primary-ssl/primary-ssl-snapshot.service';
import { PrimarySslRevertService } from './primary-ssl/primary-ssl-revert.service';

@Module({
  imports: [EmailModule, AuthModule, FeatureFlagsModule, DomainsModule],
  controllers: [SetupController, BootstrapSetupController, PrimarySslController],
  providers: [
    SetupService,
    BootstrapSetupService,
    BootstrapDnsPreflightService,
    // SslCertificateService has a zero-dependency constructor, so we provide
    // it directly here rather than importing the whole DomainsModule (which
    // carries heavy transitive deps this module doesn't otherwise need).
    // This creates a second instance alongside the one DomainsModule
    // provides for the rest of the app — that's fine because the two share
    // all durable state through the filesystem (acme-account.key, certs)
    // and the `ssl_challenges` DB table, not through in-memory state.
    SslCertificateService,
    PrimarySslService,
    PrimarySslSnapshotService,
    PrimarySslRevertService,
  ],
  // PrimarySslService is exported for AppCatalogModule's AppCertStepService
  // (Task 8): it needs `issueLetsEncrypt({ extraSans })` to stage a widened
  // cert for a newly-installed app's subdomain.
  exports: [SetupService, PrimarySslService],
})
export class SetupModule {}
