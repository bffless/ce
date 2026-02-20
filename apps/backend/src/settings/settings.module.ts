import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsPublicController } from './settings-public.controller';
import { PrimaryContentService } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { EmailInitService } from './email-init.service';
import { DomainsModule } from '../domains/domains.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [DomainsModule, EmailModule],
  controllers: [SettingsController, SettingsPublicController],
  providers: [
    PrimaryContentService,
    // Note: PrimaryContentInitService removed - NginxStartupService handles startup
    SmtpService,
    EmailSettingsService,
    EmailInitService,
  ],
  exports: [PrimaryContentService, SmtpService, EmailSettingsService],
})
export class SettingsModule {}
