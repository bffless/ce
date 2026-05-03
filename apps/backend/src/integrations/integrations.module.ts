import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

@Module({
  providers: [IntegrationsService, GoogleCalendarOAuthService],
  exports: [IntegrationsService, GoogleCalendarOAuthService],
})
export class IntegrationsModule {}
