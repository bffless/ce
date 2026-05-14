import { Module, forwardRef } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarIntegrationController } from './google-calendar-integration.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // PermissionsModule + ProjectsModule are needed by ProjectPermissionGuard
  // (the guard takes Reflector, PermissionsService, ProjectsService).
  // ProjectsModule already imports IntegrationsModule, so the cycle is broken
  // with forwardRef on this side. Same pattern PipelinesModule uses.
  // SettingsModule is imported so GoogleCalendarOAuthService can read
  // workspace-level OAuth credentials via GoogleOAuthSettingsService.
  // forwardRef on SettingsModule: AuthModule.forRoot now imports SettingsModule
  // (story 0047 — OidcProvidersService injection into AuthController), which
  // creates a module-evaluation cycle through DomainsModule → ProxyRulesModule
  // → PipelinesModule → ProjectsModule → DeploymentsModule → ProjectsModule
  // and back into IntegrationsModule. forwardRef defers SettingsModule binding
  // until after all module files have evaluated.
  imports: [PermissionsModule, forwardRef(() => ProjectsModule), forwardRef(() => SettingsModule)],
  controllers: [GoogleCalendarIntegrationController],
  providers: [IntegrationsService, GoogleCalendarOAuthService],
  exports: [IntegrationsService, GoogleCalendarOAuthService],
})
export class IntegrationsModule {}
