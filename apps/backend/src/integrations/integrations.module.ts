import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarIntegrationController } from './google-calendar-integration.controller';

@Module({
  controllers: [GoogleCalendarIntegrationController],
  providers: [IntegrationsService, GoogleCalendarOAuthService],
  exports: [IntegrationsService, GoogleCalendarOAuthService],
})
export class IntegrationsModule {}
