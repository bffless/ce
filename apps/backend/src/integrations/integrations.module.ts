import { Module, forwardRef } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarIntegrationController } from './google-calendar-integration.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  // PermissionsModule + ProjectsModule are needed by ProjectPermissionGuard
  // (the guard takes Reflector, PermissionsService, ProjectsService).
  // ProjectsModule already imports IntegrationsModule, so the cycle is broken
  // with forwardRef on this side. Same pattern PipelinesModule uses.
  imports: [PermissionsModule, forwardRef(() => ProjectsModule)],
  controllers: [GoogleCalendarIntegrationController],
  providers: [IntegrationsService, GoogleCalendarOAuthService],
  exports: [IntegrationsService, GoogleCalendarOAuthService],
})
export class IntegrationsModule {}
