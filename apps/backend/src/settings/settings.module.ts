import { Module, forwardRef } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsPublicController } from './settings-public.controller';
import { PrimaryContentService } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { EmailInitService } from './email-init.service';
import { GoogleIntegrationCredentialsService } from './google-integration-credentials.service';
import { OidcProvidersService } from './oidc-providers.service';
import { BrandingService } from './branding.service';
import { TelemetrySettingsService } from './telemetry-settings.service';
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
    OidcProvidersService,
    BrandingService,
    TelemetrySettingsService,
  ],
  exports: [
    PrimaryContentService,
    SmtpService,
    EmailSettingsService,
    GoogleIntegrationCredentialsService,
    OidcProvidersService,
    BrandingService,
    TelemetrySettingsService,
  ],
})
export class SettingsModule {}
