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

@Module({
  imports: [EmailModule, AuthModule, FeatureFlagsModule],
  controllers: [SetupController, BootstrapSetupController],
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
  ],
  exports: [SetupService],
})
export class SetupModule {}
