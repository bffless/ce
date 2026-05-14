import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsPublicController } from './settings-public.controller';
import { PrimaryContentService } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { EmailInitService } from './email-init.service';
import { GoogleIntegrationCredentialsService } from './google-integration-credentials.service';
import { GoogleIntegrationBackfillService } from './google-integration-backfill.service';
import { OidcProvidersService } from './oidc-providers.service';
import { BrandingService } from './branding.service';
import { DomainsModule } from '../domains/domains.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [forwardRef(() => DomainsModule), EmailModule],
  controllers: [SettingsController, SettingsPublicController],
  providers: [
    PrimaryContentService,
    // Note: PrimaryContentInitService removed - NginxStartupService handles startup
    SmtpService,
    EmailSettingsService,
    EmailInitService,
    GoogleIntegrationCredentialsService,
    // OnModuleInit — one-shot backfill from system_config.googleOauthConfig
    // into google_integration_credentials. Story 0048. Idempotent.
    GoogleIntegrationBackfillService,
    OidcProvidersService,
    BrandingService,
  ],
  exports: [
    PrimaryContentService,
    SmtpService,
    EmailSettingsService,
    GoogleIntegrationCredentialsService,
    OidcProvidersService,
    BrandingService,
  ],
})
export class SettingsModule {}
