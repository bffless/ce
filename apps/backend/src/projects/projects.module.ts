import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectAISettingsService } from './project-ai-settings.service';
import { ProjectSecretsService } from './project-secrets.service';
import { ProjectsController } from './projects.controller';
import { RepositoriesController } from './repositories.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    forwardRef(() => PermissionsModule),
    forwardRef(() => PipelinesModule),
    forwardRef(() => DeploymentsModule),
    IntegrationsModule,
  ],
  controllers: [ProjectsController, RepositoriesController],
  providers: [ProjectsService, ProjectAISettingsService, ProjectSecretsService],
  exports: [ProjectsService, ProjectAISettingsService, ProjectSecretsService],
})
export class ProjectsModule {}
